// SPDX-License-Identifier: Apache-2.0

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import * as THREE from 'three'
import type { AnimatedValue } from '@/anim'
import {
  textAnimationUsesLegacyTranslation,
  typewriterTextAtProgress,
  type TextAnimationConfig,
} from '@/anim/textAnimations'
import {
  SCRAMBLE_GLYPHS,
  scrambleTextForSegment,
} from '@/anim/textScramble'
import {
  resolveTextMotionRailAmount,
  resolveTextSegmentMotion,
} from '@/anim/textSegmentMotion'
import {
  createTextMotionRailWorkspace,
  refreshTextMotionRailWorkspace,
  resolveTextMotionRailOffsets,
  type TextMotionRailSegment,
  type TextMotionRailWorkspace,
} from '@/anim/textMotionRail'
import {
  easeTextAnimationProgress,
  textSegmentEnvelopeProgress,
  textSegmentLinearProgress,
} from '@/anim/textSegmentEnvelope'
import type { Rect, SolvedLayout } from '@/layout'
import type { BlendMode, CameraNode, Fill, GradientStop, Node, NodeId, SceneAPI } from '@/scene'
import { displayedText } from '@/scene'
import {
  buildWorldPlanes,
  cameraSpaceDepth,
  cameraFrustumCorners,
  createPlaneBuildContext,
  depthBlurAmount,
  effectiveApertureStrength,
  resolveCamera3D,
  textNodeNeedsSegmentPlane,
  type PlaneBuildContext,
  type PlaneClip3D,
  type Plane3D,
  type ResolvedCamera3D,
} from '@/render3d/scene3d'
import {
  createTextSegmentBuffers,
  textSegmentWorldUnitsPerScreenPixel,
  writeTextSegmentBuffers,
  type TextSegmentAtlasEntry,
  type TextSegmentBuffers,
  type TextSegmentGeometryState,
} from '@/render3d/textSegmentBatch'
import {
  installTextSegmentMaterialShader,
  updateTextSegmentMaterialShader,
} from '@/render3d/textSegmentMaterial'
import {
  depthOfFieldSampleCount,
  installDepthOfFieldShader,
  updateDepthOfFieldShader,
} from '@/render3d/depthOfFieldShader'
import {
  shouldRasterizePlaneTexture,
  textureScaleForRect,
} from '@/render3d/texturePolicy'
import {
  layoutCanvasTextAnimationSegments as computeCanvasTextAnimationSegments,
  layoutCanvasTextLines as computeCanvasTextLines,
  type CanvasTextAnimationSegment,
  type CanvasTextLine,
} from '@/render3d/textAnimationLayout'
import { applyCanvasStrokePattern } from '@/render/strokePattern'
import { textStaggerCurvePreviewStore } from '@/ui/textStaggerCurvePreviewStore'

interface ThreeSceneViewportProps {
  api: SceneAPI
  layout: SolvedLayout
  animated: Record<NodeId, AnimatedValue>
  camera: CameraNode
  cameraAnim: AnimatedValue | undefined
  width: number
  height: number
  sceneFill: string | null
  selectedIds: NodeId[]
  showHelpers?: boolean
  showPlanes?: boolean
  focusWorldPoint?: { x: number; y: number; z: number } | null
  exportable?: boolean
  /** Use the authored final-render sample budget instead of preview quality. */
  finalRender?: boolean
  /** Explicit WebGL drawing-buffer ratio. Editor previews derive this from zoom. */
  renderPixelRatio?: number
  playing?: boolean
  playhead?: number
  sceneVersion?: number
  onAvailabilityChange?: (available: boolean) => void
  /** Camera gesture/scrub is transient; keep GPU DOF on its realtime budget. */
  interactiveCameraPreview?: boolean
}

interface PlaneRecord {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  outline: THREE.LineSegments
  texture: THREE.CanvasTexture | THREE.VideoTexture
  textureKind: 'canvas' | 'video'
  renderKind: Plane3D['renderKind']
  video?: HTMLVideoElement
  textureRevision: PlaneTextureRevision | null
  textureSignature: string
  clipSignature: string
  textSegments?: TextSegmentRecord
}

interface TextSegmentRenderEntry extends TextSegmentAtlasEntry {
  text: string
  source: 'text' | 'decoration'
}

interface TextSegmentRecord {
  entries: TextSegmentRenderEntry[]
  buffers: TextSegmentBuffers
  states: TextSegmentGeometryState[]
  atlasScale: number
  blurPadding: number
  motionRail: WebGLTextMotionRailCache | null
}

interface WebGLTextMotionRailRun {
  segments: TextMotionRailSegment[]
  workspace: TextMotionRailWorkspace
  firstSequence: number
}

interface WebGLTextMotionRailCache {
  entries: readonly TextSegmentRenderEntry[]
  applyTo: TextAnimationConfig['applyTo']
  order: TextAnimationConfig['order']
  mode: TextAnimationConfig['mode']
  animatedCount: number
  runs: WebGLTextMotionRailRun[]
  output: Float64Array
  /** Plane/camera basis used to compile the shared baseline rail. */
  basis: Float64Array
}

interface TextSegmentAtlas {
  canvas: HTMLCanvasElement
  entries: TextSegmentRenderEntry[]
  scale: number
}

interface PlaneTextureRevision {
  sceneVersion: number
  imageRevision: number
  layout: SolvedLayout
}

interface PlayheadDrivenTextureRange {
  start: number
  end: number
}

interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

interface SubtreeTransformContext {
  x: number
  y: number
  z: number
  rotation: number
  scaleX: number
  scaleY: number
  opacity: number
  matrix: Matrix2D
}

interface HelperBundle {
  width: number
  height: number
  camera: THREE.PerspectiveCamera
  frustum: THREE.CameraHelper
  focusPlane: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  focusLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
}

const IMAGE_TEXTURE_LOADED_EVENT = 'hypermotion:render3d-image-loaded'
const RENDER3D_VIDEO_REGISTRY = '__hypermotionRender3dVideos'
const EMPTY_PLANES: Plane3D[] = []
const imageCache = new Map<string, HTMLImageElement>()
const parsedCanvasColorCache = new Map<string, string | null>()
const helperBundles = new WeakMap<THREE.Group, HelperBundle>()
let canvasColorParserContext: CanvasRenderingContext2D | null | undefined
const IDENTITY_MATRIX_2D: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const IDENTITY_SUBTREE_TRANSFORM: SubtreeTransformContext = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  matrix: IDENTITY_MATRIX_2D,
}

function createPlaneTexture(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  return texture
}

/**
 * Segment atlases avoid whole-texture mipmaps because coarse levels merge
 * neighboring glyph cells before the shader can clamp a sample. The segment
 * shader supplies its own bounded cell-safe prefilter for sparse playback.
 */
function createTextSegmentTexture(
  canvas: HTMLCanvasElement,
  renderer: THREE.WebGLRenderer,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
  return texture
}

function createVideoTexture(
  video: HTMLVideoElement,
): THREE.VideoTexture {
  const texture = new THREE.VideoTexture(video)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function createVideoElement(node: Extract<Node, { kind: 'video' }>): HTMLVideoElement {
  const video = document.createElement('video')
  video.src = node.src
  video.muted = true
  video.volume = 0
  video.loop = false
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.load()
  return video
}

function disposePlaneRecord(record: PlaneRecord) {
  record.video?.pause()
  record.video?.removeAttribute('src')
  record.video?.load()
  record.video = undefined
  record.mesh.geometry.dispose()
  record.mesh.material.dispose()
  record.texture.dispose()
}

function syncVideoElement(
  video: HTMLVideoElement,
  node: Extract<Node, { kind: 'video' }>,
  playing: boolean,
  playhead: number,
) {
  video.muted = node.muted
  video.volume = Math.max(0, Math.min(1, node.volume))
  const rate = clampPlaybackRate(node.playbackRate)
  video.playbackRate = rate
  const sourceClipLen = Math.max(0, (node.trimEnd || node.duration) - node.trimStart)
  const sceneClipLen = sourceClipLen / rate
  const inRange = playhead >= node.startTime && playhead < node.startTime + sceneClipLen
  const local = clampVideoLocal((playhead - node.startTime) * rate + node.trimStart, node)

  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    video.load()
    return
  }

  if (playing && inRange) {
    if (Math.abs(video.currentTime - local) > 0.35) {
      seekVideoElement(video, local, 0.2)
    }
    if (video.paused) {
      void video.play().catch(() => {
        // Keep the texture on the seeked preview frame if autoplay is blocked.
      })
    }
    return
  }

  if (!video.paused) video.pause()
  seekVideoElement(video, previewLocalForVideoTexture(local, node), 0.05)
}

function seekVideoElement(video: HTMLVideoElement, localTime: number, tolerance: number) {
  if (!Number.isFinite(localTime)) return
  const duration =
    Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : Number.POSITIVE_INFINITY
  const next = Math.max(0, Math.min(duration, localTime))
  if (Math.abs(video.currentTime - next) <= tolerance) return
  try {
    video.currentTime = next
  } catch {
    // Some media backends reject seeks until the first decode completes.
  }
}

function clampPlaybackRate(rate: number | undefined): number {
  return Math.max(0.05, Math.min(16, Number.isFinite(rate) ? rate! : 1))
}

function clampVideoLocal(
  t: number,
  node: Extract<Node, { kind: 'video' }>,
): number {
  if (node.loop) {
    const start = node.trimStart
    const end = node.trimEnd || node.duration || start
    const len = Math.max(0.001, end - start)
    return start + ((((t - start) % len) + len) % len)
  }
  const trimEnd = node.trimEnd || node.duration || 0
  if (t < node.trimStart) return node.trimStart
  if (t > trimEnd) return trimEnd
  return t
}

function previewLocalForVideoTexture(
  local: number,
  node: Extract<Node, { kind: 'video' }>,
): number {
  const trimStart = node.trimStart ?? 0
  const trimEnd = node.trimEnd || node.duration || trimStart
  if (local > trimStart + 0.001) return local
  if (trimEnd <= trimStart + 0.12) return local
  return Math.min(trimEnd, trimStart + 0.12)
}

export function ThreeSceneViewport({
  api,
  layout,
  animated,
  camera,
  cameraAnim,
  width,
  height,
  sceneFill,
  selectedIds,
  showHelpers = true,
  showPlanes = true,
  focusWorldPoint = null,
  exportable = false,
  finalRender = false,
  renderPixelRatio,
  playing = false,
  playhead = 0,
  sceneVersion = 0,
  onAvailabilityChange,
  interactiveCameraPreview = false,
}: ThreeSceneViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const planesRef = useRef<Map<NodeId, PlaneRecord>>(new Map())
  const helpersRef = useRef<THREE.Group | null>(null)
  const planeSyncRef = useRef<{
    planes: Plane3D[]
    selectedIds: NodeId[]
    textureRevision: PlaneTextureRevision
    playing: boolean
    playhead: number
    showPlanes: boolean
    dynamicDepthOfField: boolean
    camera: ResolvedCamera3D
    pixelRatio: number
    curvePreviewRevision: number
  } | null>(null)
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const [imageRevision, setImageRevision] = useState(0)
  const curvePreviewRevision = useSyncExternalStore(
    textStaggerCurvePreviewStore.subscribeAll,
    textStaggerCurvePreviewStore.getRevision,
    textStaggerCurvePreviewStore.getRevision,
  )

  const planeBuildContext = useMemo(() => {
    // Document transactions are the only way node/track topology changes.
    // Animation frames reuse this plain snapshot instead of decoding Yjs.
    void sceneVersion
    return createPlaneBuildContext(api)
  }, [api, sceneVersion])

  const baseCamera = useMemo(
    // Plane topology/world transforms are camera-independent. Keep a static
    // reference camera so camera keyframes do not rebuild the scene graph.
    () => resolveCamera3D(camera, undefined, { width, height }),
    [camera, width, height],
  )
  const focusTargetWorld = useMemo(() => {
    if ((camera.focusMode ?? 'screen') !== 'target' || !camera.focusTargetNodeId) {
      return null
    }
    const targetPlane = buildWorldPlanes(api, layout, animated, baseCamera, {
      context: planeBuildContext,
      independentNodes: true,
    }).find((plane) => plane.nodeId === camera.focusTargetNodeId)
    return targetPlane?.center ?? null
  }, [
    api,
    layout,
    animated,
    baseCamera,
    planeBuildContext,
    camera.focusMode,
    camera.focusTargetNodeId,
  ])
  const resolvedCamera = useMemo(
    () =>
      resolveCamera3D(
        camera,
        cameraAnim,
        { width, height },
        focusTargetWorld,
      ),
    [camera, cameraAnim, width, height, focusTargetWorld],
  )
  const planes = useMemo(
    () => {
      void sceneVersion
      return showPlanes
        ? buildWorldPlanes(api, layout, animated, baseCamera, {
            context: planeBuildContext,
          })
        : EMPTY_PLANES
    },
    [
      api,
      layout,
      animated,
      baseCamera,
      planeBuildContext,
      sceneVersion,
      showPlanes,
    ],
  )
  const playheadDrivenTextureRanges = useMemo(() => {
    void sceneVersion
    const ranges = new Map<NodeId, PlayheadDrivenTextureRange>()
    if (!showPlanes) return ranges
    for (const id of api.getAllNodeIds()) {
      const node = api.getNode(id)
      if (node?.kind !== 'text' || !node.textAnimation) continue
      const engineDriven = api
        .getTracksForNode(id)
        .some(
          (track) =>
            track.propertyId === 'text.progress' && track.keyframes.length >= 2,
        )
      if (engineDriven) continue
      const config = node.textAnimation
      ranges.set(id, {
        start: config.startTime,
        end:
          config.startTime +
          config.duration +
          Math.max(
            0,
            textAnimationSegmentCount(node.text, config.applyTo) - 1,
          ) *
            config.delay,
      })
    }
    return ranges
  }, [api, sceneVersion, showPlanes])
  const textureRevision = useMemo<PlaneTextureRevision>(
    // Camera and animation snapshots are intentionally excluded. Per-plane
    // signatures below decide whether animated values affect bitmap pixels or
    // only mesh transforms/opacity.
    () => ({
      sceneVersion,
      imageRevision,
      layout,
    }),
    [sceneVersion, imageRevision, layout],
  )

  useEffect(() => {
    const onImageLoaded = () => setImageRevision((revision) => revision + 1)
    window.addEventListener(IMAGE_TEXTURE_LOADED_EVENT, onImageLoaded)
    return () => window.removeEventListener(IMAGE_TEXTURE_LOADED_EVENT, onImageLoaded)
  }, [])

  useLayoutEffect(() => {
    if (webglUnavailable) return
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
    } catch (error) {
      console.warn('3D helper disabled: WebGL context creation failed.', error)
      setWebglUnavailable(true)
      onAvailabilityChange?.(false)
      return
    }
    renderer.setPixelRatio(1)
    renderer.setSize(width, height, false)
    renderer.localClippingEnabled = true
    renderer.sortObjects = true
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const perspective = new THREE.PerspectiveCamera(35, width / Math.max(1, height), 1, 100000)
    sceneRef.current = scene
    cameraRef.current = perspective
    rendererRef.current = renderer

    const helpers = new THREE.Group()
    helpers.name = '3D helpers'
    scene.add(helpers)
    helpersRef.current = helpers
    onAvailabilityChange?.(true)

    return () => {
      for (const record of planesRef.current.values()) {
        disposePlaneRecord(record)
        record.outline.geometry.dispose()
        ;(record.outline.material as THREE.Material).dispose()
      }
      planesRef.current.clear()
      planeSyncRef.current = null
      publishRender3dVideos(planesRef.current)
      clearHelperGroup(helpers)
      renderer.dispose()
      // HMR and React development remounts can otherwise leave retired WebGL
      // contexts alive until Chromium's GC runs. After enough edits the dev
      // preview hits the context limit, falls back to the 436-node DOM scene,
      // and playback becomes dramatically slower.
      renderer.forceContextLoss()
      renderer.domElement.remove()
      scene.clear()
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      helpersRef.current = null
      onAvailabilityChange?.(false)
    }
    // Create renderer once per mount; resizing is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webglUnavailable])

  useLayoutEffect(() => {
    if (webglUnavailable) return
    const renderer = rendererRef.current
    const perspective = cameraRef.current
    if (!renderer || !perspective) return
    const nextPixelRatio = Math.max(
      0.25,
      Math.min(4, renderPixelRatio ?? Math.min(2, window.devicePixelRatio || 1)),
    )
    if (Math.abs(renderer.getPixelRatio() - nextPixelRatio) > 0.001) {
      renderer.setPixelRatio(nextPixelRatio)
    }
    renderer.setSize(width, height, false)
    perspective.aspect = width / Math.max(1, height)
    perspective.updateProjectionMatrix()
  }, [webglUnavailable, width, height, renderPixelRatio])

  useLayoutEffect(() => {
    if (webglUnavailable) return
    const scene = sceneRef.current
    const perspective = cameraRef.current
    const renderer = rendererRef.current
    if (!scene || !perspective || !renderer) return

    syncThreeCamera(perspective, resolvedCamera, width, height)
    syncBackground(scene, sceneFill)
    const previousPlaneSync = planeSyncRef.current
    const hasVideoPlane = planes.some((plane) => plane.node.kind === 'video')
    const hasSegmentTextPlane = planes.some(
      (plane) => plane.renderKind === 'segment-text',
    )
    const pixelRatio = renderer.getPixelRatio()
    const hasDynamicDepthOfField =
      resolvedCamera.depthOfField &&
      effectiveApertureStrength(
        resolvedCamera.aperture,
        resolvedCamera.fStop,
      ) > 0 &&
      resolvedCamera.blurLevel > 0
    const playheadDrivenTextureChanged = previousPlaneSync
      ? playheadDrivenTextureNeedsSync(
          playheadDrivenTextureRanges,
          previousPlaneSync.playhead,
          playhead,
        )
      : playheadDrivenTextureRanges.size > 0
    const planeStateChanged =
      !previousPlaneSync ||
      previousPlaneSync.planes !== planes ||
      previousPlaneSync.selectedIds !== selectedIds ||
      previousPlaneSync.textureRevision !== textureRevision ||
      previousPlaneSync.curvePreviewRevision !== curvePreviewRevision ||
      previousPlaneSync.showPlanes !== showPlanes ||
      previousPlaneSync.pixelRatio !== pixelRatio ||
      (hasSegmentTextPlane && previousPlaneSync.camera !== resolvedCamera) ||
      (hasVideoPlane &&
        (previousPlaneSync.playing !== playing ||
          previousPlaneSync.playhead !== playhead)) ||
      playheadDrivenTextureChanged ||
      hasDynamicDepthOfField ||
      previousPlaneSync.dynamicDepthOfField !== hasDynamicDepthOfField

    if (planeStateChanged) {
      if (showPlanes) {
        syncPlanes(
          scene,
          planesRef.current,
          api,
          planeBuildContext,
          layout,
          planes,
          selectedIds,
          resolvedCamera,
          renderer,
          perspective,
          animated,
          playing,
          playhead,
          textureRevision,
          playheadDrivenTextureRanges,
          interactiveCameraPreview,
          finalRender,
          curvePreviewRevision,
        )
      } else {
        clearPlanes(scene, planesRef.current)
      }
    }
    // Keep the comparison snapshot current even when a camera-only preview
    // reused every plane. GPU DOF changes uniforms only; sharp plane textures
    // stay cached while timeline and camera gestures run.
    planeSyncRef.current = {
      planes,
      selectedIds,
      textureRevision,
      playing,
      playhead,
      showPlanes,
      dynamicDepthOfField: hasDynamicDepthOfField,
      camera: resolvedCamera,
      pixelRatio,
      curvePreviewRevision,
    }
    syncHelpers(
      helpersRef.current,
      resolvedCamera,
      width,
      height,
      showHelpers,
      focusWorldPoint,
    )

    renderer.render(scene, perspective)
  }, [
    api,
    planeBuildContext,
    layout,
    planes,
    resolvedCamera,
    sceneFill,
    selectedIds,
    showHelpers,
    showPlanes,
    focusWorldPoint,
    width,
    height,
    webglUnavailable,
    animated,
    playing,
    playhead,
    textureRevision,
    playheadDrivenTextureRanges,
    interactiveCameraPreview,
    finalRender,
    curvePreviewRevision,
    // Changing the zoom-derived pixel-ratio bucket reallocates and clears the
    // WebGL drawing buffer. Render again immediately after the resize effect.
    renderPixelRatio,
  ])

  if (webglUnavailable) return null

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0"
      data-export-hide={exportable ? undefined : '1'}
    />
  )
}

/**
 * Legacy text animations have no engine track to invalidate their texture.
 * Repaint while either sample is inside an active range, and once when a seek
 * crosses a range boundary. Frames wholly before or after every range stay on
 * the cached bitmap.
 */
function playheadDrivenTextureNeedsSync(
  ranges: ReadonlyMap<NodeId, PlayheadDrivenTextureRange>,
  previousPlayhead: number,
  playhead: number,
): boolean {
  if (previousPlayhead === playhead || ranges.size === 0) return false
  for (const range of ranges.values()) {
    const end = range.end + 1 / 60
    const previousActive =
      previousPlayhead >= range.start && previousPlayhead <= end
    const active = playhead >= range.start && playhead <= end
    if (previousActive || active) return true
    const crossedStart =
      (previousPlayhead < range.start && playhead >= range.start) ||
      (playhead < range.start && previousPlayhead >= range.start)
    const crossedEnd =
      (previousPlayhead <= end && playhead > end) ||
      (playhead <= end && previousPlayhead > end)
    if (crossedStart || crossedEnd) return true
  }
  return false
}

function syncThreeCamera(
  camera: THREE.PerspectiveCamera,
  resolved: ResolvedCamera3D,
  width: number,
  height: number,
) {
  camera.fov = resolved.fieldOfView
  camera.aspect = width / Math.max(1, height)
  camera.near = resolved.nearClip
  camera.far = resolved.farClip
  camera.position.set(resolved.position.x, resolved.position.y, resolved.position.z)
  camera.up.set(0, -1, 0)
  camera.lookAt(
    resolved.pointOfInterest.x,
    resolved.pointOfInterest.y,
    resolved.pointOfInterest.z,
  )
  if (resolved.rotation.z !== 0) {
    camera.rotateZ(THREE.MathUtils.degToRad(-resolved.rotation.z))
  }
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
}

function syncBackground(scene: THREE.Scene, sceneFill: string | null) {
  const solidColor = sceneFill ? parseCanvasSolidColor(sceneFill) : null
  const previousColor = scene.userData.hyperMotionBackgroundColor as
    | string
    | null
    | undefined
  if (previousColor === solidColor) return
  scene.userData.hyperMotionBackgroundColor = solidColor
  scene.background = solidColor ? new THREE.Color(solidColor) : null
}

const SELF_TEXTURE_ANIMATION_KEYS = new Set<keyof AnimatedValue>([
  'cornerRadius',
  'fill',
  'textProgress',
])

/**
 * Return only animated values that alter this plane's bitmap.
 *
 * The plane root's transform and opacity are represented by the Three mesh,
 * so those values must not trigger a multi-megapixel Canvas2D repaint.
 * Descendant animation inside a flattened subtree does affect its pixels and
 * is included. Extracted 3D/video stacks own separate planes and are skipped
 * exactly as the subtree painter skips them.
 */
function planeTextureAnimationSignature(
  context: PlaneBuildContext,
  plane: Plane3D,
  animated: Record<NodeId, AnimatedValue>,
  playhead: number,
  playheadDrivenTextureRanges: ReadonlyMap<NodeId, PlayheadDrivenTextureRange>,
): string {
  const parts: string[] = []
  const visit = (id: NodeId, isRoot: boolean) => {
    const node = context.nodesById.get(id)
    if (!node) return
    if (
      !isRoot &&
      ((!!node.parent &&
        context.directVideoChildNodeIds.has(node.parent)) ||
        context.segmentTextNodeIds.has(id) ||
        node.transform.renderMode === 'plane' ||
        node.transform.renderMode === 'group3d')
    ) {
      return
    }

    const value = animated[id]
    if (value) {
      const record = value as unknown as Record<string, unknown>
      for (const key of Object.keys(record).sort()) {
        if (key === 'textAnimation') continue
        if (
          isRoot &&
          !SELF_TEXTURE_ANIMATION_KEYS.has(key as keyof AnimatedValue)
        ) {
          continue
        }
        parts.push(`${id}.${key}=${JSON.stringify(record[key])}`)
      }
    }

    const legacyRange = playheadDrivenTextureRanges.get(id)
    if (legacyRange) {
      const phase =
        playhead < legacyRange.start
          ? 'before'
          : playhead <= legacyRange.end + 1 / 60
            ? `active-${Number(playhead.toFixed(4))}`
            : 'after'
      parts.push(`${id}.legacyText=${phase}`)
    }

    if (plane.contentMode !== 'subtree') return
    for (const childId of node.children) visit(childId, false)
  }

  visit(plane.nodeId, true)
  return parts.length > 0 ? parts.join('|') : 'static-animation'
}

function planeContainsTrailPreview(
  context: PlaneBuildContext,
  plane: Plane3D,
): boolean {
  const visit = (nodeId: NodeId): boolean => {
    if (textStaggerCurvePreviewStore.getPreview(nodeId)) return true
    if (plane.contentMode !== 'subtree') return false
    const node = context.nodesById.get(nodeId)
    return node?.children.some(visit) ?? false
  }
  return visit(plane.nodeId)
}

function previewedTextAnimation(
  nodeId: NodeId,
  authoredConfig: TextAnimationConfig | null,
): TextAnimationConfig | null {
  const trailPreview = textStaggerCurvePreviewStore.getPreview(nodeId)
  if (!authoredConfig || !trailPreview) return authoredConfig
  return {
    ...authoredConfig,
    ...(trailPreview.curve
      ? { staggerCurve: trailPreview.curve }
      : {}),
    ...(trailPreview.motionPath
      ? { motionPath: trailPreview.motionPath }
      : {}),
    ...(trailPreview.duration != null
      ? { duration: trailPreview.duration }
      : {}),
  }
}

function syncPlanes(
  scene: THREE.Scene,
  records: Map<NodeId, PlaneRecord>,
  api: SceneAPI,
  planeBuildContext: PlaneBuildContext,
  layout: SolvedLayout,
  planes: Plane3D[],
  selectedIds: NodeId[],
  camera: ResolvedCamera3D,
  renderer: THREE.WebGLRenderer,
  perspective: THREE.PerspectiveCamera,
  animated: Record<NodeId, AnimatedValue>,
  playing: boolean,
  playhead: number,
  textureRevision: PlaneTextureRevision,
  playheadDrivenTextureRanges: ReadonlyMap<NodeId, PlayheadDrivenTextureRange>,
  interactiveCameraPreview: boolean,
  finalRender: boolean,
  curvePreviewRevision: number,
) {
  const active = new Set<NodeId>()
  const selected = new Set(selectedIds)
  const apertureStrength = effectiveApertureStrength(
    camera.aperture,
    camera.fStop,
  )
  // `blurLevel` is exposed as Max Blur in the Inspector, so it must remain a
  // hard ceiling. The f-stop changes how quickly depth error reaches that
  // ceiling; multiplying the ceiling itself made f/0.1 turn 3px into 18px and
  // exposed the individual aperture taps as ghosted copies of text.
  const maximumBlurLevel = camera.blurLevel
  const pointBlurLevel =
    maximumBlurLevel * Math.max(0, Math.min(1, apertureStrength))
  const sampleCount = depthOfFieldSampleCount(
    camera.dofPreviewQuality,
    camera.blurQuality,
    {
      playing,
      interactive: interactiveCameraPreview,
      finalRender,
    },
  )
  const viewportSize = renderer.getSize(new THREE.Vector2())
  const screenPixelRatio = renderer.getPixelRatio()
  // Point focus is a screen-space lens field. Every composited plane must use
  // the same field; gating it by an approximate world point made tilted cards
  // jump straight to full blur even when they sat underneath the visible dot.
  const focusMask =
    camera.focusMode === 'screen' &&
    camera.depthOfField &&
    apertureStrength > 0 &&
    maximumBlurLevel > 0
  for (const plane of planes) {
    active.add(plane.nodeId)
    let record = records.get(plane.nodeId)
    if (record && record.renderKind !== plane.renderKind) {
      scene.remove(record.mesh)
      scene.remove(record.outline)
      disposePlaneRecord(record)
      record.outline.geometry.dispose()
      ;(record.outline.material as THREE.Material).dispose()
      records.delete(plane.nodeId)
      record = undefined
    }
    const depthBlur = depthBlurAmount(
      cameraSpaceDepth(plane.center, camera),
      plane.center,
      camera.focusWorld,
      camera.focusDistance,
      camera.focusRadius,
      camera.focusFalloff,
      apertureStrength,
      maximumBlurLevel,
      camera.focalLength,
      camera.depthOfField,
      false,
    )
    const blur =
      camera.focusMode === 'screen' &&
      camera.depthOfField &&
      apertureStrength > 0
        ? pointBlurLevel
        : depthBlur
    // Point focus is an explicit sharp region around the picked world point.
    // A tilted plane's center can sit at a different depth than that picked
    // point; carrying the center-derived blur into the mask would leave the
    // exact point the user focused on visibly soft.
    const minimumBlur = focusMask ? 0 : blur
    if (plane.renderKind === 'segment-text' && plane.node.kind === 'text') {
      const nextRecord = syncTextSegmentPlane({
        scene,
        record,
        plane,
        camera,
        renderer,
        perspective,
        anim: animated[plane.nodeId],
        playing,
        playhead,
        textureRevision,
        selected: selected.has(plane.nodeId),
        apertureStrength,
        maximumBlurLevel,
        pointBlurLevel,
        focusMask,
        viewportSize,
        screenPixelRatio,
        sampleCount,
        interactiveCameraPreview,
      })
      records.set(plane.nodeId, nextRecord)
      continue
    }
    const videoNode = plane.node.kind === 'video' ? plane.node : null
    const textureSignature = [
      plane.contentMode,
      Number(plane.rect.width.toFixed(3)),
      Number(plane.rect.height.toFixed(3)),
      planeTextureAnimationSignature(
        planeBuildContext,
        plane,
        animated,
        playhead,
        playheadDrivenTextureRanges,
      ),
      planeContainsTrailPreview(planeBuildContext, plane)
        ? curvePreviewRevision
        : 0,
    ].join(':')
    // Viewport pan/zoom, selection, and camera-only renders must reuse the
    // existing bitmap. A plane is rasterized only when its scene/animation
    // content revision or a texture-affecting parameter actually changes.
    const needsCanvasRaster = shouldRasterizePlaneTexture(
      !!videoNode,
      record,
      textureRevision,
      textureSignature,
    )
    const canvas = needsCanvasRaster
      ? renderPlaneCanvas(api, layout, plane, animated, playhead)
      : null
    if (!record) {
      const geometry = new THREE.PlaneGeometry(plane.rect.width, plane.rect.height)
      const texture = videoNode
        ? createVideoTexture(createVideoElement(videoNode))
        : createPlaneTexture(canvas!, renderer)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
      installDepthOfFieldShader(material)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = plane.node.name
      const outline = makePlaneOutline(plane.rect.width, plane.rect.height)
      scene.add(mesh)
      scene.add(outline)
      record = {
        mesh,
        outline,
        texture,
        textureKind: videoNode ? 'video' : 'canvas',
        renderKind: 'canvas',
        video: videoNode ? texture.image as HTMLVideoElement : undefined,
        textureRevision: videoNode ? null : textureRevision,
        textureSignature,
        clipSignature: '',
      }
      records.set(plane.nodeId, record)
    } else {
      const current = (record.mesh.geometry as THREE.PlaneGeometry).parameters
      if (current.width !== plane.rect.width || current.height !== plane.rect.height) {
        record.mesh.geometry.dispose()
        record.mesh.geometry = new THREE.PlaneGeometry(plane.rect.width, plane.rect.height)
        record.outline.geometry.dispose()
        record.outline.geometry = makePlaneOutlineGeometry(plane.rect.width, plane.rect.height)
      }
    }
    const material = record.mesh.material as THREE.MeshBasicMaterial
    updateDepthOfFieldShader(material, {
      enabled: camera.depthOfField && apertureStrength > 0,
      blurPx: blur,
      minimumBlurPx: minimumBlur,
      planeWidth: plane.rect.width,
      planeHeight: plane.rect.height,
      focusMask,
      focusX: focusMask ? camera.focusScreen.x : 0,
      // gl_FragCoord uses a bottom-left origin; authored canvas coordinates
      // and the editor focus overlay use top-left.
      focusY: focusMask ? viewportSize.y - camera.focusScreen.y : 0,
      focusRadius: focusMask ? camera.focusRadius : 0,
      focusFalloff: focusMask ? camera.focusFalloff : 1,
      screenPixelRatio,
      sampleCount,
      bladeCount: camera.bladeCount,
      bladeRotation: camera.bladeRotation,
      bokehRatio: camera.bokehRatio,
    })
    if (videoNode) {
      if (record.textureKind !== 'video' || record.video?.src !== videoNode.src) {
        record.texture.dispose()
        const video = createVideoElement(videoNode)
        record.texture = createVideoTexture(video)
        record.textureKind = 'video'
        record.video = video
        material.map = record.texture
        material.needsUpdate = true
      }
      record.textureRevision = null
      record.textureSignature = textureSignature
      syncVideoElement(record.video!, videoNode, playing, playhead)
      record.texture.needsUpdate = true
    } else if (needsCanvasRaster && canvas) {
      if (record.textureKind !== 'canvas') {
        record.texture.dispose()
        record.video?.pause()
        record.video = undefined
        record.texture = createPlaneTexture(canvas!, renderer)
        record.textureKind = 'canvas'
        material.map = record.texture
        material.needsUpdate = true
      }
      const previousImage = record.texture.image as HTMLCanvasElement | undefined
      if (
        previousImage &&
        (previousImage.width !== canvas!.width || previousImage.height !== canvas!.height)
      ) {
        record.texture.dispose()
        record.texture = createPlaneTexture(canvas!, renderer)
        record.textureKind = 'canvas'
        material.map = record.texture
        material.needsUpdate = true
      } else {
        record.texture.image = canvas!
      }
      record.texture.needsUpdate = true
      record.textureRevision = textureRevision
      record.textureSignature = textureSignature
    }
    applyPlaneTransform(record.mesh, plane)
    applyPlaneTransform(record.outline, plane)
    record.mesh.renderOrder = plane.paintOrder
    record.outline.renderOrder = 100000 + plane.paintOrder
    applyMaterialBlendMode(record.mesh.material, plane.node.appearance.blendMode)
    syncMaterialClipping(record, plane)
    record.mesh.material.opacity = Math.max(0, Math.min(1, plane.opacity))
    record.mesh.visible = plane.node.visible
    record.outline.visible = selected.has(plane.nodeId)
    // Keep the deterministic scene-data texture as the source of truth.
    // The DOM foreignObject snapshot path can drop nested text in Chrome
    // when the texture source lives under an invisible compositor source.
    void renderer
    void scene
    void perspective
  }
  for (const [id, record] of records) {
    if (active.has(id)) continue
    scene.remove(record.mesh)
    scene.remove(record.outline)
    disposePlaneRecord(record)
    record.outline.geometry.dispose()
    ;(record.outline.material as THREE.Material).dispose()
    records.delete(id)
  }
  publishRender3dVideos(records)
}

interface TextSegmentPlaneSyncOptions {
  scene: THREE.Scene
  record: PlaneRecord | undefined
  plane: Plane3D
  camera: ResolvedCamera3D
  renderer: THREE.WebGLRenderer
  perspective: THREE.PerspectiveCamera
  anim: AnimatedValue | undefined
  playing: boolean
  playhead: number
  textureRevision: PlaneTextureRevision
  selected: boolean
  apertureStrength: number
  maximumBlurLevel: number
  pointBlurLevel: number
  focusMask: boolean
  viewportSize: THREE.Vector2
  screenPixelRatio: number
  sampleCount: number
  interactiveCameraPreview: boolean
}

/**
 * Spatial text uses one atlas-backed BufferGeometry per text node. The atlas
 * changes only with text/style/layout (plus inherently dynamic Scramble),
 * while four vertices per semantic segment carry every playback update.
 */
function syncTextSegmentPlane({
  scene,
  record: currentRecord,
  plane,
  camera,
  renderer,
  perspective,
  anim,
  playing,
  playhead,
  textureRevision,
  selected,
  apertureStrength,
  maximumBlurLevel,
  pointBlurLevel,
  focusMask,
  viewportSize,
  screenPixelRatio,
  sampleCount,
  interactiveCameraPreview,
}: TextSegmentPlaneSyncOptions): PlaneRecord {
  if (plane.node.kind !== 'text') {
    throw new Error('A segment-text plane must reference a text node')
  }
  const node = plane.node
  // Scene/track readers already normalize textAnimation. Reusing that object
  // avoids cloning and sorting custom curve points on every playback sync.
  const authoredConfig = anim?.textAnimation ?? node.textAnimation ?? null
  const config = previewedTextAnimation(node.id, authoredConfig)
  const atlasScale = textureScaleForRect(
    plane.rect,
    renderer.getPixelRatio(),
  )
  const lineHeightPx = Math.max(
    1,
    (node.fontSize ?? 16) * (node.lineHeight ?? 1.2),
  )
  const minimumPathZ =
    config?.motionPath?.points.reduce(
      (minimum, point) =>
        Math.min(minimum, point.z, point.inZ, point.outZ),
      0,
    ) ?? 0
  const minimumMotionZ = config?.motionPath
    ? minimumPathZ
    : Math.min(0, config?.motionVector?.z ?? 0)
  const extraAwayDepth =
    Math.max(0, -minimumMotionZ) * lineHeightPx +
    (config?.id === 'flip' ? lineHeightPx * Math.abs(plane.scaleY) : 0)
  const worldUnitsPerScreenPixel = textSegmentWorldUnitsPerScreenPixel({
    plane,
    cameraDepth: (point) => cameraSpaceDepth(point, camera),
    focalLength: camera.focalLength,
    extraAwayDepth,
  })
  const effectBlur =
    config?.id === 'blur' || config?.id === 'blur-slide'
      ? config.blurRadius
      : 0
  const requestedBlurPadding = textSegmentAtlasBlurPadding(
    (effectBlur + (camera.depthOfField ? maximumBlurLevel : 0)) *
      worldUnitsPerScreenPixel,
  )
  // During continuous playback/camera gestures, retain only the session's
  // bucket high-water to avoid oscillating atlas repacks. A paused/committed
  // sync immediately returns to the requested scale and padding, so one zoom
  // or Max Blur experiment cannot leave the editor permanently oversized.
  const blurPadding =
    playing || interactiveCameraPreview
      ? Math.max(
          requestedBlurPadding,
          currentRecord?.textSegments?.blurPadding ?? 0,
        )
      : requestedBlurPadding
  const atlasPlayhead = textSegmentAtlasPlayhead(config, playhead)
  const textureSignature = textSegmentTextureSignature(
    node,
    plane.rect,
    anim,
    config,
    playhead,
    blurPadding,
    atlasScale,
  )
  const revisionChanged =
    !currentRecord?.textureRevision ||
    currentRecord.textureRevision.sceneVersion !== textureRevision.sceneVersion ||
    currentRecord.textureRevision.imageRevision !== textureRevision.imageRevision ||
    currentRecord.textureRevision.layout !== textureRevision.layout
  const needsAtlas =
    !currentRecord?.textSegments ||
    currentRecord.textureSignature !== textureSignature ||
    revisionChanged
  const atlas = needsAtlas
    ? renderTextSegmentAtlas(
        node,
        plane.rect,
        anim,
        config,
        atlasPlayhead,
        renderer,
        blurPadding,
        atlasScale,
      )
    : null

  let record = currentRecord
  if (!record) {
    const nextAtlas = atlas!
    const buffers = createTextSegmentBuffers(nextAtlas.entries.length)
    const geometry = createTextSegmentGeometry(buffers)
    const texture = createTextSegmentTexture(nextAtlas.canvas, renderer)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    installTextSegmentMaterialShader(material)
    material.forceSinglePass = true
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `${node.name} segments`
    mesh.frustumCulled = false
    const outline = makePlaneOutline(plane.rect.width, plane.rect.height)
    scene.add(mesh)
    scene.add(outline)
    record = {
      mesh,
      outline,
      texture,
      textureKind: 'canvas',
      renderKind: 'segment-text',
      textureRevision,
      textureSignature,
      clipSignature: '',
      textSegments: {
        entries: nextAtlas.entries,
        buffers,
        states: createTextSegmentGeometryStates(nextAtlas.entries.length),
        atlasScale: nextAtlas.scale,
        blurPadding,
        motionRail: null,
      },
    }
  } else if (atlas) {
    const previousImage = record.texture.image as HTMLCanvasElement | undefined
    if (
      !previousImage ||
      previousImage.width !== atlas.canvas.width ||
      previousImage.height !== atlas.canvas.height
    ) {
      record.texture.dispose()
      record.texture = createTextSegmentTexture(atlas.canvas, renderer)
      record.mesh.material.map = record.texture
      record.mesh.material.needsUpdate = true
    } else {
      record.texture.image = atlas.canvas
      record.texture.needsUpdate = true
    }

    if (record.textSegments?.entries.length !== atlas.entries.length) {
      record.mesh.geometry.dispose()
      const buffers = createTextSegmentBuffers(atlas.entries.length)
      record.mesh.geometry = createTextSegmentGeometry(buffers)
      record.textSegments = {
        entries: atlas.entries,
        buffers,
        states: createTextSegmentGeometryStates(atlas.entries.length),
        atlasScale: atlas.scale,
        blurPadding,
        motionRail: null,
      }
    } else {
      record.textSegments = {
        entries: atlas.entries,
        buffers: record.textSegments.buffers,
        states: record.textSegments.states,
        atlasScale: atlas.scale,
        blurPadding,
        motionRail: record.textSegments.motionRail,
      }
    }
    record.textureRevision = textureRevision
    record.textureSignature = textureSignature
  }

  const segmentRecord = record.textSegments!
  const states = resolveTextSegmentGeometryStates(
    segmentRecord,
    plane,
    config,
    anim?.textProgress,
    playhead,
    perspective,
    camera,
    apertureStrength,
    maximumBlurLevel,
    pointBlurLevel,
    focusMask,
  )
  writeTextSegmentBuffers({
    buffers: segmentRecord.buffers,
    entries: segmentRecord.entries,
    states,
    plane,
    cameraDepth: (point) => cameraSpaceDepth(point, camera),
  })
  const animatedMaskBounds =
    config?.id === 'mask-up' ||
    config?.id === 'mask-down' ||
    config?.id === 'gradient-reveal'
  markTextSegmentGeometryUpdated(
    record.mesh.geometry,
    !!atlas || animatedMaskBounds,
  )

  const maximumSegmentBlur = states.reduce(
    (maximum, state) => Math.max(maximum, state.dofBlur),
    0,
  )
  updateTextSegmentMaterialShader(record.mesh.material, {
    enabled:
      camera.depthOfField &&
      apertureStrength > 0 &&
      maximumBlurLevel > 0,
    blurPx: maximumSegmentBlur,
    // Lens blur is carried per segment; a batch-wide minimum would force the
    // sharpest glyph to inherit the farthest glyph's circle of confusion.
    minimumBlurPx: 0,
    planeWidth: plane.rect.width,
    planeHeight: plane.rect.height,
    focusMask,
    focusX: focusMask ? camera.focusScreen.x : 0,
    focusY: focusMask ? viewportSize.y - camera.focusScreen.y : 0,
    focusRadius: focusMask ? camera.focusRadius : 0,
    focusFalloff: focusMask ? camera.focusFalloff : 1,
    screenPixelRatio,
    sampleCount,
    bladeCount: camera.bladeCount,
    bladeRotation: camera.bladeRotation,
    bokehRatio: camera.bokehRatio,
  })
  const outlineSize = record.outline.userData.hyperMotionOutlineSize as
    | { width: number; height: number }
    | undefined
  if (
    !outlineSize ||
    outlineSize.width !== plane.rect.width ||
    outlineSize.height !== plane.rect.height
  ) {
    record.outline.geometry.dispose()
    record.outline.geometry = makePlaneOutlineGeometry(
      plane.rect.width,
      plane.rect.height,
    )
    record.outline.userData.hyperMotionOutlineSize = {
      width: plane.rect.width,
      height: plane.rect.height,
    }
  }
  applyPlaneTransform(record.outline, plane)
  record.mesh.renderOrder = plane.paintOrder
  record.outline.renderOrder = 100000 + plane.paintOrder
  applyMaterialBlendMode(record.mesh.material, plane.node.appearance.blendMode)
  syncMaterialClipping(record, plane)
  record.mesh.material.opacity = Math.max(0, Math.min(1, plane.opacity))
  record.mesh.visible = plane.node.visible
  record.outline.visible = selected
  return record
}

function createTextSegmentGeometry(
  buffers: TextSegmentBuffers,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(buffers.positions, 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  )
  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(buffers.uvs, 2).setUsage(THREE.DynamicDrawUsage),
  )
  geometry.setAttribute(
    'hmOpacity',
    new THREE.BufferAttribute(buffers.opacity, 1).setUsage(
      THREE.DynamicDrawUsage,
    ),
  )
  geometry.setAttribute(
    'hmEffectBlur',
    new THREE.BufferAttribute(buffers.effectBlur, 1).setUsage(
      THREE.DynamicDrawUsage,
    ),
  )
  geometry.setAttribute(
    'hmDofBlur',
    new THREE.BufferAttribute(buffers.dofBlur, 1).setUsage(
      THREE.DynamicDrawUsage,
    ),
  )
  geometry.setAttribute(
    'hmUvBounds',
    new THREE.BufferAttribute(buffers.uvBounds, 4).setUsage(
      THREE.DynamicDrawUsage,
    ),
  )
  geometry.setIndex(
    new THREE.BufferAttribute(buffers.indices, 1).setUsage(
      THREE.DynamicDrawUsage,
    ),
  )
  return geometry
}

function markTextSegmentGeometryUpdated(
  geometry: THREE.BufferGeometry,
  atlasChanged: boolean,
) {
  for (const name of [
    'position',
    'uv',
    'hmOpacity',
    'hmEffectBlur',
    'hmDofBlur',
  ]) {
    const attribute = geometry.getAttribute(name)
    if (attribute) attribute.needsUpdate = true
  }
  if (atlasChanged) {
    const uvBounds = geometry.getAttribute('hmUvBounds')
    if (uvBounds) uvBounds.needsUpdate = true
  }
  if (geometry.index) geometry.index.needsUpdate = true
}

function createTextSegmentGeometryStates(
  count: number,
): TextSegmentGeometryState[] {
  return Array.from({ length: count }, () => ({
    offset: { x: 0, y: 0, z: 0 },
    opacity: 1,
    effectBlur: 0,
    dofBlur: 0,
    scale: 1,
    skew: 0,
    rotationX: 0,
    cropTop: 0,
    cropBottom: 0,
  }))
}

function resolveTextSegmentGeometryStates(
  segmentRecord: TextSegmentRecord,
  plane: Plane3D,
  config: TextAnimationConfig | null,
  timelineProgress: number | undefined,
  playhead: number,
  perspective: THREE.PerspectiveCamera,
  camera: ResolvedCamera3D,
  apertureStrength: number,
  maximumBlurLevel: number,
  pointBlurLevel: number,
  focusMask: boolean,
): TextSegmentGeometryState[] {
  const { entries, states } = segmentRecord
  if (states.length !== entries.length) {
    throw new Error('Text segment state cache does not match the entry count')
  }
  const animatedCount = animatedTextSegmentCount(entries)
  const lineHeightPx = Math.max(
    1,
    (plane.node.kind === 'text' ? plane.node.fontSize : 16) *
      (plane.node.kind === 'text' ? plane.node.lineHeight : 1.2),
  )
  const cameraRight = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(perspective.quaternion)
    .normalize()
  const cameraDown = new THREE.Vector3(0, -1, 0)
    .applyQuaternion(perspective.quaternion)
    .normalize()
  const cameraForward = new THREE.Vector3()
  perspective.getWorldDirection(cameraForward).normalize()
  segmentRecord.motionRail = ensureWebGLTextMotionRailCache(
    entries,
    config,
    animatedCount,
    segmentRecord.motionRail,
  )
  const motionRailOffsets = resolveWebGLTextMotionRailOffsets(
    entries,
    plane,
    config,
    timelineProgress,
    playhead,
    animatedCount,
    lineHeightPx,
    cameraRight,
    cameraDown,
    cameraForward,
    segmentRecord.motionRail,
  )

  const center = { x: 0, y: 0, z: 0 }
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    const state = states[index]!
    let offsetX = 0
    let offsetY = 0
    let offsetZ = 0
    if (!entry.animate || !config) {
      state.opacity = 1
      state.effectBlur = 0
      state.scale = 1
      state.skew = 0
      state.rotationX = 0
      state.cropTop = 0
      state.cropBottom = 0
    } else {
      const orderIndex =
        config.order === 'backward'
          ? animatedCount - entry.order - 1
          : entry.order
      const visual = canvasTextSegmentState(
        config,
        playhead,
        timelineProgress,
        orderIndex,
        animatedCount,
        lineHeightPx,
      )
      const trackingShift =
        config.applyTo === 'layer'
          ? 0
          : visual.extraTracking *
            (entry.trackingIndex -
              Math.max(0, entry.lineCharacterCount - 1) *
                entry.trackingAlignment)
      const railOffset = index * 3
      const fallbackMotion = motionRailOffsets
        ? null
        : resolveTextSegmentMotion(
            config.motionPath,
            config.motionVector,
            lineHeightPx,
            visual.amount,
          )
      if (motionRailOffsets || fallbackMotion) {
        const motionX = motionRailOffsets
          ? motionRailOffsets[railOffset]!
          : fallbackMotion!.x
        const motionY =
          (motionRailOffsets
            ? motionRailOffsets[railOffset + 1]!
            : fallbackMotion!.y) + visual.waveOffset
        const motionZ = motionRailOffsets
          ? motionRailOffsets[railOffset + 2]!
          : fallbackMotion!.z
        offsetX =
          cameraRight.x * motionX +
          cameraDown.x * motionY -
          cameraForward.x * motionZ +
          plane.right.x * trackingShift * plane.scaleX
        offsetY =
          cameraRight.y * motionX +
          cameraDown.y * motionY -
          cameraForward.y * motionZ +
          plane.right.y * trackingShift * plane.scaleX
        offsetZ =
          cameraRight.z * motionX +
          cameraDown.z * motionY -
          cameraForward.z * motionZ +
          plane.right.z * trackingShift * plane.scaleX
      } else {
        offsetX =
          plane.right.x * (visual.dx + trackingShift) * plane.scaleX +
          plane.down.x * visual.dy * plane.scaleY
        offsetY =
          plane.right.y * (visual.dx + trackingShift) * plane.scaleX +
          plane.down.y * visual.dy * plane.scaleY
        offsetZ =
          plane.right.z * (visual.dx + trackingShift) * plane.scaleX +
          plane.down.z * visual.dy * plane.scaleY
      }
      const masked =
        config.id === 'mask-up' ||
        config.id === 'mask-down' ||
        config.id === 'gradient-reveal'
      const atlasDrivenLayerReveal =
        config.applyTo === 'layer' &&
        (config.id === 'typewriter' || config.id === 'scramble')
      state.opacity = atlasDrivenLayerReveal ? 1 : visual.opacity
      state.effectBlur = visual.blur
      state.scale = visual.scale
      state.skew = visual.skew
      state.rotationX =
        config.id === 'flip'
          ? THREE.MathUtils.degToRad(visual.amount * -90)
          : 0
      state.cropTop =
        masked && config.direction === 'down' ? visual.amount : 0
      state.cropBottom =
        masked && config.direction !== 'down' ? visual.amount : 0
    }

    state.offset.x = offsetX
    state.offset.y = offsetY
    state.offset.z = offsetZ
    center.x =
      plane.center.x +
      plane.right.x * (entry.pivotX - plane.rect.width / 2) * plane.scaleX +
      plane.down.x * (entry.pivotY - plane.rect.height / 2) * plane.scaleY +
      offsetX
    center.y =
      plane.center.y +
      plane.right.y * (entry.pivotX - plane.rect.width / 2) * plane.scaleX +
      plane.down.y * (entry.pivotY - plane.rect.height / 2) * plane.scaleY +
      offsetY
    center.z =
      plane.center.z +
      plane.right.z * (entry.pivotX - plane.rect.width / 2) * plane.scaleX +
      plane.down.z * (entry.pivotY - plane.rect.height / 2) * plane.scaleY +
      offsetZ
    state.dofBlur = focusMask
      ? pointBlurLevel
      : depthBlurAmount(
          cameraSpaceDepth(center, camera),
          center,
          camera.focusWorld,
          camera.focusDistance,
          camera.focusRadius,
          camera.focusFalloff,
          apertureStrength,
          maximumBlurLevel,
          camera.focalLength,
          camera.depthOfField,
          false,
        )
  }
  return states
}

function ensureWebGLTextMotionRailCache(
  entries: readonly TextSegmentRenderEntry[],
  config: TextAnimationConfig | null,
  animatedCount: number,
  current: WebGLTextMotionRailCache | null,
): WebGLTextMotionRailCache | null {
  if (
    !config?.motionPath ||
    (config.applyTo !== 'letters' && config.applyTo !== 'words')
  ) {
    return null
  }
  if (
    current?.entries === entries &&
    current.applyTo === config.applyTo &&
    current.order === config.order &&
    current.mode === config.mode &&
    current.animatedCount === animatedCount
  ) {
    return current
  }

  const runs = new Map<number, TextMotionRailSegment[]>()
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    if (!entry.animate) continue
    const sequence =
      config.order === 'backward'
        ? animatedCount - entry.order - 1
        : entry.order
    const segment: TextMotionRailSegment = {
      index,
      sequence,
      baseline: { x: 0, y: 0, z: 0 },
    }
    const run = runs.get(entry.visualLineIndex)
    if (run) run.push(segment)
    else runs.set(entry.visualLineIndex, [segment])
  }

  if (runs.size === 0) return null
  return {
    entries,
    applyTo: config.applyTo,
    order: config.order,
    mode: config.mode,
    animatedCount,
    runs: [...runs.values()].map((segments) => ({
      segments,
      workspace: createTextMotionRailWorkspace(segments, config.mode),
      firstSequence: segments.reduce(
        (first, segment) => Math.min(first, segment.sequence),
        Number.POSITIVE_INFINITY,
      ),
    })),
    output: new Float64Array(entries.length * 3),
    basis: new Float64Array(19).fill(Number.NaN),
  }
}

function resolveWebGLTextMotionRailOffsets(
  entries: readonly TextSegmentRenderEntry[],
  plane: Plane3D,
  config: TextAnimationConfig | null,
  timelineProgress: number | undefined,
  playhead: number,
  animatedCount: number,
  lineHeightPx: number,
  cameraRight: THREE.Vector3,
  cameraDown: THREE.Vector3,
  cameraForward: THREE.Vector3,
  cache: WebGLTextMotionRailCache | null,
): Float64Array | null {
  if (!config?.motionPath || !cache) return null

  if (
    updateWebGLTextMotionRailBasis(
      cache.basis,
      plane,
      cameraRight,
      cameraDown,
      cameraForward,
    )
  ) {
    for (const run of cache.runs) {
      for (const segment of run.segments) {
        const entry = entries[segment.index]!
        const planeX =
          (entry.pivotX - plane.rect.width / 2) * plane.scaleX
        const planeY =
          (entry.pivotY - plane.rect.height / 2) * plane.scaleY
        const worldX = plane.right.x * planeX + plane.down.x * planeY
        const worldY = plane.right.y * planeX + plane.down.y * planeY
        const worldZ = plane.right.z * planeX + plane.down.z * planeY
        segment.baseline.x =
          cameraRight.x * worldX +
          cameraRight.y * worldY +
          cameraRight.z * worldZ
        segment.baseline.y =
          cameraDown.x * worldX +
          cameraDown.y * worldY +
          cameraDown.z * worldZ
        // Positive authored Z is toward the viewer, opposite camera forward.
        segment.baseline.z = -(
          cameraForward.x * worldX +
          cameraForward.y * worldY +
          cameraForward.z * worldZ
        )
      }
      refreshTextMotionRailWorkspace(run.workspace)
    }
  }

  const scaledLineHeight =
    lineHeightPx * Math.max(0.0001, Math.abs(plane.scaleY))
  for (const run of cache.runs) {
    const amount = resolveTextMotionRailAmount(
      config,
      playhead,
      timelineProgress,
      animatedCount,
      run.firstSequence,
      run.segments.length,
    )
    resolveTextMotionRailOffsets(
      config.motionPath,
      scaledLineHeight,
      amount,
      config.mode,
      run.segments,
      cache.output,
      run.workspace,
    )
  }
  return cache.output
}

function updateWebGLTextMotionRailBasis(
  basis: Float64Array,
  plane: Plane3D,
  cameraRight: THREE.Vector3,
  cameraDown: THREE.Vector3,
  cameraForward: THREE.Vector3,
): boolean {
  const changed =
    basis[0] !== plane.scaleX ||
    basis[1] !== plane.scaleY ||
    basis[2] !== plane.rect.width ||
    basis[3] !== plane.rect.height ||
    basis[4] !== plane.right.x ||
    basis[5] !== plane.right.y ||
    basis[6] !== plane.right.z ||
    basis[7] !== plane.down.x ||
    basis[8] !== plane.down.y ||
    basis[9] !== plane.down.z ||
    basis[10] !== cameraRight.x ||
    basis[11] !== cameraRight.y ||
    basis[12] !== cameraRight.z ||
    basis[13] !== cameraDown.x ||
    basis[14] !== cameraDown.y ||
    basis[15] !== cameraDown.z ||
    basis[16] !== cameraForward.x ||
    basis[17] !== cameraForward.y ||
    basis[18] !== cameraForward.z
  if (!changed) return false
  basis[0] = plane.scaleX
  basis[1] = plane.scaleY
  basis[2] = plane.rect.width
  basis[3] = plane.rect.height
  basis[4] = plane.right.x
  basis[5] = plane.right.y
  basis[6] = plane.right.z
  basis[7] = plane.down.x
  basis[8] = plane.down.y
  basis[9] = plane.down.z
  basis[10] = cameraRight.x
  basis[11] = cameraRight.y
  basis[12] = cameraRight.z
  basis[13] = cameraDown.x
  basis[14] = cameraDown.y
  basis[15] = cameraDown.z
  basis[16] = cameraForward.x
  basis[17] = cameraForward.y
  basis[18] = cameraForward.z
  return true
}

type PendingTextSegmentEntry = Omit<TextSegmentRenderEntry, 'uv'>

interface PackedTextSegmentEntry {
  entry: TextSegmentRenderEntry
  destinationX: number
  destinationY: number
  destinationWidth: number
  destinationHeight: number
}

function textSegmentAtlasBlurPadding(value: number): number {
  const clamped = Math.max(0, Math.min(512, Number.isFinite(value) ? value : 0))
  if (clamped <= 0) return 0
  // Power-of-two buckets keep animated Max Blur from repacking the glyph atlas
  // for every frame or fractional-pixel change. The caller may retain a bucket
  // only for the current gesture/playback session, then downshift on commit.
  return Math.min(512, 2 ** Math.ceil(Math.log2(Math.max(8, clamped))))
}

function textSegmentAtlasPlayhead(
  config: TextAnimationConfig | null,
  playhead: number,
): number {
  return config?.id === 'scramble'
    ? Math.floor(playhead * 30 + 1e-6) / 30
    : playhead
}

function textSegmentTextureSignature(
  node: Extract<Node, { kind: 'text' }>,
  rect: Rect,
  anim: AnimatedValue | undefined,
  config: TextAnimationConfig | null,
  playhead: number,
  blurPadding: number,
  atlasScale: number,
): string {
  const text = displayedText(node)
  let dynamicFrame: number | null = null
  if (config?.id === 'scramble') {
    // Scramble changes glyph content, so it is the only segment effect that
    // needs frequent atlas uploads. Thirty texture updates per second keeps
    // the effect visually rapid while the geometry itself still moves at the
    // full preview/export frame rate.
    const progress = textAnimationProgress(
      config,
      anim?.textProgress,
      playhead,
    )
    dynamicFrame =
      progress <= 0
        ? -1
        : progress >= 1
          ? -2
          : Math.floor(playhead * 30 + 1e-6)
  } else if (config?.id === 'typewriter' && config.applyTo === 'layer') {
    const progress = textAnimationProgress(
      config,
      anim?.textProgress,
      playhead,
    )
    const visibleProgress = config.mode === 'out' ? 1 - progress : progress
    dynamicFrame = Math.ceil(Array.from(text).length * visibleProgress)
  } else if (config?.id === 'tracking' && config.applyTo !== 'letters') {
    dynamicFrame = Math.round(
      textAnimationProgress(config, anim?.textProgress, playhead) * 4096,
    )
  }
  return JSON.stringify({
    text,
    width: Number(rect.width.toFixed(3)),
    height: Number(rect.height.toFixed(3)),
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    fontStyle: node.fontStyle,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    textAlign: node.textAlign,
    textAlignVertical: node.textAlignVertical,
    textDecoration: node.textDecoration,
    textCase: node.textCase,
    fill: anim?.fill ?? node.appearance.fill ?? node.color,
    effectGradient:
      config?.id === 'gradient-reveal'
        ? config.mode === 'in'
          ? config.endGradient ?? config.startGradient
          : config.startGradient ?? config.endGradient
        : null,
    stroke: node.appearance.stroke,
    applyTo: config?.applyTo ?? 'layer',
    blurPadding,
    atlasScale: Number(atlasScale.toFixed(3)),
    dynamicFrame,
  })
}

function renderTextSegmentAtlas(
  node: Extract<Node, { kind: 'text' }>,
  rect: Rect,
  anim: AnimatedValue | undefined,
  config: TextAnimationConfig | null,
  playhead: number,
  renderer: THREE.WebGLRenderer,
  blurPadding: number,
  preferredScale: number,
): TextSegmentAtlas {
  const measurementCanvas = document.createElement('canvas')
  const measurement = measurementCanvas.getContext('2d')!
  configureCanvasTextContext(measurement, node)
  const fontSize = node.fontSize ?? 16
  const lineHeight = node.lineHeight ?? 1.2
  const lineHeightPx = Math.max(1, fontSize * lineHeight)
  const tracking = Number.isFinite(node.letterSpacing) ? node.letterSpacing : 0
  const text = displayedText(node)
  const lineCount = layoutCanvasTextLines(
    measurement,
    text,
    rect.width,
    tracking,
  ).length
  const textHeight = Math.max(1, lineCount) * lineHeightPx
  const alignedY =
    node.textAlignVertical === 'center'
      ? Math.max(0, (rect.height - textHeight) / 2)
      : node.textAlignVertical === 'bottom'
        ? Math.max(0, rect.height - textHeight)
        : 0
  const padding = Math.max(
    2,
    blurPadding + Math.ceil(fontSize * 0.12),
  )
  const widestScrambleReplacement =
    config?.id === 'scramble'
      ? Array.from(SCRAMBLE_GLYPHS).reduce(
          (widest, character) => {
            const width = measurement.measureText(character).width
            return width > widest.width ? { character, width } : widest
          },
          { character: '', width: 0 },
        )
      : { character: '', width: 0 }
  const pending: PendingTextSegmentEntry[] = []
  if (node.appearance.stroke && node.appearance.stroke.width > 0) {
    pending.push({
      text: '',
      source: 'decoration',
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
      padding: 0,
      pivotX: rect.width / 2,
      pivotY: rect.height / 2,
      animate: false,
      order: -1,
      trackingIndex: 0,
      lineCharacterCount: 0,
      trackingAlignment: 0,
      visualLineIndex: -1,
    })
  }
  if ((config?.applyTo ?? 'layer') === 'layer') {
    if (text.length > 0) {
      const trackingPadding =
        config?.id === 'tracking'
          ? Math.max(0, Array.from(text).length - 1) * 10
          : 0
      pending.push({
        text,
        source: 'text',
        x: 0,
        y: 0,
        width: rect.width,
        height: rect.height,
        padding:
          padding +
          trackingPadding +
          (config?.id === 'scramble'
            ? Math.max(
                scrambleWrappedHeightOverflowPadding(
                  measurement,
                  text,
                  rect.width,
                  tracking,
                  rect.height,
                  lineHeightPx,
                  widestScrambleReplacement.character,
                ),
                scrambleWrappedWidthOverflowPadding(
                  text,
                  rect.width,
                  tracking,
                  widestScrambleReplacement.width,
                  node.textAlign ?? 'start',
                ),
              )
            : 0),
        pivotX: rect.width / 2,
        pivotY: rect.height / 2,
        animate: true,
        order: 0,
        trackingIndex: 0,
        lineCharacterCount: Array.from(text).length,
        trackingAlignment:
          node.textAlign === 'center' ? 0.5 : node.textAlign === 'end' ? 1 : 0,
        visualLineIndex: 0,
      })
    }
  } else if (config) {
    const segments = layoutCanvasTextAnimationSegments(
      measurement,
      text,
      config.applyTo,
      0,
      alignedY,
      rect.width,
      fontSize,
      lineHeight,
      tracking,
      node.textAlign ?? 'start',
    )
    for (const segment of segments) {
      if (!segment.animate || segment.text.length === 0 || /^\s+$/.test(segment.text)) {
        continue
      }
      pending.push({
        text: segment.text,
        source: 'text',
        x: segment.x,
        y: segment.y,
        width: Math.max(0.5, segment.width),
        height: segment.height,
        padding:
          padding +
          (config.id === 'scramble' &&
          (config.applyTo === 'letters' || config.applyTo === 'words')
            ? scrambleTextOverflowPadding(
                measurement,
                segment.text,
                segment.width,
                tracking,
                widestScrambleReplacement.width,
              )
            : 0) +
          (config.id === 'scramble' && config.applyTo === 'lines'
            ? Math.max(
                scrambleWrappedHeightOverflowPadding(
                  measurement,
                  segment.text,
                  segment.width,
                  tracking,
                  segment.height,
                  lineHeightPx,
                  widestScrambleReplacement.character,
                ),
                scrambleWrappedWidthOverflowPadding(
                  segment.text,
                  segment.width,
                  tracking,
                  widestScrambleReplacement.width,
                  node.textAlign ?? 'start',
                ),
              )
            : 0) +
          (config.id === 'tracking'
            ? Math.max(0, Array.from(segment.text).length - 1) * 10
            : 0),
        pivotX: segment.x + segment.width / 2,
        pivotY: segment.y + segment.height / 2,
        animate: true,
        order: segment.order,
        trackingIndex: segment.trackingIndex,
        lineCharacterCount: segment.lineCharacterCount,
        trackingAlignment: segment.trackingAlignment,
        visualLineIndex: segment.visualLineIndex,
      })
    }
  }

  const maximumAtlasSize = Math.max(
    256,
    Math.min(4096, renderer.capabilities.maxTextureSize || 4096),
  )
  let scale = Math.max(0.5, preferredScale)
  let packed = packTextSegmentAtlas(pending, scale, maximumAtlasSize)
  while (!packed && scale > 0.5) {
    scale = Math.max(0.5, scale * 0.75)
    packed = packTextSegmentAtlas(pending, scale, maximumAtlasSize)
  }
  // A very large pathological text node still gets one valid page. The
  // geometry remains spatial; only its raster resolution is reduced.
  packed ??= packTextSegmentAtlas(pending, 0.25, maximumAtlasSize)
  if (!packed) {
    const emptyCanvas = document.createElement('canvas')
    emptyCanvas.width = 1
    emptyCanvas.height = 1
    return {
      canvas: emptyCanvas,
      entries: [],
      scale: 0.25,
    }
  }
  scale = packed.scale

  const canvas = document.createElement('canvas')
  canvas.width = packed.width
  canvas.height = packed.height
  canvas.dataset.textureScale = String(scale)
  const ctx = canvas.getContext('2d')!
  const maximumCellWidth = Math.max(
    1,
    ...packed.entries.map((entry) => entry.destinationWidth),
  )
  const maximumCellHeight = Math.max(
    1,
    ...packed.entries.map((entry) => entry.destinationHeight),
  )
  const scratch = document.createElement('canvas')
  scratch.width = maximumCellWidth
  scratch.height = maximumCellHeight
  const animatedCount = animatedTextSegmentCount(
    packed.entries.map((entry) => entry.entry),
  )
  for (const packedEntry of packed.entries) {
    paintTextSegmentAtlasCell(
      ctx,
      scratch,
      packedEntry,
      node,
      rect,
      anim,
      config,
      playhead,
      scale,
      animatedCount,
    )
  }
  return {
    canvas,
    entries: packed.entries.map((entry) => entry.entry),
    scale,
  }
}

function scrambleTextOverflowPadding(
  ctx: CanvasRenderingContext2D,
  text: string,
  originalWidth: number,
  tracking: number,
  widestReplacement: number,
): number {
  const characters = Array.from(text)
  const replacementWidth =
    characters.reduce(
      (width, character) =>
        width +
        (/\s/.test(character)
          ? ctx.measureText(character).width
          : widestReplacement),
      0,
    ) +
    Math.max(0, characters.length - 1) * Math.max(0, tracking)
  return Math.ceil(Math.max(0, replacementWidth - originalWidth) / 2)
}

function scrambleWrappedHeightOverflowPadding(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  tracking: number,
  originalHeight: number,
  lineHeightPx: number,
  widestReplacementCharacter: string,
): number {
  if (!widestReplacementCharacter) return 0
  const widestText = Array.from(text)
    .map((character) =>
      /\s/.test(character) ? character : widestReplacementCharacter,
    )
    .join('')
  const widestHeight =
    layoutCanvasTextLines(ctx, widestText, maxWidth, tracking).length *
    lineHeightPx
  return Math.ceil(Math.max(0, widestHeight - originalHeight))
}

function scrambleWrappedWidthOverflowPadding(
  text: string,
  maxWidth: number,
  tracking: number,
  widestReplacement: number,
  align: Extract<Node, { kind: 'text' }>['textAlign'],
): number {
  const longestTokenLength = text
    .split(/\s+/)
    .reduce(
      (longest, token) => Math.max(longest, Array.from(token).length),
      0,
    )
  const widestTokenWidth =
    longestTokenLength * widestReplacement +
    Math.max(0, longestTokenLength - 1) * Math.max(0, tracking)
  const overflow = Math.max(0, widestTokenWidth - maxWidth)
  return Math.ceil(align === 'center' ? overflow / 2 : overflow)
}

function packTextSegmentAtlas(
  pending: readonly PendingTextSegmentEntry[],
  scale: number,
  maximumSize: number,
): {
  width: number
  height: number
  scale: number
  entries: PackedTextSegmentEntry[]
} | null {
  if (pending.length === 0) {
    return { width: 1, height: 1, scale, entries: [] }
  }
  const gutter = 2
  const sizes = pending.map((entry) => ({
    width: Math.max(1, Math.ceil((entry.width + entry.padding * 2) * scale)),
    height: Math.max(1, Math.ceil((entry.height + entry.padding * 2) * scale)),
  }))
  const maximumCellWidth = Math.max(...sizes.map((size) => size.width + gutter * 2))
  const totalArea = sizes.reduce(
    (sum, size) => sum + (size.width + gutter * 2) * (size.height + gutter * 2),
    0,
  )
  const width = Math.min(
    maximumSize,
    alignTextureDimension(
      Math.max(maximumCellWidth, Math.ceil(Math.sqrt(totalArea * 1.35))),
    ),
  )
  if (maximumCellWidth > width) return null

  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  const placements: Array<{
    x: number
    y: number
    width: number
    height: number
  }> = []
  sizes.forEach((size) => {
    const cellWidth = size.width + gutter * 2
    const cellHeight = size.height + gutter * 2
    if (cursorX > 0 && cursorX + cellWidth > width) {
      cursorX = 0
      cursorY += rowHeight
      rowHeight = 0
    }
    placements.push({
      x: cursorX + gutter,
      y: cursorY + gutter,
      width: size.width,
      height: size.height,
    })
    cursorX += cellWidth
    rowHeight = Math.max(rowHeight, cellHeight)
  })
  const height = alignTextureDimension(Math.max(1, cursorY + rowHeight))
  if (height > maximumSize) return null
  const entries = pending.map((entry, index): PackedTextSegmentEntry => {
    const placement = placements[index]!
    return {
      entry: {
        ...entry,
        uv: {
          minX: placement.x / width,
          minY: placement.y / height,
          maxX: (placement.x + placement.width) / width,
          maxY: (placement.y + placement.height) / height,
        },
      },
      destinationX: placement.x,
      destinationY: placement.y,
      destinationWidth: placement.width,
      destinationHeight: placement.height,
    }
  })
  return { width, height, scale, entries }
}

function paintTextSegmentAtlasCell(
  target: CanvasRenderingContext2D,
  scratch: HTMLCanvasElement,
  packed: PackedTextSegmentEntry,
  node: Extract<Node, { kind: 'text' }>,
  rect: Rect,
  anim: AnimatedValue | undefined,
  config: TextAnimationConfig | null,
  playhead: number,
  scale: number,
  animatedCount: number,
) {
  const entry = packed.entry
  const ctx = scratch.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, scratch.width, scratch.height)
  ctx.scale(scale, scale)

  if (entry.source === 'decoration') {
    const stroke = node.appearance.stroke
    if (stroke && stroke.width > 0) {
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      applyCanvasStrokePattern(ctx, stroke)
      roundedRectPath(
        ctx,
        stroke.width / 2,
        stroke.width / 2,
        rect.width - stroke.width,
        rect.height - stroke.width,
        Math.max(
          0,
          (node.appearance.cornerRadius ?? 0) - stroke.width / 2,
        ),
      )
      ctx.stroke()
    }
  } else {
    configureCanvasTextContext(ctx, node)
    ctx.fillStyle = '#ffffff'
    const fontSize = node.fontSize ?? 16
    const lineHeight = node.lineHeight ?? 1.2
    const lineHeightPx = Math.max(1, fontSize * lineHeight)
    const authoredTracking = Number.isFinite(node.letterSpacing)
      ? node.letterSpacing
      : 0
    const orderIndex =
      config?.order === 'backward'
        ? animatedCount - entry.order - 1
        : entry.order
    const state = config
      ? canvasTextSegmentState(
          config,
          playhead,
          anim?.textProgress,
          orderIndex,
          animatedCount,
          lineHeightPx,
        )
      : null
    const tracking =
      authoredTracking +
      (config?.id === 'tracking' ? state?.extraTracking ?? 0 : 0)
    let renderedText = entry.text
    if (config?.applyTo === 'layer') {
      const progress = textAnimationProgress(
        config,
        anim?.textProgress,
        playhead,
      )
      if (config.id === 'typewriter') {
        renderedText = typewriterTextAtProgress(
          entry.text,
          config.mode,
          progress,
        )
      } else if (config.id === 'scramble') {
        renderedText = scrambleTextForSegment(
          entry.text,
          config,
          playhead,
          anim?.textProgress,
          orderIndex,
          animatedCount,
        )
      }
      const textHeight =
        layoutCanvasTextLines(ctx, renderedText, rect.width, tracking).length *
        lineHeightPx
      const alignedY =
        node.textAlignVertical === 'center'
          ? Math.max(0, (rect.height - textHeight) / 2)
          : node.textAlignVertical === 'bottom'
            ? Math.max(0, rect.height - textHeight)
            : 0
      paintText(
        ctx,
        renderedText,
        entry.padding,
        entry.padding + alignedY,
        rect.width,
        fontSize,
        lineHeight,
        tracking,
        node.textAlign ?? 'start',
        node.textDecoration ?? 'none',
      )
    } else {
      if (config?.id === 'scramble') {
        renderedText = scrambleTextForSegment(
          renderedText,
          config,
          playhead,
          anim?.textProgress,
          orderIndex,
          animatedCount,
        )
      }
      const paintX =
        config?.id === 'scramble' &&
        (config.applyTo === 'letters' || config.applyTo === 'words')
          ? entry.padding +
            (entry.width - measureCanvasTextWidth(ctx, renderedText, tracking)) /
              2
          : entry.padding
      if (config?.applyTo === 'lines') {
        paintText(
          ctx,
          renderedText,
          entry.padding,
          entry.padding,
          entry.width,
          fontSize,
          lineHeight,
          tracking,
          node.textAlign ?? 'start',
          node.textDecoration ?? 'none',
        )
      } else {
        paintCanvasTextSegment(
          ctx,
          renderedText,
          paintX,
          entry.padding,
          tracking,
          fontSize,
          lineHeight,
        )
        paintCanvasTextDecoration(
          ctx,
          node.textDecoration ?? 'none',
          paintX,
          entry.padding,
          measureCanvasTextWidth(ctx, renderedText, tracking),
          fontSize,
          lineHeight,
        )
      }
    }

    ctx.globalCompositeOperation = 'source-in'
    ctx.save()
    // Paint fills in node coordinates so gradient/image fills stay continuous
    // even though each semantic segment owns an isolated atlas cell.
    ctx.translate(
      -(entry.x - entry.padding),
      -(entry.y - entry.padding),
    )
    const effectGradient =
      config?.id === 'gradient-reveal'
        ? config.mode === 'in'
          ? config.endGradient ?? config.startGradient
          : config.startGradient ?? config.endGradient
        : null
    if (effectGradient) {
      paintFill(ctx, effectGradient, rect.width, rect.height, true)
    } else if (anim?.fill) {
      ctx.fillStyle = anim.fill
      ctx.fillRect(0, 0, rect.width, rect.height)
    } else if (node.appearance.fill) {
      paintFill(ctx, node.appearance.fill, rect.width, rect.height, true)
    } else {
      ctx.fillStyle = node.color ?? '#111111'
      ctx.fillRect(0, 0, rect.width, rect.height)
    }
    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
  }

  target.drawImage(
    scratch,
    0,
    0,
    packed.destinationWidth,
    packed.destinationHeight,
    packed.destinationX,
    packed.destinationY,
    packed.destinationWidth,
    packed.destinationHeight,
  )
}

function alignTextureDimension(value: number): number {
  return Math.max(1, Math.ceil(value / 4) * 4)
}

function publishRender3dVideos(records: Map<NodeId, PlaneRecord>) {
  const win = window as Window & { [RENDER3D_VIDEO_REGISTRY]?: HTMLVideoElement[] }
  win[RENDER3D_VIDEO_REGISTRY] = [...records.values()]
    .map((record) => record.video)
    .filter((video): video is HTMLVideoElement => !!video)
}

function clearPlanes(scene: THREE.Scene, records: Map<NodeId, PlaneRecord>) {
  for (const [, record] of records) {
    scene.remove(record.mesh)
    scene.remove(record.outline)
    disposePlaneRecord(record)
    record.outline.geometry.dispose()
    ;(record.outline.material as THREE.Material).dispose()
  }
  records.clear()
  publishRender3dVideos(records)
}

function renderPlaneCanvas(
  api: SceneAPI,
  layout: SolvedLayout,
  plane: Plane3D,
  animated: Record<NodeId, AnimatedValue>,
  playhead: number,
): HTMLCanvasElement {
  return applyPlaneClipMask(
    renderSharpPlaneCanvas(api, layout, plane, animated, playhead),
    plane,
  )
}

function renderSharpPlaneCanvas(
  api: SceneAPI,
  layout: SolvedLayout,
  plane: Plane3D,
  animated: Record<NodeId, AnimatedValue>,
  playhead: number,
): HTMLCanvasElement {
  if (plane.contentMode === 'self') {
    return renderPlaneTexture(plane.node, plane.rect, animated[plane.nodeId], playhead)
  }
  return (
    renderSubtreeTexture(api, layout, plane.nodeId, plane.rect, plane, animated, playhead) ??
    renderPlaneTexture(plane.node, plane.rect, animated[plane.nodeId], playhead)
  )
}

function applyPlaneClipMask(canvas: HTMLCanvasElement, plane: Plane3D): HTMLCanvasElement {
  if (!plane.clips?.length) return canvas
  const scale = Number(canvas.dataset.textureScale || '1') || 1
  const maskPolygon = clippedPlaneLocalPolygon(plane)
  if (maskPolygon.length < 3) {
    const empty = document.createElement('canvas')
    empty.width = canvas.width
    empty.height = canvas.height
    empty.dataset.textureScale = String(scale)
    return empty
  }
  const output = document.createElement('canvas')
  output.width = canvas.width
  output.height = canvas.height
  output.dataset.textureScale = String(scale)
  const ctx = output.getContext('2d')
  if (!ctx) return canvas
  ctx.drawImage(canvas, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.beginPath()
  maskPolygon.forEach((point, index) => {
    const x = point.x * scale
    const y = point.y * scale
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.fillStyle = '#000'
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  return output
}

interface LocalPoint2D {
  x: number
  y: number
}

function clippedPlaneLocalPolygon(plane: Plane3D): LocalPoint2D[] {
  let polygon: LocalPoint2D[] = [
    { x: 0, y: 0 },
    { x: plane.rect.width, y: 0 },
    { x: plane.rect.width, y: plane.rect.height },
    { x: 0, y: plane.rect.height },
  ]
  for (const clip of plane.clips ?? []) {
    for (const boundary of clippingPlanesForClip(clip)) {
      polygon = clipLocalPolygonByWorldPlane(polygon, plane, boundary)
      if (polygon.length < 3) return []
    }
  }
  return polygon
}

function clipLocalPolygonByWorldPlane(
  polygon: LocalPoint2D[],
  plane: Plane3D,
  boundary: THREE.Plane,
): LocalPoint2D[] {
  const next: LocalPoint2D[] = []
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!
    const previous = polygon[(i + polygon.length - 1) % polygon.length]!
    const currentDistance = boundary.distanceToPoint(localPlanePointToWorld(plane, current))
    const previousDistance = boundary.distanceToPoint(localPlanePointToWorld(plane, previous))
    const currentInside = currentDistance >= -0.001
    const previousInside = previousDistance >= -0.001

    if (currentInside !== previousInside) {
      const denom = previousDistance - currentDistance
      const t = Math.abs(denom) < 0.0001 ? 0 : previousDistance / denom
      next.push({
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
      })
    }
    if (currentInside) next.push(current)
  }
  return next
}

function localPlanePointToWorld(plane: Plane3D, point: LocalPoint2D): THREE.Vector3 {
  const right = toThreeVector(plane.right).normalize()
  const down = toThreeVector(plane.down).normalize()
  return toThreeVector(plane.center)
    .addScaledVector(right, (point.x - plane.rect.width / 2) * plane.scaleX)
    .addScaledVector(down, (point.y - plane.rect.height / 2) * plane.scaleY)
}

function applyPlaneTransform(object: THREE.Object3D, plane: Plane3D) {
  object.position.set(plane.center.x, plane.center.y, plane.center.z)
  object.rotation.set(
    THREE.MathUtils.degToRad(plane.rotation.x),
    THREE.MathUtils.degToRad(plane.rotation.y),
    THREE.MathUtils.degToRad(plane.rotation.z),
    'XYZ',
  )
  object.scale.set(plane.scaleX, plane.scaleY, 1)
}

function applyMaterialBlendMode(
  material: THREE.MeshBasicMaterial,
  blendMode: BlendMode | undefined,
) {
  const mode = blendMode ?? 'normal'
  if (material.userData.hyperMotionBlendMode === mode) return
  material.userData.hyperMotionBlendMode = mode
  material.transparent = true
  material.premultipliedAlpha = false
  material.blendEquation = THREE.AddEquation
  material.blendSrc = THREE.SrcAlphaFactor
  material.blendDst = THREE.OneMinusSrcAlphaFactor
  material.blendEquationAlpha = THREE.AddEquation
  material.blendSrcAlpha = THREE.OneFactor
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor

  switch (mode) {
    case 'multiply':
      material.blending = THREE.MultiplyBlending
      break
    case 'screen':
    case 'lighten':
    case 'color-dodge':
      material.blending = THREE.CustomBlending
      material.blendSrc = THREE.SrcAlphaFactor
      material.blendDst = THREE.OneFactor
      break
    case 'darken':
    case 'color-burn':
      material.blending = THREE.CustomBlending
      material.blendEquation = THREE.MinEquation
      material.blendSrc = THREE.OneFactor
      material.blendDst = THREE.OneFactor
      break
    case 'difference':
    case 'exclusion':
      material.blending = THREE.SubtractiveBlending
      break
    case 'overlay':
    case 'hard-light':
    case 'soft-light':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      material.blending = THREE.NormalBlending
      break
    default:
      material.blending = THREE.NormalBlending
      break
  }
  material.needsUpdate = true
}

function syncMaterialClipping(record: PlaneRecord, plane: Plane3D) {
  const signature = clippingSignatureForPlane(plane)
  if (record.clipSignature === signature) return
  const material = record.mesh.material
  const previousCount = material.clippingPlanes?.length ?? 0
  const clippingPlanes = clippingPlanesForPlane(plane)
  material.clippingPlanes = clippingPlanes
  material.clipIntersection = true
  record.clipSignature = signature
  if (previousCount !== (clippingPlanes?.length ?? 0)) {
    material.needsUpdate = true
  }
}

function clippingSignatureForPlane(plane: Plane3D): string {
  if (!plane.clips?.length) return 'none'
  return plane.clips
    .map((clip) => [
      clip.center.x,
      clip.center.y,
      clip.center.z,
      clip.right.x,
      clip.right.y,
      clip.right.z,
      clip.down.x,
      clip.down.y,
      clip.down.z,
      clip.width,
      clip.height,
    ].map((value) => Number(value.toFixed(4))).join(','))
    .join('|')
}

function clippingPlanesForPlane(plane: Plane3D): THREE.Plane[] | null {
  if (!plane.clips?.length) return null
  return plane.clips.flatMap((clip) => clippingPlanesForClip(clip))
}

function clippingPlanesForClip(clip: PlaneClip3D): THREE.Plane[] {
  const right = toThreeVector(clip.right).normalize()
  const down = toThreeVector(clip.down).normalize()
  const center = toThreeVector(clip.center)
  const halfW = clip.width / 2
  const halfH = clip.height / 2
  const leftPoint = center.clone().addScaledVector(right, -halfW)
  const rightPoint = center.clone().addScaledVector(right, halfW)
  const topPoint = center.clone().addScaledVector(down, -halfH)
  const bottomPoint = center.clone().addScaledVector(down, halfH)
  return [
    new THREE.Plane().setFromNormalAndCoplanarPoint(right, leftPoint),
    new THREE.Plane().setFromNormalAndCoplanarPoint(right.clone().negate(), rightPoint),
    new THREE.Plane().setFromNormalAndCoplanarPoint(down, topPoint),
    new THREE.Plane().setFromNormalAndCoplanarPoint(down.clone().negate(), bottomPoint),
  ]
}

function makePlaneOutline(width: number, height: number): THREE.LineSegments {
  const outline = new THREE.LineSegments(
    makePlaneOutlineGeometry(width, height),
    new THREE.LineBasicMaterial({ color: 0x0a84ff, depthTest: false }),
  )
  outline.userData.hyperMotionOutlineSize = { width, height }
  return outline
}

function makePlaneOutlineGeometry(width: number, height: number): THREE.BufferGeometry {
  const hw = width / 2
  const hh = height / 2
  const points = new Float32Array([
    -hw, -hh, 1, hw, -hh, 1,
    hw, -hh, 1, hw, hh, 1,
    hw, hh, 1, -hw, hh, 1,
    -hw, hh, 1, -hw, -hh, 1,
  ])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
  return geometry
}

function syncHelpers(
  group: THREE.Group | null,
  camera: ResolvedCamera3D,
  width: number,
  height: number,
  show: boolean,
  focusWorldPoint: { x: number; y: number; z: number } | null,
) {
  if (!group) return
  group.visible = show
  if (!show) return
  const bundle = ensureHelperBundle(group, width, height)
  syncThreeCamera(bundle.camera, camera, width, height)
  bundle.frustum.update()

  const corners = cameraFrustumCorners(camera, { width, height }, camera.focusDistance)
  updateLinePositions(bundle.focusPlane.geometry, [
    corners[0]!,
    corners[1]!,
    corners[2]!,
    corners[3]!,
    corners[0]!,
  ])
  const focusCenter = focusWorldPoint ?? {
    x: (corners[0]!.x + corners[2]!.x) / 2,
    y: (corners[0]!.y + corners[2]!.y) / 2,
    z: (corners[0]!.z + corners[2]!.z) / 2,
  }
  updateLinePositions(bundle.focusLine.geometry, [camera.position, focusCenter])
  bundle.marker.position.set(focusCenter.x, focusCenter.y, focusCenter.z)
}

function ensureHelperBundle(
  group: THREE.Group,
  width: number,
  height: number,
): HelperBundle {
  const existing = helperBundles.get(group)
  if (existing && existing.width === width && existing.height === height) {
    return existing
  }
  if (existing) clearHelperGroup(group)

  const grid = new THREE.GridHelper(Math.max(width, height), 24, 0x9ca3af, 0xd1d5db)
  grid.rotation.x = Math.PI / 2
  grid.position.set(width / 2, height / 2, -400)
  grid.renderOrder = 200000
  for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
    material.depthTest = false
  }
  group.add(grid)

  const helperCamera = new THREE.PerspectiveCamera(
    35,
    width / Math.max(1, height),
    1,
    2400,
  )
  const frustum = new THREE.CameraHelper(helperCamera)
  ;(frustum.material as THREE.LineBasicMaterial).color.set(0x94a3b8)
  ;(frustum.material as THREE.LineBasicMaterial).depthTest = false
  frustum.renderOrder = 200001
  group.add(frustum)

  const focusGeometry = geometryWithPointCapacity(5)
  const focusPlane = new THREE.Line(
    focusGeometry,
    new THREE.LineBasicMaterial({ color: 0x0a84ff, depthTest: false, transparent: true, opacity: 0.8 }),
  )
  focusPlane.frustumCulled = false
  focusPlane.renderOrder = 200002
  group.add(focusPlane)

  const focusLine = new THREE.Line(
    geometryWithPointCapacity(2),
    new THREE.LineBasicMaterial({ color: 0x0a84ff, depthTest: false }),
  )
  focusLine.frustumCulled = false
  focusLine.renderOrder = 200002
  group.add(focusLine)
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(8, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0x0a84ff, depthTest: false }),
  )
  marker.frustumCulled = false
  marker.renderOrder = 200003
  group.add(marker)

  const bundle = {
    width,
    height,
    camera: helperCamera,
    frustum,
    focusPlane,
    focusLine,
    marker,
  }
  helperBundles.set(group, bundle)
  return bundle
}

function geometryWithPointCapacity(pointCount: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3),
  )
  return geometry
}

function updateLinePositions(
  geometry: THREE.BufferGeometry,
  points: Array<{ x: number; y: number; z: number }>,
) {
  const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
  points.forEach((point, index) => {
    attribute.setXYZ(index, point.x, point.y, point.z)
  })
  attribute.needsUpdate = true
}

function clearHelperGroup(group: THREE.Group) {
  group.traverse((object) => {
    const disposable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    disposable.geometry?.dispose()
    if (Array.isArray(disposable.material)) {
      for (const material of disposable.material) material.dispose()
    } else {
      disposable.material?.dispose()
    }
  })
  group.clear()
  helperBundles.delete(group)
}

function renderPlaneTexture(
  node: Node,
  rect: Rect,
  anim: AnimatedValue | undefined,
  playhead: number,
): HTMLCanvasElement {
  const w = Math.max(1, Math.ceil(rect.width))
  const h = Math.max(1, Math.ceil(rect.height))
  const scale = textureScaleForRect(rect)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(w * scale))
  canvas.height = Math.max(1, Math.ceil(h * scale))
  canvas.dataset.textureScale = String(scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.clearRect(0, 0, w, h)
  const cornerRadius =
    node.kind === 'ellipse'
      ? Math.min(w, h) / 2
      : Math.max(0, Math.min(node.appearance.cornerRadius ?? 0, Math.min(w, h) / 2))
  withRoundedClip(ctx, w, h, cornerRadius, () => {
    paintFill(ctx, node.appearance.fill, w, h, node.kind === 'text')
    if (node.kind === 'image' && node.src) {
      paintImageNode(ctx, node, w, h)
    }
  })
  if (node.kind === 'text') {
    paintAnimatedTextNode(ctx, node, 0, 0, w, h, anim, playhead)
  }
  const stroke = node.appearance.stroke
  if (stroke && stroke.width > 0) {
    ctx.save()
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    applyCanvasStrokePattern(ctx, stroke)
    roundedRectPath(
      ctx,
      stroke.width / 2,
      stroke.width / 2,
      w - stroke.width,
      h - stroke.width,
      Math.max(0, cornerRadius - stroke.width / 2),
    )
    ctx.stroke()
    ctx.restore()
  }
  return canvas
}

function renderSubtreeTexture(
  api: SceneAPI,
  layout: SolvedLayout,
  rootId: NodeId,
  rootRect: Rect,
  rootPlane?: Plane3D,
  animated: Record<NodeId, AnimatedValue> = {},
  playhead = 0,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const width = Math.max(1, Math.ceil(rootRect.width))
  const height = Math.max(1, Math.ceil(rootRect.height))
  const scale = textureScaleForRect(rootRect)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  canvas.dataset.textureScale = String(scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.clearRect(0, 0, width, height)
  const paint = (id: NodeId, context: SubtreeTransformContext) => {
    const node = api.getNode(id)
    const rect = layout[id]
    if (!node || !rect || node.kind === 'camera' || !node.visible) return
    if (id !== rootId && rootPlane && shouldSkipExtractedVideoStackNode(api, rootPlane, id)) {
      return
    }
    const extracted3D = id !== rootId && isExtractable3DNode(api, id, rootId, node)
    if (extracted3D) return
    const applyOwnTransform = id !== rootId
    const inherited = subtreeInheritedForNode(rect, context)
    paintNodeIntoSubtree(
      ctx,
      node,
      rect,
      rootRect,
      animated[id],
      playhead,
      applyOwnTransform,
      inherited,
    )
    const childContext = subtreeChildContext(node, rect, context, animated[id], applyOwnTransform)
    if (node.kind === 'frame' && node.clipsContent) {
      withNodeClipInSubtree(ctx, node, rect, rootRect, animated[id], applyOwnTransform, inherited, () => {
        for (const child of node.children) paint(child, childContext)
      })
      return
    }
    for (const child of node.children) paint(child, childContext)
  }
  paint(rootId, IDENTITY_SUBTREE_TRANSFORM)
  return canvas
}

function shouldSkipExtractedVideoStackNode(
  api: SceneAPI,
  rootPlane: Plane3D,
  id: NodeId,
): boolean {
  const node = api.getNode(id)
  if (!node?.parent) return false
  if (!isDescendantOf(api, id, rootPlane.nodeId)) return false
  const parent = api.getNode(node.parent)
  if (!parent) return false
  return parent.children.some((childId) => api.getNode(childId)?.kind === 'video')
}

function isDescendantOf(api: SceneAPI, id: NodeId, ancestorId: NodeId): boolean {
  let current = api.getNode(id)
  while (current?.parent) {
    if (current.parent === ancestorId) return true
    current = api.getNode(current.parent)
  }
  return false
}

function isExtractable3DNode(
  api: SceneAPI,
  id: NodeId,
  rootId: NodeId,
  node: Node,
): boolean {
  void rootId
  if (textNodeNeedsSegmentPlane(api, id)) return true
  const renderMode = node.transform.renderMode ?? 'flat'
  return renderMode === 'plane' || renderMode === 'group3d'
}

function subtreeInheritedForNode(
  rect: Rect,
  context: SubtreeTransformContext,
): SubtreeTransformContext {
  const topLeft = transformPoint2D(context.matrix, rect.x, rect.y)
  return {
    ...context,
    x: topLeft.x - rect.x,
    y: topLeft.y - rect.y,
  }
}

function subtreeChildContext(
  node: Node,
  rect: Rect,
  context: SubtreeTransformContext,
  anim: AnimatedValue | undefined,
  applyOwnTransform: boolean,
): SubtreeTransformContext {
  if (!applyOwnTransform) return context
  const effX = anim?.x ?? node.transform.x
  const effY = anim?.y ?? node.transform.y
  const effZ = anim?.z ?? node.transform.z
  const effRot = anim?.rotation ?? node.transform.rotation
  const effScaleX = anim?.scaleX ?? node.transform.scaleX
  const effScaleY = anim?.scaleY ?? node.transform.scaleY
  const effOpacity = anim?.opacity ?? node.appearance.opacity
  const anchorX = anim?.anchorX ?? node.transform.anchorX ?? 0.5
  const anchorY = anim?.anchorY ?? node.transform.anchorY ?? 0.5
  const nodeMatrix = nodeMatrix2D(
    rect,
    effX,
    effY,
    effRot,
    effScaleX,
    effScaleY,
    anchorX,
    anchorY,
  )
  return {
    x: context.x + effX,
    y: context.y + effY,
    z: context.z + effZ,
    rotation: context.rotation + effRot,
    scaleX: context.scaleX * effScaleX,
    scaleY: context.scaleY * effScaleY,
    opacity: context.opacity * effOpacity,
    matrix: multiplyMatrix2D(context.matrix, nodeMatrix),
  }
}

function multiplyMatrix2D(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

function transformPoint2D(matrix: Matrix2D, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

function nodeMatrix2D(
  rect: Rect,
  tx: number,
  ty: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
  anchorX: number,
  anchorY: number,
): Matrix2D {
  const originX = rect.x + rect.width * anchorX
  const originY = rect.y + rect.height * anchorY
  const r = THREE.MathUtils.degToRad(rotation)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return multiplyMatrix2D(
    { ...IDENTITY_MATRIX_2D, e: tx, f: ty },
    multiplyMatrix2D(
      { ...IDENTITY_MATRIX_2D, e: originX, f: originY },
      multiplyMatrix2D(
        { a: c, b: s, c: -s, d: c, e: 0, f: 0 },
        multiplyMatrix2D(
          { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 },
          { ...IDENTITY_MATRIX_2D, e: -originX, f: -originY },
        ),
      ),
    ),
  )
}

function paintNodeIntoSubtree(
  ctx: CanvasRenderingContext2D,
  node: Node,
  rect: Rect,
  rootRect: Rect,
  anim: AnimatedValue | undefined,
  playhead: number,
  applyOwnTransform = true,
  inherited: SubtreeTransformContext = IDENTITY_SUBTREE_TRANSFORM,
) {
  const x = rect.x - rootRect.x
  const y = rect.y - rootRect.y
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  const tx = applyOwnTransform ? anim?.x ?? node.transform.x : 0
  const ty = applyOwnTransform ? anim?.y ?? node.transform.y : 0
  const rot = applyOwnTransform ? anim?.rotation ?? node.transform.rotation ?? 0 : 0
  const scaleX = applyOwnTransform ? anim?.scaleX ?? node.transform.scaleX ?? 1 : 1
  const scaleY = applyOwnTransform ? anim?.scaleY ?? node.transform.scaleY ?? 1 : 1
  ctx.save()
  // The emitted plane root's opacity is a GPU material uniform. Applying it
  // here as well would double the fade, while changing this bitmap every frame
  // defeats the realtime material path. Descendant nodes still compose their
  // own opacity into the flattened texture normally.
  const ownOpacity = applyOwnTransform
    ? anim?.opacity ?? node.appearance.opacity ?? 1
    : 1
  ctx.globalAlpha *= ownOpacity * inherited.opacity
  const previousComposite = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = canvasCompositeForBlendMode(
    node.appearance.blendMode,
  )
  ctx.translate(x + inherited.x + tx + w / 2, y + inherited.y + ty + h / 2)
  const inheritedRotation = inherited.rotation + rot
  if (inheritedRotation !== 0) ctx.rotate(THREE.MathUtils.degToRad(inheritedRotation))
  ctx.scale(inherited.scaleX * scaleX, inherited.scaleY * scaleY)
  ctx.translate(-w / 2, -h / 2)
  const localRect = { x: 0, y: 0, width: w, height: h }
  const nodeForPaint = node
  renderNodePaint(ctx, nodeForPaint, localRect, anim, playhead)
  ctx.globalCompositeOperation = previousComposite
  ctx.restore()
}

function canvasCompositeForBlendMode(
  blendMode: BlendMode | undefined,
): GlobalCompositeOperation {
  switch (blendMode) {
    case 'multiply':
    case 'screen':
    case 'overlay':
    case 'darken':
    case 'lighten':
    case 'color-dodge':
    case 'color-burn':
    case 'hard-light':
    case 'soft-light':
    case 'difference':
    case 'exclusion':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return blendMode
    default:
      return 'source-over'
  }
}

function withNodeClipInSubtree(
  ctx: CanvasRenderingContext2D,
  node: Node,
  rect: Rect,
  rootRect: Rect,
  anim: AnimatedValue | undefined,
  applyOwnTransform: boolean,
  inherited: SubtreeTransformContext,
  paint: () => void,
) {
  const x = rect.x - rootRect.x
  const y = rect.y - rootRect.y
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  const cornerRadius =
    node.kind === 'ellipse'
      ? Math.min(w, h) / 2
      : Math.max(0, Math.min(anim?.cornerRadius ?? node.appearance.cornerRadius ?? 0, Math.min(w, h) / 2))
  const currentTransform = ctx.getTransform()
  ctx.save()
  const tx = applyOwnTransform ? anim?.x ?? node.transform.x : 0
  const ty = applyOwnTransform ? anim?.y ?? node.transform.y : 0
  const rot = applyOwnTransform ? anim?.rotation ?? node.transform.rotation ?? 0 : 0
  const scaleX = applyOwnTransform ? anim?.scaleX ?? node.transform.scaleX ?? 1 : 1
  const scaleY = applyOwnTransform ? anim?.scaleY ?? node.transform.scaleY ?? 1 : 1
  ctx.translate(x + inherited.x + tx + w / 2, y + inherited.y + ty + h / 2)
  const inheritedRotation = inherited.rotation + rot
  if (inheritedRotation !== 0) ctx.rotate(THREE.MathUtils.degToRad(inheritedRotation))
  ctx.scale(inherited.scaleX * scaleX, inherited.scaleY * scaleY)
  roundedRectPath(ctx, -w / 2, -h / 2, w, h, cornerRadius)
  ctx.clip()
  ctx.setTransform(currentTransform)
  paint()
  ctx.restore()
}

function renderNodePaint(
  ctx: CanvasRenderingContext2D,
  node: Node,
  rect: Rect,
  anim: AnimatedValue | undefined,
  playhead: number,
) {
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  const cornerRadius =
    node.kind === 'ellipse'
      ? Math.min(w, h) / 2
      : Math.max(0, Math.min(node.appearance.cornerRadius ?? 0, Math.min(w, h) / 2))
  withRoundedClip(ctx, w, h, cornerRadius, () => {
    paintFill(ctx, node.appearance.fill, w, h, node.kind === 'text')
    if (node.kind === 'image' && node.src) paintImageNode(ctx, node, w, h)
  })
  if (node.kind === 'text') {
    paintAnimatedTextNode(ctx, node, 0, 0, w, h, anim, playhead)
  }
  const stroke = node.appearance.stroke
  if (stroke && stroke.width > 0) {
    ctx.save()
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    applyCanvasStrokePattern(ctx, stroke)
    roundedRectPath(
      ctx,
      stroke.width / 2,
      stroke.width / 2,
      w - stroke.width,
      h - stroke.width,
      Math.max(0, cornerRadius - stroke.width / 2),
    )
    ctx.stroke()
    ctx.restore()
  }
}

function toThreeVector(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z)
}


function paintFill(
  ctx: CanvasRenderingContext2D,
  fill: Fill | null,
  width: number,
  height: number,
  transparentWhenEmpty = false,
) {
  if (!fill) {
    if (transparentWhenEmpty) return
    ctx.fillStyle = 'rgba(255,255,255,0.001)'
    ctx.fillRect(0, 0, width, height)
    return
  }
  if (fill.kind === 'solid') {
    ctx.fillStyle = fill.color
    ctx.fillRect(0, 0, width, height)
    return
  }
  if (fill.kind === 'linear') {
    ctx.fillStyle = canvasLinearGradient(ctx, fill, width, height)
    ctx.fillRect(0, 0, width, height)
    return
  }
  if (fill.kind === 'radial') {
    ctx.fillStyle = canvasRadialGradient(ctx, fill, width, height)
    ctx.fillRect(0, 0, width, height)
    return
  }
  if (fill.kind === 'conic') {
    ctx.fillStyle = canvasConicGradient(ctx, fill, width, height)
    ctx.fillRect(0, 0, width, height)
    return
  }
  if (fill.kind === 'image') {
    paintImageFill(ctx, fill, width, height)
    return
  }
}

function canvasLinearGradient(
  ctx: CanvasRenderingContext2D,
  fill: Extract<Fill, { kind: 'linear' }>,
  width: number,
  height: number,
): CanvasGradient {
  const rad = THREE.MathUtils.degToRad(fill.angle)
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const len = Math.abs(width * dx) + Math.abs(height * dy)
  const cx = width / 2
  const cy = height / 2
  const gradient = ctx.createLinearGradient(
    cx - (dx * len) / 2,
    cy - (dy * len) / 2,
    cx + (dx * len) / 2,
    cy + (dy * len) / 2,
  )
  addCanvasStops(gradient, fill.stops)
  return gradient
}

function canvasRadialGradient(
  ctx: CanvasRenderingContext2D,
  fill: Extract<Fill, { kind: 'radial' }>,
  width: number,
  height: number,
): CanvasGradient {
  const cx = fill.cx * width
  const cy = fill.cy * height
  const radius =
    fill.shape === 'circle'
      ? Math.max(width, height) / 2
      : Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy))
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, radius))
  addCanvasStops(gradient, fill.stops)
  return gradient
}

function canvasConicGradient(
  ctx: CanvasRenderingContext2D,
  fill: Extract<Fill, { kind: 'conic' }>,
  width: number,
  height: number,
): CanvasGradient {
  const createConic = (
    ctx as CanvasRenderingContext2D & {
      createConicGradient?: (startAngle: number, x: number, y: number) => CanvasGradient
    }
  ).createConicGradient
  if (createConic) {
    const gradient = createConic.call(
      ctx,
      THREE.MathUtils.degToRad(fill.angle - 90),
      fill.cx * width,
      fill.cy * height,
    )
    addCanvasStops(gradient, fill.stops)
    return gradient
  }
  return canvasLinearGradient(
    ctx,
    { kind: 'linear', angle: fill.angle, stops: fill.stops },
    width,
    height,
  )
}

function addCanvasStops(gradient: CanvasGradient, stops: GradientStop[]) {
  if (!stops.length) {
    gradient.addColorStop(0, '#000000')
    gradient.addColorStop(1, '#000000')
    return
  }
  for (const stop of stops) {
    gradient.addColorStop(Math.max(0, Math.min(1, stop.at)), stop.color)
  }
}

function parseCanvasSolidColor(css: string): string | null {
  const value = css.trim()
  if (!value || value.includes('gradient(') || value.startsWith('url(')) {
    return null
  }
  const cached = parsedCanvasColorCache.get(value)
  if (cached !== undefined || parsedCanvasColorCache.has(value)) return cached ?? null

  // Camera-only playback calls `syncBackground` every display frame. The old
  // parser allocated a fresh canvas/context for the unchanged fill each time,
  // creating hundreds of short-lived GPU-backed objects during Space-bar
  // playback. Keep one tiny parser context and cache the normalized result.
  if (canvasColorParserContext === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    canvasColorParserContext = canvas.getContext('2d')
  }
  const ctx = canvasColorParserContext
  if (!ctx) {
    parsedCanvasColorCache.set(value, value)
    return value
  }
  ctx.fillStyle = '#000000'
  ctx.fillStyle = value
  const parsed = ctx.fillStyle
  parsedCanvasColorCache.set(value, parsed)
  return parsed
}

function paintImageFill(
  ctx: CanvasRenderingContext2D,
  fill: Extract<Fill, { kind: 'image' }>,
  width: number,
  height: number,
) {
  const image = getCachedTextureImage(fill.src)
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    paintImagePlaceholder(ctx, width, height)
    return
  }
  const pseudoNode = {
    kind: 'image',
    src: fill.src,
    fit: fill.fit === 'tile' ? 'none' : fill.fit,
  } as Extract<Node, { kind: 'image' }>
  if (fill.fit === 'tile') {
    const pattern = ctx.createPattern(image, 'repeat')
    if (pattern) {
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, width, height)
      return
    }
  }
  paintImageNode(ctx, pseudoNode, width, height)
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function withRoundedClip(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
  paint: () => void,
) {
  ctx.save()
  roundedRectPath(ctx, 0, 0, width, height, radius)
  ctx.clip()
  paint()
  ctx.restore()
}

function configureCanvasTextContext(
  ctx: CanvasRenderingContext2D,
  node: Extract<Node, { kind: 'text' }>,
) {
  const fontSize = node.fontSize ?? 16
  const fontStyle = node.fontStyle ?? 'normal'
  const fontVariant =
    node.textCase === 'small-caps' || node.textCase === 'small-caps-forced'
      ? 'small-caps'
      : 'normal'
  const fontFamily = (node.fontFamily || 'Inter').replaceAll('"', '\\"')
  ctx.font = `${fontStyle} ${fontVariant} ${node.fontWeight ?? 400} ${fontSize}px "${fontFamily}"`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fontKerning = 'normal'
  ctx.fontStretch = 'normal'
  ctx.fontVariantCaps = fontVariant
  ctx.textRendering = 'geometricPrecision'
}

function paintAnimatedTextNode(
  ctx: CanvasRenderingContext2D,
  node: Extract<Node, { kind: 'text' }>,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  anim: AnimatedValue | undefined,
  playhead: number,
) {
  const config = previewedTextAnimation(
    node.id,
    anim?.textAnimation ?? node.textAnimation ?? null,
  )
  const fontSize = node.fontSize ?? 16
  const lineHeight = node.lineHeight ?? 1.2
  ctx.fillStyle = anim?.fill ?? node.color ?? '#111111'
  configureCanvasTextContext(ctx, node)
  const authoredTracking =
    Number.isFinite(node.letterSpacing) ? node.letterSpacing : 0
  const text = displayedText(node)
  const lineCount = layoutCanvasTextLines(ctx, text, maxWidth, authoredTracking).length
  const textHeight = Math.max(1, lineCount) * Math.max(1, fontSize * lineHeight)
  const alignedY =
    node.textAlignVertical === 'center'
      ? y + Math.max(0, (maxHeight - textHeight) / 2)
      : node.textAlignVertical === 'bottom'
        ? y + Math.max(0, maxHeight - textHeight)
        : y

  if (!config) {
    paintText(
      ctx,
      text,
      x,
      alignedY,
      maxWidth,
      fontSize,
      lineHeight,
      authoredTracking,
      node.textAlign ?? 'start',
      node.textDecoration ?? 'none',
    )
    return
  }

  const progress = textAnimationProgress(config, anim?.textProgress, playhead)
  const visibleProgress = config.mode === 'out' ? 1 - progress : progress
  if (config.applyTo !== 'layer') {
    paintSegmentedTextAnimation(
      ctx,
      node,
      config,
      x,
      alignedY,
      maxWidth,
      fontSize,
      lineHeight,
      authoredTracking,
      anim?.textProgress,
      playhead,
    )
    return
  }
  if (config.id === 'typewriter') {
    paintText(
      ctx,
      typewriterTextAtProgress(text, config.mode, progress),
      x,
      alignedY,
      maxWidth,
      fontSize,
      lineHeight,
      authoredTracking,
      node.textAlign ?? 'start',
      node.textDecoration ?? 'none',
    )
    return
  }
  if (config.id === 'scramble') {
    paintText(
      ctx,
      scrambleTextForSegment(
        text,
        config,
        playhead,
        anim?.textProgress,
        0,
        1,
      ),
      x,
      alignedY,
      maxWidth,
      fontSize,
      lineHeight,
      authoredTracking,
      node.textAlign ?? 'start',
      node.textDecoration ?? 'none',
    )
    return
  }

  const amount = config.mode === 'out' ? progress : 1 - progress
  const lineHeightPx = Math.max(1, fontSize * lineHeight)
  const travel = Math.max(1, lineHeightPx * (config.travelDistance ?? 0.7))
  const [dx, dy] = textDirectionOffset(config.direction ?? 'up', travel * amount)
  const spatialMotion = resolveTextSegmentMotion(
    config.motionPath,
    config.motionVector,
    lineHeightPx,
    amount,
  )
  ctx.save()
  if (
    config.id === 'fade' ||
    config.id === 'slide-up' ||
    config.id === 'slide-down' ||
    config.id === 'slide-left' ||
    config.id === 'slide-right' ||
    config.id === 'blur' ||
    config.id === 'blur-slide' ||
    config.id === 'grow' ||
    config.id === 'shrink' ||
    config.id === 'appear' ||
    config.id === 'skew' ||
    config.id === 'tracking'
  ) {
    ctx.globalAlpha *= config.id === 'appear' ? (visibleProgress >= 0.5 ? 1 : 0) : 1 - amount
  }
  if (spatialMotion) {
    ctx.translate(spatialMotion.x, spatialMotion.y)
  } else if (config.id.startsWith('slide') || config.id === 'blur-slide' || config.id === 'skew') {
    ctx.translate(dx, dy)
  }
  if (config.id === 'grow' || config.id === 'shrink') {
    const scale = config.id === 'grow' ? 1 - amount * 0.35 : 1 + amount * 0.35
    ctx.translate(x + maxWidth / 2, alignedY + lineHeightPx / 2)
    ctx.scale(scale, scale)
    ctx.translate(-(x + maxWidth / 2), -(alignedY + lineHeightPx / 2))
  }
  if (config.id === 'skew') {
    ctx.transform(1, 0, -0.25 * amount, 1, 0, 0)
  }
  if (config.id === 'tracking') {
    paintText(
      ctx,
      text,
      x,
      alignedY,
      maxWidth,
      fontSize,
      lineHeight,
      authoredTracking + Math.max(0, 10 * amount),
      node.textAlign ?? 'start',
      node.textDecoration ?? 'none',
    )
  } else {
    paintText(
      ctx,
      text,
      x,
      alignedY,
      maxWidth,
      fontSize,
      lineHeight,
      authoredTracking,
      node.textAlign ?? 'start',
      node.textDecoration ?? 'none',
    )
  }
  ctx.restore()
}

function paintSegmentedTextAnimation(
  ctx: CanvasRenderingContext2D,
  node: Extract<Node, { kind: 'text' }>,
  config: TextAnimationConfig,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  lineHeight: number,
  authoredTracking: number,
  timelineProgress: number | undefined,
  playhead: number,
) {
  const text = displayedText(node)
  const segments = layoutCanvasTextAnimationSegments(
    ctx,
    text,
    config.applyTo,
    x,
    y,
    maxWidth,
    fontSize,
    lineHeight,
    authoredTracking,
    node.textAlign ?? 'start',
  )
  const orderedCount = animatedTextSegmentCount(segments)
  const lineHeightPx = Math.max(1, fontSize * lineHeight)
  const motionRailOffsets = resolveCanvasTextMotionRailOffsets(
    segments,
    config,
    playhead,
    timelineProgress,
    orderedCount,
    lineHeightPx,
  )
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]!
    if (segment.text.length === 0 || /^\s+$/.test(segment.text)) continue
    if (!segment.animate) {
      paintCanvasTextSegment(ctx, segment.text, segment.x, segment.y, authoredTracking, fontSize, lineHeight)
      continue
    }

    const orderIndex = config.order === 'backward'
      ? orderedCount - segment.order - 1
      : segment.order
    const state = canvasTextSegmentState(
      config,
      playhead,
      timelineProgress,
      orderIndex,
      orderedCount,
      lineHeightPx,
    )
    if (state.opacity <= 0.001) continue

    ctx.save()
    ctx.globalAlpha *= state.opacity
    if (state.blur > 0.01) ctx.filter = `blur(${state.blur}px)`
    const cx = segment.x + segment.width / 2
    const cy = segment.y + segment.height / 2
    const railOffset = segmentIndex * 3
    const spatialMotion = motionRailOffsets
      ? {
          x: motionRailOffsets[railOffset]!,
          y: motionRailOffsets[railOffset + 1]!,
          z: motionRailOffsets[railOffset + 2]!,
        }
      : resolveTextSegmentMotion(
          config.motionPath,
          config.motionVector,
          lineHeightPx,
          state.amount,
        )
    const motionX = spatialMotion
      ? spatialMotion.x
      : state.dx
    const motionY = spatialMotion
      ? spatialMotion.y + state.waveOffset
      : state.dy
    if (motionX !== 0 || motionY !== 0) ctx.translate(motionX, motionY)
    if (state.skew !== 0) ctx.transform(1, 0, state.skew, 1, 0, 0)
    if (state.scale !== 1) {
      ctx.translate(cx, cy)
      ctx.scale(state.scale, state.scale)
      ctx.translate(-cx, -cy)
    }
    const text = scrambleTextForSegment(
      segment.text,
      config,
      playhead,
      timelineProgress,
      orderIndex,
      orderedCount,
    )
    const trackingShift =
      state.extraTracking *
      (segment.trackingIndex -
        Math.max(0, segment.lineCharacterCount - 1) *
          segment.trackingAlignment)
    const paintX = segment.x + trackingShift
    if (config.applyTo === 'lines') {
      paintText(
        ctx,
        text,
        segment.x,
        segment.y,
        segment.width,
        fontSize,
        lineHeight,
        authoredTracking + state.extraTracking,
        node.textAlign ?? 'start',
        node.textDecoration ?? 'none',
      )
    } else {
      paintCanvasTextSegment(
        ctx,
        text,
        paintX,
        segment.y,
        authoredTracking + state.extraTracking,
        fontSize,
        lineHeight,
      )
      paintCanvasTextDecoration(
        ctx,
        node.textDecoration ?? 'none',
        paintX,
        segment.y,
        segment.width +
          Math.max(0, Array.from(text).length - 1) * state.extraTracking,
        fontSize,
        lineHeight,
      )
    }
    ctx.restore()
  }
}

function resolveCanvasTextMotionRailOffsets(
  segments: readonly CanvasTextAnimationSegment[],
  config: TextAnimationConfig,
  playhead: number,
  timelineProgress: number | undefined,
  animatedCount: number,
  lineHeightPx: number,
): Float64Array | null {
  if (
    !config.motionPath ||
    (config.applyTo !== 'letters' && config.applyTo !== 'words')
  ) {
    return null
  }

  const runs = new Map<number, TextMotionRailSegment[]>()
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    if (!segment.animate) continue
    const sequence =
      config.order === 'backward'
        ? animatedCount - segment.order - 1
        : segment.order
    const railSegment: TextMotionRailSegment = {
      index,
      sequence,
      baseline: {
        x: segment.x + segment.width / 2,
        y: segment.y + segment.height / 2,
        z: 0,
      },
    }
    const run = runs.get(segment.visualLineIndex)
    if (run) run.push(railSegment)
    else runs.set(segment.visualLineIndex, [railSegment])
  }

  if (runs.size === 0) return null
  const output = new Float64Array(segments.length * 3)
  for (const run of runs.values()) {
    let firstSequence = Number.POSITIVE_INFINITY
    for (const segment of run) {
      firstSequence = Math.min(firstSequence, segment.sequence)
    }
    const amount = resolveTextMotionRailAmount(
      config,
      playhead,
      timelineProgress,
      animatedCount,
      firstSequence,
      run.length,
    )
    resolveTextMotionRailOffsets(
      config.motionPath,
      lineHeightPx,
      amount,
      config.mode,
      run,
      output,
    )
  }
  return output
}

function layoutCanvasTextAnimationSegments(
  ctx: CanvasRenderingContext2D,
  text: string,
  applyTo: TextAnimationConfig['applyTo'],
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  lineHeight: number,
  tracking: number,
  align: Extract<Node, { kind: 'text' }>['textAlign'],
) {
  const lineHeightPx = Math.max(1, fontSize * lineHeight)
  // The caller routes whole-layer effects through paintText(). Keep this
  // guard here as a type/runtime backstop for malformed legacy documents.
  if (applyTo === 'layer') return []
  return computeCanvasTextAnimationSegments({
    text,
    applyTo,
    x,
    y,
    maxWidth,
    lineHeightPx,
    align,
    measure: (value) => measureCanvasTextWidth(ctx, value, tracking),
  })
}

function canvasTextSegmentState(
  config: TextAnimationConfig,
  playhead: number,
  timelineProgress: number | undefined,
  orderIndex: number,
  count: number,
  lineHeightPx: number,
) {
  const totalSpan = config.duration + Math.max(0, count - 1) * config.delay
  const globalElapsed = timelineProgress === undefined
    ? playhead - config.startTime
    : Math.max(0, Math.min(1, timelineProgress)) * totalSpan
  const linearProgress = textSegmentLinearProgress(
    globalElapsed,
    config.duration,
    config.delay,
    orderIndex,
    count,
  )
  const envelopeProgress = textSegmentEnvelopeProgress(
    globalElapsed,
    config.duration,
    config.delay,
    orderIndex,
    count,
    config.smoothing,
    config.staggerCurve,
  )
  const localProgress = timelineProgress === undefined
    ? easeTextAnimationProgress(envelopeProgress, config.acceleration)
    : envelopeProgress
  const exit = config.mode === 'out'
  const amount = exit ? localProgress : 1 - localProgress
  const visibleProgress = exit ? 1 - localProgress : localProgress
  const travel = Math.max(1, lineHeightPx * config.travelDistance)
  const [legacyDx, legacyDy] = textDirectionOffset(
    config.direction,
    travel * amount,
  )
  let opacity = 1
  let blur = 0
  let scale = 1
  let skew = 0
  let extraTracking = 0

  if (
    config.id === 'fade' ||
    config.id.startsWith('slide') ||
    config.id === 'blur-slide' ||
    config.id === 'blur' ||
    config.id === 'grow' ||
    config.id === 'shrink' ||
    config.id === 'flip' ||
    config.id === 'skew' ||
    config.id === 'tracking' ||
    config.id === 'character-wave' ||
    config.id === 'color-fade' ||
    config.id === 'gradient-reveal' ||
    config.id === 'mask-up' ||
    config.id === 'mask-down'
  ) {
    opacity = 1 - amount
  }
  if (
    config.id === 'appear' ||
    (config.id === 'typewriter' && config.applyTo !== 'layer')
  ) {
    opacity = visibleProgress >= 0.5 ? 1 : 0
  }
  if (config.id === 'blur' || config.id === 'blur-slide') {
    blur = config.blurRadius * amount
  }
  if (config.id === 'grow') scale = 1 - amount * 0.35
  if (config.id === 'shrink') scale = 1 + amount * 0.35
  if (config.id === 'skew') skew = -0.25 * amount
  if (config.id === 'tracking') extraTracking = Math.max(0, 10 * amount)
  if (config.id === 'character-wave') opacity = 1 - amount * 0.35
  if (
    config.id === 'mask-up' ||
    config.id === 'mask-down' ||
    config.id === 'gradient-reveal'
  ) {
    opacity = 1
  }
  const waveOffset =
    config.id === 'character-wave'
      ? Math.sin((linearProgress + orderIndex / Math.max(1, count - 1)) * Math.PI * 2) * 8 * amount
      : 0

  return {
    amount,
    opacity,
    blur,
    scale,
    skew,
    extraTracking,
    waveOffset,
    dx: textAnimationUsesLegacyTranslation(config.id)
      ? legacyDx
      : 0,
    dy: (textAnimationUsesLegacyTranslation(config.id)
      ? legacyDy
      : 0) + waveOffset,
    localProgress,
  }
}

function paintCanvasTextSegment(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  fontSize: number,
  lineHeight: number,
) {
  if (tracking !== 0) {
    paintTrackedText(ctx, text, x, y, tracking, fontSize, lineHeight)
  } else {
    ctx.fillText(text, x, canvasTextBaseline(ctx, y, fontSize, lineHeight))
  }
}

/**
 * Canvas2D's `top` baseline places glyphs against the font em box, which is
 * not how Figma distributes leading inside a fixed line-height. Position an
 * alphabetic baseline from the font's ascent/descent and split any remaining
 * leading evenly above and below the font box, matching CSS/Figma line boxes.
 */
function canvasTextBaseline(
  ctx: CanvasRenderingContext2D,
  lineTop: number,
  fontSize: number,
  lineHeight: number,
): number {
  const metrics = ctx.measureText('Hg')
  const ascent =
    metrics.fontBoundingBoxAscent ||
    metrics.actualBoundingBoxAscent ||
    fontSize * 0.8
  const descent =
    metrics.fontBoundingBoxDescent ||
    metrics.actualBoundingBoxDescent ||
    fontSize * 0.2
  const lineHeightPx = Math.max(1, fontSize * lineHeight)
  const leading = Math.max(0, lineHeightPx - ascent - descent)
  return lineTop + leading / 2 + ascent
}

function textAnimationProgress(
  config: TextAnimationConfig,
  progress: number | undefined,
  playhead: number,
): number {
  if (progress !== undefined) return Math.max(0, Math.min(1, progress))
  const elapsed = playhead - config.startTime
  return Math.max(0, Math.min(1, elapsed / Math.max(0.05, config.duration)))
}

function textAnimationSegmentCount(
  text: string,
  applyTo: TextAnimationConfig['applyTo'],
): number {
  if (applyTo === 'layer') return 1
  if (applyTo === 'lines') {
    return Math.max(1, text.split('\n').filter(Boolean).length)
  }
  if (applyTo === 'words') {
    return Math.max(1, text.split(/\s+/).filter(Boolean).length)
  }
  return Math.max(
    1,
    Array.from(text).filter((character) => !/\s/.test(character))
      .length,
  )
}

function animatedTextSegmentCount(
  entries: readonly { animate: boolean; order: number }[],
): number {
  let count = 1
  for (const entry of entries) {
    if (entry.animate) count = Math.max(count, entry.order + 1)
  }
  return count
}

function textDirectionOffset(direction: string, distance: number): [number, number] {
  switch (direction) {
    case 'down':
      return [0, -distance]
    case 'left':
      return [distance, 0]
    case 'right':
      return [-distance, 0]
    case 'up':
    default:
      return [0, distance]
  }
}

function paintTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  fontSize: number,
  lineHeight: number,
) {
  const lineHeightPx = Math.max(1, fontSize * lineHeight)
  let cursorX = x
  let lineTop = y
  let cursorY = canvasTextBaseline(ctx, lineTop, fontSize, lineHeight)
  for (const char of Array.from(text)) {
    if (char === '\n') {
      cursorX = x
      lineTop += lineHeightPx
      cursorY = canvasTextBaseline(ctx, lineTop, fontSize, lineHeight)
      continue
    }
    ctx.fillText(char, cursorX, cursorY)
    cursorX += ctx.measureText(char).width + tracking
  }
}

function paintText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  lineHeight: number,
  tracking = 0,
  align: Extract<Node, { kind: 'text' }>['textAlign'] = 'start',
  decoration: Extract<Node, { kind: 'text' }>['textDecoration'] = 'none',
) {
  const lineHeightPx = Math.max(1, fontSize * lineHeight)
  const lines = layoutCanvasTextLines(ctx, text, maxWidth, tracking)
  lines.forEach((line, i) => {
    const lineY = y + i * lineHeightPx
    const naturalWidth = measureCanvasTextWidth(ctx, line.text, tracking)
    if (align === 'justify' && line.canJustify) {
      paintJustifiedCanvasLine(
        ctx,
        line.text,
        x,
        lineY,
        maxWidth,
        tracking,
        fontSize,
        lineHeight,
      )
      paintCanvasTextDecoration(
        ctx,
        decoration,
        x,
        lineY,
        maxWidth,
        fontSize,
        lineHeight,
      )
      return
    }
    const lineX =
      align === 'center'
        ? x + Math.max(0, (maxWidth - naturalWidth) / 2)
        : align === 'end'
          ? x + Math.max(0, maxWidth - naturalWidth)
          : x
    if (tracking !== 0) {
      paintTrackedText(
        ctx,
        line.text,
        lineX,
        lineY,
        tracking,
        fontSize,
        lineHeight,
      )
    } else {
      ctx.fillText(
        line.text,
        lineX,
        canvasTextBaseline(ctx, lineY, fontSize, lineHeight),
      )
    }
    paintCanvasTextDecoration(
      ctx,
      decoration,
      lineX,
      lineY,
      naturalWidth,
      fontSize,
      lineHeight,
    )
  })
}

function layoutCanvasTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  tracking: number,
): CanvasTextLine[] {
  return computeCanvasTextLines(
    text,
    maxWidth,
    (value) => measureCanvasTextWidth(ctx, value, tracking),
  )
}

function paintJustifiedCanvasLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  tracking: number,
  fontSize: number,
  lineHeight: number,
) {
  const tokens = text.split(/(\s+)/).filter(Boolean)
  const whitespaceCount = tokens.filter((token) => /^\s+$/.test(token)).length
  const naturalWidth = tokens.reduce(
    (sum, token) => sum + measureCanvasTextWidth(ctx, token, tracking),
    0,
  )
  const extraPerGap =
    whitespaceCount > 0 ? Math.max(0, maxWidth - naturalWidth) / whitespaceCount : 0
  let cursorX = x
  for (const token of tokens) {
    if (!/^\s+$/.test(token)) {
      if (tracking !== 0) {
        paintTrackedText(ctx, token, cursorX, y, tracking, fontSize, lineHeight)
      } else {
        ctx.fillText(
          token,
          cursorX,
          canvasTextBaseline(ctx, y, fontSize, lineHeight),
        )
      }
    }
    cursorX +=
      measureCanvasTextWidth(ctx, token, tracking) +
      (/^\s+$/.test(token) ? extraPerGap : 0)
  }
}

function paintCanvasTextDecoration(
  ctx: CanvasRenderingContext2D,
  decoration: Extract<Node, { kind: 'text' }>['textDecoration'],
  x: number,
  y: number,
  width: number,
  fontSize: number,
  lineHeight: number,
) {
  if (decoration === 'none' || width <= 0) return
  const baseline = canvasTextBaseline(ctx, y, fontSize, lineHeight)
  const decorationY =
    decoration === 'underline'
      ? baseline + Math.max(1, fontSize * 0.08)
      : baseline - fontSize * 0.3
  ctx.save()
  ctx.beginPath()
  ctx.strokeStyle = ctx.fillStyle
  ctx.lineWidth = Math.max(1, fontSize / 16)
  ctx.moveTo(x, decorationY)
  ctx.lineTo(x + width, decorationY)
  ctx.stroke()
  ctx.restore()
}

function measureCanvasTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  tracking: number,
): number {
  const base = ctx.measureText(text).width
  if (!Number.isFinite(tracking) || tracking === 0) return base
  return base + Math.max(0, Array.from(text).length - 1) * tracking
}

function paintImagePlaceholder(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#f8fafc')
  gradient.addColorStop(1, '#e2e8f0')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

function paintImageNode(
  ctx: CanvasRenderingContext2D,
  node: Extract<Node, { kind: 'image' }>,
  width: number,
  height: number,
) {
  const image = getCachedTextureImage(node.src)
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    paintImagePlaceholder(ctx, width, height)
    return
  }
  const iw = image.naturalWidth || width
  const ih = image.naturalHeight || height
  let sx = 0
  let sy = 0
  let sw = iw
  let sh = ih
  let dx = 0
  let dy = 0
  let dw = width
  let dh = height
  switch (node.fit) {
    case 'contain': {
      const scale = Math.min(width / iw, height / ih)
      dw = iw * scale
      dh = ih * scale
      dx = (width - dw) / 2
      dy = (height - dh) / 2
      break
    }
    case 'cover': {
      const scale = Math.max(width / iw, height / ih)
      sw = width / scale
      sh = height / scale
      sx = (iw - sw) / 2
      sy = (ih - sh) / 2
      break
    }
    case 'none':
      dw = iw
      dh = ih
      dx = (width - dw) / 2
      dy = (height - dh) / 2
      break
    case 'fill':
    default:
      break
  }
  try {
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
  } catch {
    paintImagePlaceholder(ctx, width, height)
  }
}

function getCachedTextureImage(src: string): HTMLImageElement {
  const cached = imageCache.get(src)
  if (cached) return cached
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.onload = () => {
    window.dispatchEvent(new Event(IMAGE_TEXTURE_LOADED_EVENT))
  }
  image.onerror = () => {
    window.dispatchEvent(new Event(IMAGE_TEXTURE_LOADED_EVENT))
  }
  image.src = src
  imageCache.set(src, image)
  return image
}
