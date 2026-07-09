// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  useSceneAPI,
  useSceneVersion,
  fillToCss,
  imageBackgroundStyle,
} from '@/scene'
import type {
  CornerRadii,
  Fill,
  CameraNode,
  Node as SceneNode,
  NodeId,
  NodeKind,
  Stroke,
} from '@/scene'
import type { Rect, SolvedLayout } from '@/layout'
import type { SceneAPI } from '@/scene/doc'
import { useLayout } from '@/ui/hooks/useLayout'
import { setLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import { useUI } from '@/state/ui'
import type { Tool } from '@/state/ui'
import { SelectionOverlay } from '@/ui/SelectionOverlay'
import { DistanceOverlay } from '@/ui/DistanceOverlay'
import { useAnimatedValues, type AnimatedValue } from '@/ui/hooks/useAnimatedValues'
import { useDragToMove } from '@/ui/hooks/useDragToMove'
import { buildNodeContextMenu } from '@/ui/contextMenuActions'
import { importImageFiles, isImageFile } from '@/ui/importImage'
import {
  captureVideoPoster,
  decodeVideoMeta,
  importMediaFiles,
  isMediaFile,
  normalizeVideoFileForBrowser,
  readMediaFileAsDataUrl,
  VIDEO_PLAYBACK_PROXY_WARNING,
} from '@/ui/importMedia'
import {
  filesFromClipboardEvent,
  importClipboardFiles,
  readElectronClipboardFiles,
} from '@/ui/importClipboardFiles'
import { instantiateComponent } from '@/ui/actions'
import { FloatingDock } from '@/ui/FloatingDock'
import { SnapshotCompositor } from '@/render/SnapshotCompositor'
import { ThreeSceneViewport } from '@/render3d/ThreeSceneViewport'
import {
  buildWorldPlanes,
  hitTestPlanes,
  resolveCamera3D,
  viewportPointToRay,
} from '@/render3d/scene3d'
import {
  getAnimEngine,
  recordKeyframesForPatch,
  stampToActiveTracksForPatch,
  listTracksForNode,
  normalizeTextAnimation,
} from '@/anim'
import type { TextAnimationConfig } from '@/anim'

/**
 * Per-node values accumulated from every ancestor in the scene tree.
 *
 * Needed because the DOM renderer paints every node as a flat,
 * absolutely-positioned sibling (using Yoga's world-space rect), so a
 * parent's CSS transform / opacity cannot reach its children the way
 * it would if they were nested in the DOM. Without this, animating a
 * parent (e.g. a Slide preset on a card) leaves its children stuck in
 * place while the parent alone slides — clearly broken.
 *
 * When the layout snapshot is available we use a small 2D affine matrix
 * for ancestor translation / rotationZ / scale around the ancestor pivot.
 * That keeps children attached to rotated cards even though the DOM paint
 * is still flat. 3D rotateX/Y/Z-depth are still carried as metadata and
 * composed by NodeView.
 *
 * The root / artboard contributes nothing — its transform is clamped
 * to identity by `NodeView` so even if stale scene state had it tilted,
 * the inheritance pass sees a no-op.
 *
 * Proper pivot-correct composition via a 2D affine matrix lands with
 * the Pixi swap (Step 4); until then this additive model handles the
 * 95% case (translate) perfectly and the rest visibly-correctly.
 */
export interface InheritedAnim {
  x: number
  y: number
  z: number
  rotation: number
  rotationX: number
  rotationY: number
  scaleX: number
  scaleY: number
  opacity: number
}

interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!(
    el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable)
  )
}

const IDENTITY_MATRIX_2D: Matrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
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
  const r = degToRad(rotation)
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

export interface CameraDepthOfField {
  enabled: boolean
  mode: CameraNode['focusMode']
  focusX: number
  focusY: number
  focusWorldX: number
  focusWorldY: number
  focusWorldZ: number
  focusRadius: number
  focusFalloff: number
  focusDistance: number
  aperture: number
  blurPx: number
  featherPx: number
  focalLength: number
  cameraZ: number
  cameraScale: number
  iso: number
  blurQuality: number
  blurAxisDeg: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function rotateX(v: Vec3, deg: number): Vec3 {
  const r = degToRad(deg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c }
}

function rotateY(v: Vec3, deg: number): Vec3 {
  const r = degToRad(deg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }
}

function rotateZ(v: Vec3, deg: number): Vec3 {
  const r = degToRad(deg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }
}

function inverseRotateEuler(v: Vec3, rotX: number, rotY: number, rotZ: number): Vec3 {
  return rotateX(rotateY(rotateZ(v, -rotZ), -rotY), -rotX)
}

function cornerRadiusCss(
  cornerRadius: number,
  cornerRadii?: CornerRadii,
): number | string {
  return cornerRadii
    ? `${cornerRadii.tl}px ${cornerRadii.tr}px ${cornerRadii.br}px ${cornerRadii.bl}px`
    : cornerRadius
}

function maxCornerRadius(cornerRadius: number, cornerRadii?: CornerRadii): number {
  return cornerRadii
    ? Math.max(cornerRadii.tl, cornerRadii.tr, cornerRadii.br, cornerRadii.bl)
    : cornerRadius
}

export function fillBackgroundStyle(fill: Fill | null | undefined): React.CSSProperties {
  if (!fill) return {}
  if (fill.kind === 'solid') {
    return { backgroundColor: fill.color }
  }
  if (fill.kind === 'image') {
    return imageBackgroundStyle(fill) ?? {}
  }
  return { backgroundImage: fillToCss(fill) }
}

const IDENTITY_INHERITED: InheritedAnim = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
}

/**
 * Walk the scene tree from root, producing per-node InheritedAnim maps
 * that carry the compounded effect of every ancestor's transform +
 * animated delta. Node's own contribution is NOT included here — the
 * NodeView composes its own on top at render time.
 *
 * Exported so the render-window shell (`src/render/RenderCanvas.tsx`)
 * can build the same inheritance map without duplicating the walk.
 */
export function composeInheritedAnim(
  api: SceneAPI,
  rootId: NodeId | null,
  animated: Record<NodeId, AnimatedValue>,
  solved?: SolvedLayout | null,
): Record<NodeId, InheritedAnim> {
  const out: Record<NodeId, InheritedAnim> = {}
  if (!rootId) return out

  interface InheritanceContext extends InheritedAnim {
    matrix: Matrix2D
  }
  const identityContext: InheritanceContext = {
    ...IDENTITY_INHERITED,
    matrix: IDENTITY_MATRIX_2D,
  }

  const inheritForNode = (id: NodeId, context: InheritanceContext): InheritedAnim => {
    const rect = solved?.[id]
    if (!rect) {
      return {
        x: context.x,
        y: context.y,
        z: context.z,
        rotation: context.rotation,
        rotationX: context.rotationX,
        rotationY: context.rotationY,
        scaleX: context.scaleX,
        scaleY: context.scaleY,
        opacity: context.opacity,
      }
    }
    const topLeft = transformPoint2D(context.matrix, rect.x, rect.y)
    return {
      x: topLeft.x - rect.x,
      y: topLeft.y - rect.y,
      z: context.z,
      rotation: context.rotation,
      rotationX: context.rotationX,
      rotationY: context.rotationY,
      scaleX: context.scaleX,
      scaleY: context.scaleY,
      opacity: context.opacity,
    }
  }

  const visit = (id: NodeId, context: InheritanceContext) => {
    out[id] = inheritForNode(id, context)
    const node = api.getNode(id)
    if (!node) return
    // Root translation/scale/opacity are treated as identity so the
    // artboard remains anchored to the canvas. Root rotation is allowed:
    // it is the scene/design plane tilt under the active camera.
    const isRoot = id === rootId
    const a = animated[id]
    // REPLACE semantics: when a track exists for a property, the
    // animated value is the node's "effective" value at this instant —
    // it already includes wherever the node would render. So we use it
    // directly in the ancestor composition, falling through to static
    // when no track is active.
    const effX = a?.x ?? node.transform.x
    const effY = a?.y ?? node.transform.y
    const effZ = a?.z ?? node.transform.z
    const effRot = a?.rotation ?? node.transform.rotation
    const effRotX = a?.rotationX ?? node.transform.rotationX
    const effRotY = a?.rotationY ?? node.transform.rotationY
    const effSX = a?.scaleX ?? node.transform.scaleX
    const effSY = a?.scaleY ?? node.transform.scaleY
    const effOp = a?.opacity ?? node.appearance.opacity
    const anchorX = a?.anchorX ?? node.transform.anchorX ?? 0.5
    const anchorY = a?.anchorY ?? node.transform.anchorY ?? 0.5
    const rect = solved?.[id]
    // Z is propagated as depth metadata for camera depth-of-field, but
    // it is still not included in the regular DOM transform below.
    // This keeps the surface visually 2D while letting a frame move an
    // entire subtree closer to or farther from the camera's focus plane.
    const nodeMatrix =
      rect && !isRoot
        ? nodeMatrix2D(rect, effX, effY, effRot, effSX, effSY, anchorX, anchorY)
        : rect && isRoot
          ? nodeMatrix2D(rect, 0, 0, effRot, 1, 1, 0.5, 0.5)
          : null
    const nextMatrix = nodeMatrix
      ? multiplyMatrix2D(context.matrix, nodeMatrix)
      : context.matrix
    const nextInherited: InheritanceContext = isRoot
      ? {
          ...context,
          matrix: nextMatrix,
          z: context.z + effZ,
          rotation: context.rotation + effRot,
          rotationX: context.rotationX + effRotX,
          rotationY: context.rotationY + effRotY,
        }
      : {
          x: context.x + effX,
          y: context.y + effY,
          z: context.z + effZ,
          rotation: context.rotation + effRot,
          rotationX: context.rotationX + effRotX,
          rotationY: context.rotationY + effRotY,
          scaleX: context.scaleX * effSX,
          scaleY: context.scaleY * effSY,
          opacity: context.opacity * effOp,
          matrix: nextMatrix,
        }
    for (const child of api.getChildren(id)) visit(child.id, nextInherited)
  }
  visit(rootId, identityContext)
  return out
}

interface ClipHit {
  rect: Rect
  cornerRadius: number
  cornerRadii?: CornerRadii
}

export function computeCameraDepthOfField(
  camera: CameraNode | null,
  cameraAnim: AnimatedValue | undefined,
  cameraScale: number,
  canvasWidth: number,
  canvasHeight: number,
  focusWorldOverride?: Vec3 | null,
): CameraDepthOfField | null {
  if (!camera || !camera.depthOfField) return null
  const focusDistance = cameraAnim?.focusDistance ?? camera.focusDistance ?? 0
  const aperture = Math.max(0, cameraAnim?.aperture ?? camera.aperture ?? 0)
  const focusZ = cameraAnim?.focusWorldZ ?? camera.focusWorldZ ?? focusDistance
  const maxBlur = Math.max(0, Math.min(128, cameraAnim?.blurLevel ?? camera.blurLevel ?? 1))
  const focalLength = Math.max(50, camera.focalLength ?? 1000)
  const cameraZ = cameraAnim?.z ?? camera.transform.z
  const rotationX = cameraAnim?.rotationX ?? camera.transform.rotationX
  const rotationY = cameraAnim?.rotationY ?? camera.transform.rotationY
  const safeCameraScale = Math.max(0.05, cameraScale)
  const focalFactor = Math.max(0.35, Math.min(6, focalLength / 1000))
  const dollyFactor = Math.max(0.5, Math.min(5, 1 + Math.max(0, cameraZ) / focalLength))
  const apertureFactor =
    aperture <= 0 ? 1 : Math.max(0.25, Math.min(5, Math.pow(aperture / 10, 1.15)))
  const focusDepthFactor = Math.max(
    0.75,
    Math.min(5, 1 + Math.abs(focusZ - cameraZ) / Math.max(120, focalLength * 0.55)),
  )
  const blurPx = Math.min(
    160,
    maxBlur * apertureFactor * focusDepthFactor * Math.sqrt(focalFactor) * dollyFactor,
  )
  const effectiveFocusRadius = Math.max(
    4,
    cameraAnim?.focusRadius ?? camera.focusRadius ?? 160,
  )
  const focusFalloff = Math.max(
    1,
    cameraAnim?.focusFalloff ?? camera.focusFalloff ?? 180,
  )
  const mode = camera.focusMode ?? 'screen'
  const focusScreen = {
    x:
      cameraAnim?.focusX ??
      cameraAnim?.focusWorldX ??
      camera.focusX ??
      camera.focusWorldX ??
      canvasWidth / 2,
    y:
      cameraAnim?.focusY ??
      cameraAnim?.focusWorldY ??
      camera.focusY ??
      camera.focusWorldY ??
      canvasHeight / 2,
  }
  const focusWorld = focusWorldOverride ?? {
    x:
      cameraAnim?.focusWorldX ??
      cameraAnim?.focusX ??
      camera.focusWorldX ??
      camera.focusX ??
      focusScreen.x,
    y:
      cameraAnim?.focusWorldY ??
      cameraAnim?.focusY ??
      camera.focusWorldY ??
      camera.focusY ??
      focusScreen.y,
    z: focusZ,
  }
  const projected =
    mode === 'screen'
      ? focusScreen
      : projectWorldPointThroughCamera(
          focusWorld,
          camera,
          cameraAnim,
          canvasWidth,
          canvasHeight,
        )
  return {
    enabled: true,
    mode,
    focusX: projected.x,
    focusY: projected.y,
    focusWorldX: focusWorld.x,
    focusWorldY: focusWorld.y,
    focusWorldZ: focusWorld.z,
    focusRadius: effectiveFocusRadius,
    focusFalloff,
    focusDistance: mode === 'screen' ? focusDistance : focusWorld.z,
    aperture,
    blurPx,
    featherPx: focusFalloff,
    focalLength,
    cameraZ,
    cameraScale: safeCameraScale,
    iso: Math.max(0, camera.iso ?? 100),
    blurQuality: Math.max(1, Math.min(8, cameraAnim?.blurQuality ?? camera.blurQuality ?? 4)),
    blurAxisDeg:
      Math.abs(rotationX) + Math.abs(rotationY) < 0.001
        ? 90
        : 90 + (Math.atan2(rotationX, rotationY || 0.0001) * 180) / Math.PI,
  }
}

function projectWorldPointThroughCamera(
  point: Vec3,
  camera: CameraNode,
  cameraAnim: AnimatedValue | undefined,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const focalLength = Math.max(50, camera.focalLength ?? 1000)
  const cx = cameraAnim?.x ?? camera.transform.x
  const cy = cameraAnim?.y ?? camera.transform.y
  const cz = cameraAnim?.z ?? camera.transform.z
  const rX = cameraAnim?.rotationX ?? camera.transform.rotationX
  const rY = cameraAnim?.rotationY ?? camera.transform.rotationY
  const rZ = cameraAnim?.rotation ?? camera.transform.rotation
  const cameraOrigin: Vec3 = { x: cx, y: cy, z: -focalLength + cz }
  const cameraSpace = inverseRotateEuler(sub3(point, cameraOrigin), rX, rY, rZ)
  const denom = Math.max(1, cameraSpace.z)
  const scale = focalLength / denom
  return {
    x: canvasWidth / 2 + cameraSpace.x * scale,
    y: canvasHeight / 2 + cameraSpace.y * scale,
  }
}

export function resolveCameraFocusTargetPoint(
  api: SceneAPI,
  camera: CameraNode | null,
  solved: SolvedLayout,
  animated: Record<NodeId, AnimatedValue>,
  inherited: Record<NodeId, InheritedAnim>,
  viewport?: { width: number; height: number },
): Vec3 | null {
  if (!camera || (camera.focusMode ?? 'plane') !== 'target') return null
  const targetId = camera.focusTargetNodeId
  if (!targetId) return null
  const target = api.getNode(targetId)
  const rect = solved[targetId]
  if (!target || !rect) return null
  if (viewport) {
    const resolvedCamera = resolveCamera3D(camera, animated[camera.id], viewport)
    const targetPlane = buildWorldPlanes(api, solved, animated, resolvedCamera)
      .find((plane) => plane.nodeId === targetId)
    if (targetPlane) return targetPlane.center
  }
  const inherit = inherited[targetId] ?? IDENTITY_INHERITED
  const anim = animated[targetId]
  return {
    x: rect.x + rect.width / 2 + inherit.x + (anim?.x ?? target.transform.x),
    y: rect.y + rect.height / 2 + inherit.y + (anim?.y ?? target.transform.y),
    z: inherit.z + (anim?.z ?? target.transform.z),
  }
}

/**
 * Workspace host.
 *
 * Owns the zoomable / pannable surface around the scene's canvas frame.
 * The inner tree walks the scene and paints each node as an
 * absolutely-positioned div sized from its SolvedLayout rect.
 *
 * Coordinate spaces:
 *   - workspace (pixels in the DOM viewport)
 *   - canvas    (inside the transformed container; 1 unit = 1 canvas px)
 *   - a click at workspace (wx, wy) maps to canvas
 *     ((wx - panX) / zoom, (wy - panY) / zoom).
 *
 * Step 4 will replace the inline NodeView divs with a Pixi adapter; the
 * workspace transform container stays (Pixi inherits CSS transforms
 * without penalty on current browsers).
 */
export function Canvas() {
  const api = useSceneAPI()
  const version = useSceneVersion()

  const workspaceRef = useRef<HTMLDivElement>(null)
  const meta = api.getMeta()
  // Defensive defaults — if a `.hype` load somehow leaves `meta.canvas`
  // undefined (we saw this when `Y.applyUpdate` was used directly instead
  // of `loadSceneIntoDoc`), fall back to the seed dimensions so the
  // component renders an empty artboard instead of crashing the whole app.
  const canvasWidth = meta.canvas?.width ?? 960
  const canvasHeight = meta.canvas?.height ?? 540
  const frameStep = 1 / Math.max(1, meta.frameRate ?? 60)
  const duration = Math.max(frameStep, meta.duration ?? 5)
  const rootId = api.getRoot() || null
  // Root appearance drives the canvas box itself — fill paints the
  // artboard background, corner radius rounds the box. Without this,
  // the container's hardcoded bg + rounded-sm would always win over
  // the Scene Inspector's Background section. Runs through the same
  // fillToCss serializer as inner nodes so the artboard can host a
  // gradient just like any other frame.
  const rootNode = rootId ? api.getNode(rootId) : null
  const sceneFill = fillToCss(rootNode?.appearance.fill ?? null) ?? null
  const sceneCorner = rootNode?.appearance.cornerRadius ?? 0
  // Camera viewport background — paints behind the artboard so when
  // the user zooms out / pans beyond the artboard, this fill (rather
  // than the workspace chrome) is what shows. Read here so the
  // surrounding canvas-root JSX can substitute it for the static
  // panel color and decide whether the checkerboard is helpful.
  // `camera` is computed below; we recompute the background CSS once
  // we have the camera node in hand. Defining the variable here keeps
  // the JSX further down readable. Falls back to null when there's
  // no active camera or no background fill set.

  // --- selection + tool + view state -----------------------------------
  const setSelection = useUI((s) => s.setSelection)
  const clearSelection = useUI((s) => s.clearSelection)
  const selection = useUI((s) => s.selection)
  const tool = useUI((s) => s.tool)
  const playing = useUI((s) => s.playing)
  const playhead = useUI((s) => s.playhead)
  const setTool = useUI((s) => s.setTool)
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)
  const zoomAt = useUI((s) => s.zoomAt)
  const focusPickingCameraId = useUI((s) => s.focusPickingCameraId)
  const setFocusPickingCameraId = useUI((s) => s.setFocusPickingCameraId)

  // --- layout solve ----------------------------------------------------
  const container = useMemo(
    () => ({ width: canvasWidth, height: canvasHeight }),
    [canvasWidth, canvasHeight],
  )
  const solved = useLayout(rootId, container)
  // Mirror the latest solve into a module-scope cache so out-of-tree
  // callers (Inspector position-toggle, context menu actions) can read
  // a node's rect on a discrete user action without forcing the layout
  // hook into their parents. See hooks/lastSolvedLayout.ts.
  useEffect(() => {
    setLastSolvedLayout(solved)
  }, [solved])

  const renderOrder = useMemo<NodeId[]>(() => {
    if (!rootId) return []
    const out: NodeId[] = []
    const visit = (id: NodeId) => {
      out.push(id)
      const children = api.getChildren(id)
      for (let i = children.length - 1; i >= 0; i--) {
        visit(children[i]!.id)
      }
    }
    visit(rootId)
    return out
  }, [api, rootId, version])

  const workspaceOrder = useMemo<NodeId[]>(() => {
    const roots = api
      .getAllNodeIds()
      .filter((id) => {
        const node = api.getNode(id)
        return !!node && !!node.workspaceOnly && node.parent === null
      })
    const out: NodeId[] = []
    const visit = (id: NodeId) => {
      out.push(id)
      for (const child of api.getChildren(id)) visit(child.id)
    }
    for (const id of roots) visit(id)
    return out
  }, [api, version])

  // Animated values (opacity, transform offsets) from the anim engine,
  // keyed by node id. Empty object while no tracks exist, which is the
  // current default — the engine is wired but untouched until Step 5.
  const animated = useAnimatedValues(renderOrder)

  // Active camera: a scene-level node whose transform is interpreted as
  // the view transform, inverse-applied to the artboard content. The
  // camera isn't part of the layout tree (parent: null, excluded from
  // the artboard walk above) so the layout/render passes never see it
  // as something to position. Here we just read its current composed
  // transform (static + any anim delta) and fold it into a CSS string
  // applied to the paint layer.
  //
  // When there's no active camera (legacy doc, not migrated yet), the
  // view collapses to identity — scene renders exactly as before.
  const cameraId = api.getActiveCameraId()
  const camera = cameraId ? api.getNode(cameraId) : null
  const cameraAnim = cameraId ? animated[cameraId] : undefined
  // Pre-serialize the camera's viewport background so the canvas-root
  // JSX further down can swap it in for the static panel color. Null
  // when there's no active camera or no fill set; the renderer falls
  // back to `var(--color-panel)` in that case.
  const cameraBackgroundFill =
    camera && camera.kind === 'camera' ? camera.background ?? null : null
  const cameraBackgroundCss = fillToCss(cameraBackgroundFill ?? null) ?? null
  // For image fills, the renderer needs the full background-* bundle
  // (image url + size + repeat). For solid/gradient, we just paint
  // `background: <css>`. Branch here so the JSX stays simple.
  const cameraBackgroundStyle = cameraBackgroundFill
    ? fillBackgroundStyle(cameraBackgroundFill)
    : null
  const [cameraPreview, setCameraPreview] = useState<{
    cameraId: NodeId
    transform: CameraNode['transform']
  } | null>(null)
  const [threeCameraAvailable, setThreeCameraAvailable] = useState(false)
  const previewCameraTransform =
    camera && camera.kind === 'camera' && cameraPreview?.cameraId === camera.id
      ? cameraPreview.transform
      : null
  const liveCameraAnim = useMemo<AnimatedValue | undefined>(() => {
    if (!previewCameraTransform) return cameraAnim
    return {
      ...cameraAnim,
      x: previewCameraTransform.x,
      y: previewCameraTransform.y,
      z: previewCameraTransform.z,
      rotation: previewCameraTransform.rotation,
      rotationX: previewCameraTransform.rotationX,
      rotationY: previewCameraTransform.rotationY,
      scaleX: previewCameraTransform.scaleX,
      scaleY: previewCameraTransform.scaleY,
    }
  }, [cameraAnim, previewCameraTransform])
  // ---------------------------------------------------------------
  // 3D camera
  // ---------------------------------------------------------------
  //
  // The camera carries (x, y, z). Z is the dolly axis:
  //   - z=0  : neutral, world renders at scale 1
  //   - z>0  : camera moved closer, world appears bigger (scale > 1)
  //   - z<0  : camera moved back, world appears smaller (scale < 1)
  //
  // Apparent scale uses a textbook pinhole model:
  //   apparentScale = focalLength / (focalLength - z)
  //
  // Focal length now lives on the camera node so users can dial it
  // per-scene. Default 1000 matches the historical hardcoded value.
  // Larger = more telephoto (subtler rotations, less Z-driven scale).
  // Smaller = wide-angle (dramatic rotations, big Z scale).
  const cameraFocalLength =
    camera && camera.kind === 'camera'
      ? Math.max(50, camera.focalLength ?? 1000)
      : 1000
  const cameraZ =
    camera && camera.kind === 'camera'
      ? liveCameraAnim?.z ?? camera.transform.z
      : 0
  const cameraDollyZ = cameraZ / 100
  // Clamp the denominator so an animation through z = focal length
  // (singularity) doesn't blow the scale up to infinity.
  const cameraScaleFromZ = useMemo(() => {
    const denom = Math.max(1, cameraFocalLength - cameraDollyZ)
    return cameraFocalLength / denom
  }, [cameraDollyZ, cameraFocalLength])

  const cameraTransform = useMemo(() => {
    if (!camera || camera.kind !== 'camera') return null
    const cx = liveCameraAnim?.x ?? camera.transform.x
    const cy = liveCameraAnim?.y ?? camera.transform.y
    const rX =
      liveCameraAnim?.rotationX ?? camera.transform.rotationX
    const rY =
      liveCameraAnim?.rotationY ?? camera.transform.rotationY
    const rZ =
      liveCameraAnim?.rotation ?? camera.transform.rotation
    const s = cameraScaleFromZ
    const w = canvasWidth
    const h = canvasHeight
    // Keep the editor preview faithful to the actual design DOM/Yoga
    // renderer. WebGL remains the long-term 3D compositor, but until its
    // texture pipeline can rasterize full design fidelity, the visible
    // camera view should use the real DOM tree and CSS 3D camera tilt.
    return (
      `translate(${w / 2}px, ${h / 2}px) ` +
      `scale(${s}, ${s}) ` +
      `rotateX(${-rX}deg) ` +
      `rotateY(${rY}deg) ` +
      `rotateZ(${-rZ}deg) ` +
      `translate(${-cx}px, ${-cy}px)`
    )
  }, [
    camera,
    liveCameraAnim,
    cameraScaleFromZ,
    canvasWidth,
    canvasHeight,
  ])

  // Inherited-from-ancestor effects per node, so a parent's animated
  // translate / opacity / scale also moves the children that sit beside
  // it in the flat SceneLayer paint (not nested under it in the DOM).
  // Rebuilt whenever the scene structure or the engine snapshot changes.
  // `version` is a cache-bust signal — not referenced inside the fn but
  // required so pure-scene mutations (e.g. dragging a node) re-run the
  // ancestor walk even when the anim snapshot identity hasn't changed.
  const inherited = useMemo(
    () => composeInheritedAnim(api, rootId, animated, solved),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, rootId, animated, solved, version],
  )

  const focusTargetWorld = useMemo(
    () =>
      resolveCameraFocusTargetPoint(
        api,
        camera && camera.kind === 'camera' ? camera : null,
        solved ?? {},
        animated,
        inherited,
        { width: canvasWidth, height: canvasHeight },
      ),
    [api, camera, solved, animated, inherited],
  )

  const cameraDepthOfField = useMemo(
    () =>
      computeCameraDepthOfField(
        camera && camera.kind === 'camera' ? camera : null,
        liveCameraAnim,
        cameraScaleFromZ,
        canvasWidth,
        canvasHeight,
        focusTargetWorld,
      ),
    [
      camera,
      liveCameraAnim,
      cameraScaleFromZ,
      canvasWidth,
      canvasHeight,
      focusTargetWorld,
    ],
  )
  const [isCameraManipulating, setIsCameraManipulating] = useState(false)
  const previewCameraDepthOfField = isCameraManipulating
    ? null
    : cameraDepthOfField

  const displayedCameraTransform = useCallback(
    (node: CameraNode): CameraNode['transform'] => ({
      ...node.transform,
      x: liveCameraAnim?.x ?? node.transform.x,
      y: liveCameraAnim?.y ?? node.transform.y,
      z: liveCameraAnim?.z ?? node.transform.z,
      rotation: liveCameraAnim?.rotation ?? node.transform.rotation,
      rotationX: liveCameraAnim?.rotationX ?? node.transform.rotationX,
      rotationY: liveCameraAnim?.rotationY ?? node.transform.rotationY,
      scaleX: liveCameraAnim?.scaleX ?? node.transform.scaleX,
      scaleY: liveCameraAnim?.scaleY ?? node.transform.scaleY,
    }),
    [liveCameraAnim],
  )

  // --- pointer events: workspace-level click to clear / pan with H ----
  const panStateRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  // Drawing state for R/O/T/F tools. Kept as both ref (for pointer move
  // math without re-render churn) and state (for rendering the preview
  // outline during the drag).
  const drawStateRef = useRef<{
    kind: NodeKind
    pointerId: number
    startX: number
    startY: number
    workspaceOnly: boolean
  } | null>(null)
  const [drawPreview, setDrawPreview] = useState<
    (Rect & { workspaceOnly?: boolean }) | null
  >(null)

  // Marquee (rubber-band) selection state. Active only with the select
  // tool, clicking the empty workspace background. Holding Shift at
  // drag-start extends the existing selection instead of replacing it.
  const marqueeRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    additive: boolean
    initialSelection: NodeId[]
    workspaceOnly: boolean
  } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<
    (Rect & { workspaceOnly?: boolean }) | null
  >(null)
  const cameraControlRef = useRef<{
    pointerId: number
    cameraId: NodeId
    mode: 'rotate' | 'pan'
    startX: number
    startY: number
    transform: CameraNode['transform']
    latestTransform: CameraNode['transform']
    startPlayhead: number
    startPerfTime: number
    lastSampleTime: number
    didStampStart: boolean
    moved: boolean
  } | null>(null)
  const focusMaskDragRef = useRef<{
    pointerId: number
    cameraId: NodeId
    startX: number
    startY: number
    latestPatch: Record<string, number>
    moved: boolean
  } | null>(null)

  const stampCanvasPatch = useCallback(
    (
      nodeId: NodeId,
      group: 'transform' | 'appearance' | 'size' | 'camera',
      patch: Record<string, unknown>,
      time?: number,
    ) => {
      const ui = useUI.getState()
      const playhead = time ?? ui.playhead
      if (ui.recording) {
        recordKeyframesForPatch(api, nodeId, playhead, group, patch)
      } else {
        stampToActiveTracksForPatch(api, nodeId, playhead, group, patch)
      }
    },
    [api],
  )

  const stampCanvasTransformPatch = useCallback(
    (nodeId: NodeId, patch: Record<string, unknown>, time?: number) => {
      stampCanvasPatch(nodeId, 'transform', patch, time)
    },
    [stampCanvasPatch],
  )

  const applyCameraControlTransform = useCallback(
    (cameraId: NodeId, transform: CameraNode['transform']) => {
      const current = api.getNode(cameraId)
      if (!current || current.kind !== 'camera') return
      api.setNodeProperty(current.id, 'transform', {
        ...current.transform,
        ...transform,
      })
    },
    [api],
  )

  const currentAnimationAuthorTime = useCallback(() => {
    const ui = useUI.getState()
    return ui.playing ? getAnimEngine().getPlayhead() : ui.playhead
  }, [])

  const cameraControlPatch = useCallback(
    (
      mode: 'rotate' | 'pan',
      transform: CameraNode['transform'],
    ): Record<string, number> =>
      mode === 'rotate'
        ? {
            rotationX: transform.rotationX,
            rotationY: transform.rotationY,
          }
        : {
            x: transform.x,
            y: transform.y,
          },
    [],
  )

  const maybeStampCameraControlSample = useCallback(
    (
      cameraControl: NonNullable<typeof cameraControlRef.current>,
      nextTransform: CameraNode['transform'],
    ) => {
      const ui = useUI.getState()
      if (!ui.recording && !ui.playing) return

      const nextPatch = cameraControlPatch(cameraControl.mode, nextTransform)

      if (ui.recording && !cameraControl.didStampStart) {
        stampCanvasTransformPatch(
          cameraControl.cameraId,
          cameraControlPatch(cameraControl.mode, cameraControl.transform),
          cameraControl.startPlayhead,
        )
        cameraControl.didStampStart = true
      }

      const sampleTime = ui.playing
        ? currentAnimationAuthorTime()
        : Math.min(
            duration,
            cameraControl.startPlayhead +
              (performance.now() - cameraControl.startPerfTime) / 1000,
          )
      const minStep = frameStep * 0.75
      if (
        ui.playing &&
        Math.abs(sampleTime - cameraControl.lastSampleTime) < minStep
      ) {
        return
      }
      stampCanvasTransformPatch(cameraControl.cameraId, nextPatch, sampleTime)
      cameraControl.lastSampleTime = sampleTime
    },
    [
      cameraControlPatch,
      currentAnimationAuthorTime,
      frameStep,
      duration,
      stampCanvasTransformPatch,
    ],
  )

  const stampCanvasCameraPatch = useCallback(
    (nodeId: NodeId, patch: Record<string, unknown>) => {
      stampCanvasPatch(nodeId, 'camera', patch)
    },
    [stampCanvasPatch],
  )

  const clientToViewport = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = workspaceRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return {
        x:
          (clientX - rect.left - rect.width / 2 - view.panX) / view.zoom +
          canvasWidth / 2,
        y:
          (clientY - rect.top - rect.height / 2 - view.panY) / view.zoom +
          canvasHeight / 2,
      }
    },
    [view.panX, view.panY, view.zoom, canvasWidth, canvasHeight],
  )

  const hitTestWorkspace = useCallback(
    (clientX: number, clientY: number): NodeId | null => {
      const point = clientToViewport(clientX, clientY)
      if (!point) return null
      for (const id of [...workspaceOrder].reverse()) {
        const node = api.getNode(id)
        if (!node || !node.visible) continue
        const rect = workspaceRectForNode(node)
        const inherit = workspaceInheritedTransform(api, node)
        const x = rect.x + node.transform.x + inherit.x
        const y = rect.y + node.transform.y + inherit.y
        if (
          point.x >= x &&
          point.x <= x + rect.width &&
          point.y >= y &&
          point.y <= y + rect.height
        ) {
          return id
        }
      }
      return null
    },
    [api, clientToViewport, workspaceOrder],
  )

  const resolvedCamera3D = useMemo(
    () =>
      camera && camera.kind === 'camera'
        ? resolveCamera3D(camera, liveCameraAnim, {
            width: canvasWidth,
            height: canvasHeight,
          })
        : null,
    [camera, liveCameraAnim, canvasWidth, canvasHeight],
  )

  const planes3D = useMemo(
    () =>
      resolvedCamera3D && solved
        ? buildWorldPlanes(api, solved, animated, resolvedCamera3D)
        : [],
    [api, solved, animated, resolvedCamera3D, version],
  )

  const hitTestCanvas3D = useCallback(
    (clientX: number, clientY: number) => {
      if (!resolvedCamera3D || !solved) return null
      const point = clientToViewport(clientX, clientY)
      if (!point) return null
      return hitTestPlanes(
        planes3D,
        viewportPointToRay(
          resolvedCamera3D,
          point.x,
          point.y,
          { width: canvasWidth, height: canvasHeight },
        ),
        resolvedCamera3D,
        { width: canvasWidth, height: canvasHeight },
      )
    },
    [
      resolvedCamera3D,
      solved,
      clientToViewport,
      planes3D,
      canvasWidth,
      canvasHeight,
    ],
  )

  // Convert a clientX/clientY into canvas-space coordinates.
  //
  // There are two transforms stacked between the user's pointer and the
  // scene:
  //
  //   1. Workspace view — pan/zoom centered on the workspace midpoint.
  //      Controlled by the hand tool and Cmd-drag.
  //   2. Camera view — the active camera node's inverse transform,
  //      wrapping the scene paint layer so the camera pans/rotates/zooms
  //      the SCENE CONTENT within the artboard.
  //
  // A pointer click has to unwind BOTH to land in the canvas-space the
  // scene nodes live in. Missing step 2 is the "I drew an ellipse here
  // but it appeared over there" bug — the camera shifts the visible
  // artboard, but the placement math wrote the pre-camera coord, so the
  // new node rendered (through the camera again) somewhere else.
  const clientToCanvas = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      // Step 1 — invert workspace pan + zoom. This puts us in the same
      // frame the camera wrapper sits in (origin = artboard top-left).
      const viewportPoint = clientToViewport(clientX, clientY)
      if (!viewportPoint) return null
      let x = viewportPoint.x
      let y = viewportPoint.y
      // Step 2 — invert the camera transform if one is active.
      //
      // Forward (cameraTransform above):
      //   P' = translate(W/2, H/2) · scale(sx,sy) · rotate(-r) ·
      //        translate(-cx, -cy) · P
      // Inverse:
      //   P  = translate(cx, cy) · rotate(+r) · scale(1/sx, 1/sy) ·
      //        translate(-W/2, -H/2) · P'
      if (camera && camera.kind === 'camera') {
        // REPLACE semantics — match the forward cameraTransform above.
        const camCx = liveCameraAnim?.x ?? camera.transform.x
        const camCy = liveCameraAnim?.y ?? camera.transform.y
        const camR = liveCameraAnim?.rotation ?? camera.transform.rotation
        const camSx = liveCameraAnim?.scaleX ?? camera.transform.scaleX
        const camSy = liveCameraAnim?.scaleY ?? camera.transform.scaleY
        const W = canvasWidth
        const H = canvasHeight
        // translate(-W/2, -H/2)
        let px = x - W / 2
        let py = y - H / 2
        // scale(1/sx, 1/sy) — guard divide-by-zero on a degenerate camera
        // (shouldn't happen in UI, but if someone types 0 into scale...)
        px = camSx !== 0 ? px / camSx : px
        py = camSy !== 0 ? py / camSy : py
        // rotate(+r) around origin
        const rad = (camR * Math.PI) / 180
        const c = Math.cos(rad)
        const s = Math.sin(rad)
        const rx = px * c - py * s
        const ry = px * s + py * c
        // translate(cx, cy)
        x = rx + camCx
        y = ry + camCy
      }
      return { x, y }
    },
    [
      clientToViewport,
      canvasWidth,
      canvasHeight,
      camera,
      liveCameraAnim,
    ],
  )

  const isInsideArtboard = useCallback(
    (point: { x: number; y: number } | null): point is { x: number; y: number } =>
      !!point &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= canvasWidth &&
      point.y <= canvasHeight,
    [canvasWidth, canvasHeight],
  )

  const DRAW_TOOLS: Tool[] = ['rect', 'ellipse', 'text', 'frame']
  const isDrawTool = DRAW_TOOLS.includes(tool)
  const [spacePanning, setSpacePanning] = useState(false)

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      return (
        el.isContentEditable ||
        !!el.closest('input, textarea, select, [contenteditable="true"]')
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return
      setSpacePanning(true)
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      setSpacePanning(false)
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const onFocusPickPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      if (!focusPickingCameraId && spacePanning) {
        panStateRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          panX: view.panX,
          panY: view.panY,
        }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (
        !focusPickingCameraId &&
        tool === 'select' &&
        camera &&
        camera.kind === 'camera' &&
        selection.includes(camera.id)
      ) {
        const target = e.target as HTMLElement
        if (target.closest('[data-export-hide="1"]')) return
        const startTransform = displayedCameraTransform(camera)
        cameraControlRef.current = {
          pointerId: e.pointerId,
          cameraId: camera.id,
          mode: e.shiftKey ? 'pan' : 'rotate',
          startX: e.clientX,
          startY: e.clientY,
          transform: startTransform,
          latestTransform: startTransform,
          startPlayhead: currentAnimationAuthorTime(),
          startPerfTime: performance.now(),
          lastSampleTime: currentAnimationAuthorTime(),
          didStampStart: false,
          moved: false,
        }
        setCameraPreview({ cameraId: camera.id, transform: startTransform })
        setIsCameraManipulating(true)
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (!focusPickingCameraId) return
      const point = clientToViewport(e.clientX, e.clientY)
      const canvasPoint = clientToCanvas(e.clientX, e.clientY)
      const focusCamera = api.getNode(focusPickingCameraId)
      if (!point || !canvasPoint || !focusCamera || focusCamera.kind !== 'camera') {
        setFocusPickingCameraId(null)
        return
      }
      const focusWorld = {
        x: canvasPoint.x,
        y: canvasPoint.y,
        z: focusCamera.focusWorldZ ?? focusCamera.focusDistance ?? 0,
      }
      api.doc.transact(() => {
        api.setNodeProperty(focusCamera.id, 'focusX', point.x)
        api.setNodeProperty(focusCamera.id, 'focusY', point.y)
        api.setNodeProperty(focusCamera.id, 'focusWorldX', focusWorld.x)
        api.setNodeProperty(focusCamera.id, 'focusWorldY', focusWorld.y)
        api.setNodeProperty(focusCamera.id, 'focusWorldZ', focusWorld.z)
        api.setNodeProperty(focusCamera.id, 'focusDistance', focusWorld.z)
        api.setNodeProperty(focusCamera.id, 'focusMode', 'screen')
        api.setNodeProperty(focusCamera.id, 'focusTargetNodeId', null)
      })
      stampCanvasCameraPatch(focusCamera.id, {
        focusX: point.x,
        focusY: point.y,
        focusWorldX: focusWorld.x,
        focusWorldY: focusWorld.y,
        focusWorldZ: focusWorld.z,
        focusDistance: focusWorld.z,
      })
      setSelection([focusCamera.id])
      setFocusPickingCameraId(null)
      e.preventDefault()
      e.stopPropagation()
    },
    [
      api,
      clientToViewport,
      clientToCanvas,
      solved,
      focusPickingCameraId,
      setFocusPickingCameraId,
      setSelection,
      stampCanvasCameraPatch,
      currentAnimationAuthorTime,
      camera,
      displayedCameraTransform,
      selection,
      spacePanning,
      tool,
      view.panX,
      view.panY,
    ],
  )

  const focusPatchFromClientPoint = useCallback(
    (
      cameraNode: CameraNode,
      clientX: number,
      clientY: number,
    ): Record<string, number> | null => {
      const viewportPoint = clientToViewport(clientX, clientY)
      const canvasPoint = clientToCanvas(clientX, clientY)
      if (!viewportPoint || !canvasPoint) return null
      const focusWorld = {
        x: canvasPoint.x,
        y: canvasPoint.y,
        z: cameraNode.focusWorldZ ?? cameraNode.focusDistance ?? 0,
      }
      return {
        focusX: viewportPoint.x,
        focusY: viewportPoint.y,
        focusWorldX: focusWorld.x,
        focusWorldY: focusWorld.y,
        focusWorldZ: focusWorld.z,
        focusDistance: focusWorld.z,
      }
    },
    [clientToCanvas, clientToViewport],
  )

  const applyFocusMaskPatch = useCallback(
    (cameraNode: CameraNode, patch: Record<string, number>) => {
      api.doc.transact(() => {
        api.setNodeProperty(cameraNode.id, 'focusX', patch.focusX)
        api.setNodeProperty(cameraNode.id, 'focusY', patch.focusY)
        api.setNodeProperty(cameraNode.id, 'focusWorldX', patch.focusWorldX)
        api.setNodeProperty(cameraNode.id, 'focusWorldY', patch.focusWorldY)
        api.setNodeProperty(cameraNode.id, 'focusWorldZ', patch.focusWorldZ)
        api.setNodeProperty(cameraNode.id, 'focusDistance', patch.focusDistance)
        api.setNodeProperty(cameraNode.id, 'focusMode', 'screen')
        api.setNodeProperty(cameraNode.id, 'focusTargetNodeId', null)
      })
    },
    [api],
  )

  const onFocusMaskPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || !camera || camera.kind !== 'camera') return
      const patch = focusPatchFromClientPoint(camera, e.clientX, e.clientY)
      if (!patch) return
      focusMaskDragRef.current = {
        pointerId: e.pointerId,
        cameraId: camera.id,
        startX: e.clientX,
        startY: e.clientY,
        latestPatch: patch,
        moved: false,
      }
      applyFocusMaskPatch(camera, patch)
      setSelection([camera.id])
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
      e.stopPropagation()
    },
    [
      applyFocusMaskPatch,
      camera,
      focusPatchFromClientPoint,
      setSelection,
    ],
  )

  const onFocusMaskPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = focusMaskDragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const focusCamera = api.getNode(drag.cameraId)
      if (!focusCamera || focusCamera.kind !== 'camera') return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < 1) return
      const patch = focusPatchFromClientPoint(focusCamera, e.clientX, e.clientY)
      if (!patch) return
      drag.moved = true
      drag.latestPatch = patch
      applyFocusMaskPatch(focusCamera, patch)
      e.preventDefault()
      e.stopPropagation()
    },
    [api, applyFocusMaskPatch, focusPatchFromClientPoint],
  )

  const onFocusMaskPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = focusMaskDragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const focusCamera = api.getNode(drag.cameraId)
      if (drag.moved && focusCamera?.kind === 'camera') {
        stampCanvasCameraPatch(focusCamera.id, drag.latestPatch)
      }
      focusMaskDragRef.current = null
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      e.preventDefault()
      e.stopPropagation()
    },
    [api, stampCanvasCameraPatch],
  )

	  const onBackgroundPointerDown = useCallback(
	    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only left-button on the workspace background, not on a NodeView.
      if (e.button !== 0) return
      // Clicks forwarded here that originated inside a node bubble up;
      // check the target carries a data-node-id to distinguish.
      // Drawing tools intentionally ignore this check — users expect
      // to be able to draw a new rect on top of / inside an existing one.
      const target = e.target as HTMLElement
      const onExistingNode = !!target.closest('[data-node-id]')

      if (tool === 'hand' || e.metaKey || spacePanning) {
        // Start pan. Alt/Opt is deliberately NOT a pan trigger — it now
        // means "show distance annotations" (Figma parity), handled by
        // DistanceOverlay. Cmd (⌘) still pans for users on trackpads
        // who prefer it, and the dedicated H tool is always available.
        panStateRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          panX: view.panX,
          panY: view.panY,
        }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        return
      }

      if (isDrawTool) {
        const viewportStart = clientToViewport(e.clientX, e.clientY)
        const workspaceOnly = !isInsideArtboard(viewportStart)
        const start = workspaceOnly
          ? viewportStart
          : clientToCanvas(e.clientX, e.clientY)
        if (!start) return
        drawStateRef.current = {
          kind: toolToKind(tool),
          pointerId: e.pointerId,
          startX: start.x,
          startY: start.y,
          workspaceOnly,
        }
        setDrawPreview({
          x: start.x,
          y: start.y,
          width: 0,
          height: 0,
          workspaceOnly,
        })
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (tool === 'select' && !onExistingNode) {
        const workspaceHit = hitTestWorkspace(e.clientX, e.clientY)
        if (workspaceHit) {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            useUI.getState().toggleInSelection(workspaceHit, true)
          } else {
            setSelection([workspaceHit])
          }
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }

	      if (!onExistingNode) {
	        if (tool === 'select') {
	          const hit = hitTestCanvas3D(e.clientX, e.clientY)
	          if (hit) {
            if (e.shiftKey || e.metaKey) {
              useUI.getState().toggleInSelection(hit.nodeId, true)
            } else {
              setSelection([hit.nodeId])
            }
            e.preventDefault()
	            return
	          }
	        }
	        if (
	          tool === 'select' &&
	          camera &&
	          camera.kind === 'camera' &&
	          selection.includes(camera.id)
	        ) {
	          const startTransform = displayedCameraTransform(camera)
	          cameraControlRef.current = {
	            pointerId: e.pointerId,
	            cameraId: camera.id,
	            mode: e.shiftKey ? 'pan' : 'rotate',
	            startX: e.clientX,
	            startY: e.clientY,
	            transform: startTransform,
	            latestTransform: startTransform,
	            startPlayhead: currentAnimationAuthorTime(),
	            startPerfTime: performance.now(),
	            lastSampleTime: currentAnimationAuthorTime(),
	            didStampStart: false,
	            moved: false,
	          }
	          setCameraPreview({ cameraId: camera.id, transform: startTransform })
	          setIsCameraManipulating(true)
	          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
	          e.preventDefault()
	          e.stopPropagation()
	          return
	        }
	        // Select-tool marquee: start a rubber-band on the empty bg.
        // Shift extends the existing selection; plain drag replaces.
        // We snapshot the initial selection here so pointer-move can
        // recompute union-with-marquee idempotently without losing the
        // user's prior picks halfway through a Shift drag.
        if (tool === 'select') {
          const viewportStart = clientToViewport(e.clientX, e.clientY)
          const workspaceOnly = !isInsideArtboard(viewportStart)
          const start = workspaceOnly
            ? viewportStart
            : clientToCanvas(e.clientX, e.clientY)
          if (start) {
            marqueeRef.current = {
              pointerId: e.pointerId,
              startX: start.x,
              startY: start.y,
              additive: e.shiftKey,
              initialSelection: e.shiftKey
                ? [...useUI.getState().selection]
                : [],
              workspaceOnly,
            }
            setMarqueeRect({
              x: start.x,
              y: start.y,
              width: 0,
              height: 0,
              workspaceOnly,
            })
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            // Only clear when starting a non-additive marquee. With
            // shift, hold the previous selection until pointer-up so
            // a tiny accidental drag doesn't blow away the user's work.
            if (!e.shiftKey) clearSelection()
            e.preventDefault()
            return
          }
        }
        clearSelection()
      }
    },
    [
	      tool,
	      isDrawTool,
	      clientToCanvas,
	      clientToViewport,
      isInsideArtboard,
      hitTestWorkspace,
	      hitTestCanvas3D,
	      setSelection,
	      currentAnimationAuthorTime,
		      camera,
		      displayedCameraTransform,
		      selection,
		      spacePanning,
		      view.panX,
	      view.panY,
	      clearSelection,
	    ],
	  )

	  const onBackgroundPointerMove = useCallback(
	    (e: React.PointerEvent<HTMLDivElement>) => {
	      const cameraControl = cameraControlRef.current
	      if (cameraControl && e.pointerId === cameraControl.pointerId) {
	        const current = api.getNode(cameraControl.cameraId)
	        if (!current || current.kind !== 'camera') return
	        const dx = e.clientX - cameraControl.startX
	        const dy = e.clientY - cameraControl.startY
	        if (!cameraControl.moved && Math.hypot(dx, dy) < 2) return
	        cameraControl.moved = true
	        let nextTransform: CameraNode['transform']
	        if (cameraControl.mode === 'rotate') {
	          const rotationX = Math.max(
	            -89,
	            Math.min(89, cameraControl.transform.rotationX - dy * 0.16),
	          )
	          const rotationY = cameraControl.transform.rotationY + dx * 0.16
	          nextTransform = {
	            ...cameraControl.transform,
	            rotationX,
	            rotationY,
	          }
	        } else {
	          const divisor = Math.max(0.1, view.zoom * cameraScaleFromZ)
	          nextTransform = {
	            ...cameraControl.transform,
	            x: cameraControl.transform.x - dx / divisor,
	            y: cameraControl.transform.y - dy / divisor,
	          }
	        }
	        cameraControl.latestTransform = nextTransform
	        applyCameraControlTransform(cameraControl.cameraId, nextTransform)
	        maybeStampCameraControlSample(cameraControl, nextTransform)
	        setCameraPreview({
	          cameraId: cameraControl.cameraId,
	          transform: nextTransform,
	        })
	        e.preventDefault()
	        return
	      }
	      const p = panStateRef.current
      if (p) {
        setView({
          panX: p.panX + e.clientX - p.startX,
          panY: p.panY + e.clientY - p.startY,
        })
        return
      }
      const d = drawStateRef.current
      if (d && e.pointerId === d.pointerId) {
        const cur = d.workspaceOnly
          ? clientToViewport(e.clientX, e.clientY)
          : clientToCanvas(e.clientX, e.clientY)
        if (!cur) return
        const x = Math.min(d.startX, cur.x)
        const y = Math.min(d.startY, cur.y)
        const width = Math.abs(cur.x - d.startX)
        const height = Math.abs(cur.y - d.startY)
        setDrawPreview({ x, y, width, height, workspaceOnly: d.workspaceOnly })
        return
      }
      const m = marqueeRef.current
      if (m && e.pointerId === m.pointerId) {
        const cur = m.workspaceOnly
          ? clientToViewport(e.clientX, e.clientY)
          : clientToCanvas(e.clientX, e.clientY)
        if (!cur) return
        const x = Math.min(m.startX, cur.x)
        const y = Math.min(m.startY, cur.y)
        const width = Math.abs(cur.x - m.startX)
        const height = Math.abs(cur.y - m.startY)
        setMarqueeRect({ x, y, width, height, workspaceOnly: m.workspaceOnly })
      }
	    },
	    [
	      api,
	      applyCameraControlTransform,
	      maybeStampCameraControlSample,
	      cameraScaleFromZ,
	      clientToCanvas,
	      clientToViewport,
	      setView,
	      view.zoom,
	    ],
	  )

	  const onBackgroundPointerUp = useCallback(
	    (e: React.PointerEvent<HTMLDivElement>) => {
	      const cameraControl = cameraControlRef.current
		      if (cameraControl && e.pointerId === cameraControl.pointerId) {
		        const current = api.getNode(cameraControl.cameraId)
		        if (cameraControl.moved && current && current.kind === 'camera') {
		          const nextTransform = cameraControl.latestTransform
		          stampCanvasTransformPatch(
		            current.id,
		            cameraControlPatch(cameraControl.mode, nextTransform),
		            currentAnimationAuthorTime(),
		          )
		        }
		        cameraControlRef.current = null
		        setCameraPreview(null)
		        setIsCameraManipulating(false)
	        try {
	          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
	        } catch {
	          /* already released */
	        }
	        return
	      }
	      if (panStateRef.current) {
        panStateRef.current = null
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        return
      }
      const m = marqueeRef.current
      if (m && e.pointerId === m.pointerId) {
        try {
          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }
        const cur = m.workspaceOnly
          ? clientToViewport(e.clientX, e.clientY)
          : clientToCanvas(e.clientX, e.clientY)
        const startX = m.startX
        const startY = m.startY
        const additive = m.additive
        const prior = m.initialSelection
        const workspaceOnly = m.workspaceOnly
        marqueeRef.current = null
        setMarqueeRect(null)
        if (!cur) return

        // Build the marquee bounds in canvas coords.
        const bx = Math.min(startX, cur.x)
        const by = Math.min(startY, cur.y)
        const bw = Math.abs(cur.x - startX)
        const bh = Math.abs(cur.y - startY)

        // Tiny drag (jitter on click) becomes a plain background click —
        // selection clears unless Shift held it open. Threshold matches
        // the draw tool's tiny-click stamp threshold for consistency.
        if (bw < 2 && bh < 2) {
          if (!additive) clearSelection()
          return
        }

        const hits: NodeId[] = []
        if (workspaceOnly) {
          for (const id of workspaceOrder) {
            const n = api.getNode(id)
            if (!n || !n.visible) continue
            const rect = workspaceRectForNode(n)
            const inherit = workspaceInheritedTransform(api, n)
            const worldRect = {
              x: rect.x + n.transform.x + inherit.x,
              y: rect.y + n.transform.y + inherit.y,
              width: rect.width,
              height: rect.height,
            }
            if (
              worldRect.x + worldRect.width >= bx &&
              worldRect.x <= bx + bw &&
              worldRect.y + worldRect.height >= by &&
              worldRect.y <= by + bh
            ) {
              hits.push(id)
            }
          }
        } else {
          // Hit-test: every solved rect that intersects the marquee
          // counts as "inside." Excludes root (no point selecting the
          // artboard itself with a drag) and cameras (they don't paint
          // and a marquee over the viewfinder shouldn't grab them).
          const layoutRects = solved ?? {}
          for (const [id, rect] of Object.entries(layoutRects)) {
            if (id === rootId) continue
            const n = api.getNode(id)
            if (!n || n.kind === 'camera') continue
            if (
              rect.x + rect.width >= bx &&
              rect.x <= bx + bw &&
              rect.y + rect.height >= by &&
              rect.y <= by + bh
            ) {
              hits.push(id)
            }
          }
        }

        // Compose with the initial selection when Shift was held at
        // drag-start. Otherwise replace.
        const next = additive
          ? Array.from(new Set([...prior, ...hits]))
          : hits
        setSelection(next)
        return
      }
      const d = drawStateRef.current
      if (d && e.pointerId === d.pointerId) {
        try {
          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }
        const cur = d.workspaceOnly
          ? clientToViewport(e.clientX, e.clientY)
          : clientToCanvas(e.clientX, e.clientY)
        drawStateRef.current = null
        setDrawPreview(null)
        if (!cur || (!rootId && !d.workspaceOnly)) return

        // Commit. Dragged bounds → size + transform.x/y under root.
        // A tiny drag (< 2px) becomes a default-sized rect at the point,
        // matching Figma: click with a shape tool stamps a default shape.
        const dragW = Math.abs(cur.x - d.startX)
        const dragH = Math.abs(cur.y - d.startY)
        const width = dragW < 2 ? 100 : dragW
        const height = dragH < 2 ? 100 : dragH
        const x = Math.min(d.startX, cur.x)
        const y = Math.min(d.startY, cur.y)

        // Honor the parent's layout mode. If the Scene has auto layout
        // (flex / grid), the newly-drawn element should flow into that
        // layout — giving it a non-zero transform would offset it from
        // where Yoga places it, which reads as "I drew it here, why did
        // it jump?" If the parent is mode='none' (free canvas), we keep
        // the dragged position as the transform so click-drag lands
        // exactly where the user pointed.
        const parentNode = d.workspaceOnly || !rootId ? null : api.getNode(rootId)
        const parentMode =
          parentNode && 'layout' in parentNode ? parentNode.layout.mode : 'none'
        const useAbsolute = d.workspaceOnly || parentMode === 'none'

        // Sizing rules:
        // - Text always prefers hug when drawn into a flex/grid parent
        //   (a 100×100 text node that wraps "Text" into a giant box looks
        //   broken; letting the measure function size it is what users
        //   expect). On a free-canvas parent, a real drag means "I want
        //   a fixed-width text frame", so respect that; a tiny click
        //   stamps a hug-hug caret like Figma does.
        // - Other shapes (rect, ellipse, frame) keep their dragged size
        //   regardless of parent — flex/grid will still position them
        //   at the start of the layout since transform stays (0, 0).
        const isTinyDrag = dragW < 2 && dragH < 2
        const textShouldHug = d.kind === 'text' && (!useAbsolute || isTinyDrag)
        const sizeProp = textShouldHug
          ? { width: 'hug' as const, height: 'hug' as const }
          : { width, height }

        const baseProps = {
          size: sizeProp,
          transform: useAbsolute
            ? {
                x,
                y,
                z: 0,
                rotation: 0,
                rotationX: 0,
                rotationY: 0,
                scaleX: 1,
                scaleY: 1,
              }
            : {
                x: 0,
                y: 0,
                z: 0,
                rotation: 0,
                rotationX: 0,
                rotationY: 0,
                scaleX: 1,
                scaleY: 1,
              },
        }
        const appearanceForKind = (kind: NodeKind) =>
          kind === 'frame'
            ? {
                opacity: 1,
                fill: null,
                stroke: null,
                cornerRadius: 0,
                effects: [],
              }
            : undefined

        const appearance = appearanceForKind(d.kind)
        const newId = api.createNode(d.kind, d.workspaceOnly ? null : rootId, {
          ...baseProps,
          position: useAbsolute ? 'absolute' : 'flow',
          workspaceOnly: d.workspaceOnly,
          ...(appearance ? { appearance } : {}),
        } as never)

        setSelection([newId])
        setTool('select')

        // Drop straight into edit mode for new text nodes — matches
        // Figma / Jitter. Skipping this step left the user looking at
        // a text box that said "Text" and had to press Enter or
        // double-click to start typing, which broke the flow of just
        // pressing T and writing.
        if (d.kind === 'text') {
          useUI.getState().setEditingTextId(newId)
        }
      }
    },
    [
      api,
      rootId,
      clientToCanvas,
      clientToViewport,
      setSelection,
      setTool,
      solved,
      workspaceOrder,
      cameraControlPatch,
      currentAnimationAuthorTime,
      stampCanvasTransformPatch,
      clearSelection,
    ],
  )

  // --- wheel: cmd/ctrl + wheel = zoom, otherwise pan -------------------
  useEffect(() => {
    const el = workspaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!el.contains(e.target as Node)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      // zoomAt wants *origin-relative* coordinates — the transform
      // container is anchored at the workspace center via CSS, so we
      // subtract the center to get the right fixed point under the
      // cursor. Using the top-left (as the old code did) made Cmd+wheel
      // zoom toward the bottom-right instead of toward the cursor.
      const ox = e.clientX - rect.left - rect.width / 2
      const oy = e.clientY - rect.top - rect.height / 2
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch registers as ctrlKey. Discrete mouse wheels too
        // when user holds Cmd. Delta is signed: up = zoom in.
        const factor = Math.exp(-e.deltaY * 0.01)
        zoomAt(view.zoom * factor, ox, oy)
      } else if (
        camera &&
        camera.kind === 'camera' &&
        selection.includes(camera.id) &&
        tool === 'select'
      ) {
        const current = api.getNode(camera.id)
        if (!current || current.kind !== 'camera') return
        const zStep = e.altKey ? 120 : 60
        const minZ = -cameraFocalLength * 220
        const maxZ = cameraFocalLength * 100 - 10
        const nextZ = Math.max(
          minZ,
          Math.min(maxZ, current.transform.z - e.deltaY * zStep),
        )
        api.setNodeProperty(current.id, 'transform', {
          ...current.transform,
          z: nextZ,
        })
        stampCanvasTransformPatch(current.id, { z: nextZ })
      } else {
        setView({ panX: view.panX - e.deltaX, panY: view.panY - e.deltaY })
      }
    }
    // React only synthesizes wheel as passive; we need to preventDefault
    // to stop the page from scrolling under Cmd+wheel, so attach native.
    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [
    api,
    camera,
    selection,
    stampCanvasTransformPatch,
    tool,
    view.zoom,
    view.panX,
    view.panY,
    zoomAt,
    setView,
  ])

  const workspaceCursor =
    focusPickingCameraId
      ? 'crosshair'
      : tool === 'hand' || spacePanning
      ? panStateRef.current
        ? 'grabbing'
        : 'grab'
      : isDrawTool
        ? 'crosshair'
        : undefined

  // --- native drag-drop: component / image import ----------------------
  // Tracks the "a dragged file is hovering over the canvas" state so the
  // UI can show a visible drop target. dragenter/dragover fire many times
  // during a hover; a boolean is enough — we don't need to count enters.
  const [isFileDragging, setIsFileDragging] = useState(false)
  const dragDepthRef = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (
      !e.dataTransfer.types.includes('Files') &&
      !e.dataTransfer.types.includes('text/hyper-motion-component')
    ) return
    dragDepthRef.current += 1
    setIsFileDragging(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (
      !e.dataTransfer.types.includes('Files') &&
      !e.dataTransfer.types.includes('text/hyper-motion-component')
    ) return
    // Required to allow `drop` to fire — the browser assumes you're
    // rejecting the drag unless you preventDefault on dragover.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (
      !e.dataTransfer.types.includes('Files') &&
      !e.dataTransfer.types.includes('text/hyper-motion-component')
    ) return
    // Nested elements fire leave/enter pairs during traversal. Use a
    // depth counter so the highlight only clears when the drag truly
    // exits the workspace, not when crossing a child boundary.
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsFileDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      const componentId = e.dataTransfer.getData('text/hyper-motion-component')
      if (
        !componentId &&
        (!e.dataTransfer.files || e.dataTransfer.files.length === 0)
      ) return
      e.preventDefault()
      dragDepthRef.current = 0
      setIsFileDragging(false)
      const viewportDrop = clientToViewport(e.clientX, e.clientY)
      const workspaceOnly = !isInsideArtboard(viewportDrop)
      if (!rootId && !workspaceOnly) return

      const dropPos = workspaceOnly
        ? viewportDrop ?? undefined
        : clientToCanvas(e.clientX, e.clientY) ?? undefined
      if (componentId) {
        const id = instantiateComponent(api, componentId, workspaceOnly ? null : rootId, {
          absolute: true,
          workspaceOnly,
          position: dropPos
            ? { x: Math.round(dropPos.x), y: Math.round(dropPos.y) }
            : undefined,
        })
        if (id) {
          setSelection([id])
          setTool('select')
        }
        return
      }

      const allFiles = Array.from(e.dataTransfer.files)
      const imageFiles = allFiles.filter(isImageFile)
      // isImageFile matches SVG by extension, which would also match our
      // media test if we ever added SVG video — guard by excluding any
      // file already claimed by the image path so a file isn't imported
      // twice.
      const mediaFiles = allFiles.filter(
        (f) => !isImageFile(f) && isMediaFile(f),
      )
      if (imageFiles.length === 0 && mediaFiles.length === 0) return

      // Drop at the pointer location in canvas coordinates so the asset
      // lands where the user let go, not at the artboard center.
      const ids: NodeId[] = []
      if (imageFiles.length > 0) {
        ids.push(
          ...(await importImageFiles(imageFiles, api, workspaceOnly ? null : rootId, {
            dropPos: dropPos ?? undefined,
            workspaceOnly,
          })),
        )
      }
      if (mediaFiles.length > 0) {
        ids.push(
          ...(await importMediaFiles(mediaFiles, api, workspaceOnly ? null : rootId, {
            dropPos: dropPos ?? undefined,
            workspaceOnly,
          })),
        )
      }
      if (ids.length > 0) {
        setSelection(ids)
        setTool('select')
      }
    },
    [api, rootId, clientToCanvas, clientToViewport, isInsideArtboard, setSelection, setTool],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditablePasteTarget(e.target)) return

      const importFiles = async (files: File[]) => {
        const ids = await importClipboardFiles(files, api, rootId, {
          workspaceOnly: false,
        })
        if (ids.length > 0) {
          setSelection(ids)
          setTool('select')
        }
        return ids.length > 0
      }

      const eventFiles = filesFromClipboardEvent(e)
      if (eventFiles.length > 0) {
        e.preventDefault()
        void importFiles(eventFiles)
        return
      }

      const bridge = window.hypermotion?.clipboard
      if (!bridge?.readFiles) return
      void readElectronClipboardFiles()
        .then(async (files) => {
          if (files.length === 0) return
          await importFiles(files)
        })
        .catch((err) => {
          console.warn('[clipboard-file-paste] failed:', err)
        })
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [api, rootId, setSelection, setTool])

  return (
    <main
      ref={workspaceRef}
      className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-app-bg"
      onPointerDownCapture={onFocusPickPointerDownCapture}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onBackgroundPointerMove}
      onPointerUp={onBackgroundPointerUp}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ cursor: workspaceCursor, touchAction: 'none' }}
    >
      {/* Single transform container for both scene paint + selection overlay.
          Placing the transform here (absolute, top-left) with explicit pan
          and scale is more predictable than transforming a flex-centered
          box — the math for click-to-canvas stays linear.

          `data-canvas-workspace="1"` lets export-mode CSS strip the
          transform + centering so the artboard sits at viewport (0,0)
          during capture. Without that, the artboard's bounding rect can
          have negative coordinates (centered = anchor at workspace
          middle), and CDP captures black from regions outside the
          document. */}
      <div
        data-canvas-workspace="1"
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <div
          className="relative border border-border-strong shadow-2xl"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            // Nudge the canvas box so its center aligns with the transform
            // origin when zoom=1 and pan=(0,0). Combined with the `left-1/2
            // top-1/2` above, the scene sits centered in the workspace by
            // default; pan modifies translate from there.
            marginLeft: -canvasWidth / 2,
            marginTop: -canvasHeight / 2,
            overflow: 'hidden',
            // Workspace panel color as the always-present fallback.
            // The camera's own viewport background (when set) paints
            // on top of this via a dedicated child div below — that
            // way we can support solid / gradient / image fills with
            // proper background-size handling for images.
            background: 'var(--color-panel)',
            borderRadius: Math.max(0, sceneCorner),
            // Perspective on the parent so the child camera-transform's
            // rotateX/rotateY actually foreshorten layers (otherwise CSS
            // collapses 3D rotations to a flat shear). Matched to
            // FOCAL_LENGTH so the perceived 3D matches the same focal
            // length the perspective-scale code uses for cameraScaleFromZ.
            perspective: cameraFocalLength,
            perspectiveOrigin: 'center center',
          }}
          data-canvas-root
        >
          {/* Camera viewport background — paints across the entire
              artboard window when the camera carries a `background`
              fill. Sits below the camera-transform wrapper so it
              stays put when the user pans / zooms the camera, which
              is exactly the "world backdrop" effect: pull the camera
              back, see your scene shrink, see the backdrop framing it.
              Image fills get the full background-* bundle so `cover` /
              `contain` / `tile` all work. */}
          {cameraBackgroundStyle ? (
            <div
              key="camera-background"
              className="pointer-events-none absolute inset-0"
              style={cameraBackgroundStyle}
            />
          ) : null}
          {/* Checkerboard sits on the OUTER canvas-root, anchored to the
              viewport box so users always see "this is your artboard
              window" even when the camera pans the scene paint inside
              it. Hidden when the camera carries its own background
              fill — at that point the user has explicitly chosen what
              should sit behind the scene, and the checkerboard would
              just dirty the look. */}
          {!cameraBackgroundCss && (
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.05]"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #fff 25%, transparent 25%), linear-gradient(-45deg, #fff 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #fff 75%), linear-gradient(-45deg, transparent 75%, #fff 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
              }}
            />
          )}
          {!solved ? (
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[11px] text-text-dim">
              {rootId ? 'preparing layout…' : 'empty scene'}
            </span>
          ) : (
            <div
              className="absolute inset-0"
              style={{
                transformStyle: 'preserve-3d',
              }}
            >
              {camera && camera.kind === 'camera' ? (
                <>
                  <div
                    className="absolute inset-0"
                    style={{
                      opacity: threeCameraAvailable ? 0 : 1,
                      pointerEvents: threeCameraAvailable ? 'none' : undefined,
                    }}
                  >
                    <ScenePostProcessLayer
                      rootId={rootId}
                      solved={solved}
                      order={renderOrder}
                      animated={animated}
                      inherited={inherited}
                      cameraDepthOfField={
                        threeCameraAvailable ? null : previewCameraDepthOfField
                      }
                      sceneFill={sceneFill}
                      canvasWidth={canvasWidth}
                      canvasHeight={canvasHeight}
                      sceneCorner={sceneCorner}
                      includeSceneFill
                      textureSource
                      sceneContentStyle={
                        threeCameraAvailable
                          ? undefined
                          : cameraTransform
                            ? {
                                transform: cameraTransform,
                                transformOrigin: '0 0',
                                transformStyle: 'preserve-3d',
                                backfaceVisibility: 'visible',
                              }
                            : undefined
                      }
                    />
                  </div>
                  <ThreeSceneViewport
                    api={api}
                    layout={solved}
                    animated={animated}
                    camera={camera}
                    cameraAnim={liveCameraAnim}
                    width={canvasWidth}
                    height={canvasHeight}
                    sceneFill={sceneFill}
                    selectedIds={selection}
                    showHelpers={false}
                    showPlanes
                    exportable
                    playing={playing}
                    playhead={playhead}
                    sceneVersion={version}
                    onAvailabilityChange={setThreeCameraAvailable}
                  />
                  {selection.includes(camera.id) ||
                  focusPickingCameraId === camera.id ||
                  !!camera.showFocusPlane ? (
                    <ThreeSceneViewport
                      api={api}
                      layout={solved}
                      animated={animated}
                      camera={camera}
                      cameraAnim={liveCameraAnim}
                      width={canvasWidth}
                      height={canvasHeight}
                      sceneFill={null}
                      selectedIds={selection}
                      showHelpers={focusPickingCameraId === camera.id}
                      showPlanes={false}
                      playing={playing}
                      playhead={playhead}
                      sceneVersion={version}
                      focusWorldPoint={
                        focusTargetWorld ??
	                        (previewCameraDepthOfField
	                          ? {
	                              x: previewCameraDepthOfField.focusWorldX,
	                              y: previewCameraDepthOfField.focusWorldY,
	                              z: previewCameraDepthOfField.focusWorldZ,
	                            }
	                          : null)
                      }
                    />
                  ) : null}
                  {camera.showFocusPlane || focusPickingCameraId === camera.id ? (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={
                        cameraTransform
                          ? {
                              transform: cameraTransform,
                              transformOrigin: '0 0',
                              transformStyle: 'preserve-3d',
                            }
                          : undefined
                      }
                    >
                      <DomFocusPlaneOverlay
                        camera={camera}
                        cameraAnim={liveCameraAnim}
                        cameraDepthOfField={previewCameraDepthOfField}
                        canvasWidth={canvasWidth}
                        canvasHeight={canvasHeight}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  {sceneFill ? (
                    <div
                      className="pointer-events-none absolute"
                      style={{
                        left: 0,
                        top: 0,
                        width: canvasWidth,
                        height: canvasHeight,
                        background: sceneFill,
                        borderRadius: Math.max(0, sceneCorner),
                      }}
                    />
                  ) : null}
                  <ScenePostProcessLayer
                    rootId={rootId}
                    solved={solved}
                    order={renderOrder}
                    animated={animated}
                    inherited={inherited}
                    cameraDepthOfField={previewCameraDepthOfField}
                    sceneFill={sceneFill}
                    canvasWidth={canvasWidth}
                    canvasHeight={canvasHeight}
                    sceneCorner={sceneCorner}
                  />
                </>
              )}
            </div>
          )}
        </div>

        <WorkspaceLayer
          order={workspaceOrder}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          zoom={view.zoom}
        />
        {drawPreview?.workspaceOnly ? (
          <div
            className="pointer-events-none absolute"
            data-export-hide="1"
            style={{
              left: -canvasWidth / 2 + drawPreview.x,
              top: -canvasHeight / 2 + drawPreview.y,
              width: Math.max(1, drawPreview.width),
              height: Math.max(1, drawPreview.height),
              border: `${1 / Math.max(view.zoom, 0.001)}px dashed var(--color-accent)`,
              background: 'var(--color-accent-soft)',
              borderRadius: tool === 'ellipse' ? '9999px' : 2,
            }}
          />
        ) : null}
        {marqueeRect?.workspaceOnly ? (
          <div
            className="pointer-events-none absolute"
            data-export-hide="1"
            style={{
              left: -canvasWidth / 2 + marqueeRect.x,
              top: -canvasHeight / 2 + marqueeRect.y,
              width: Math.max(1, marqueeRect.width),
              height: Math.max(1, marqueeRect.height),
              border: `${1 / Math.max(view.zoom, 0.001)}px solid var(--color-accent)`,
              background:
                'color-mix(in oklab, var(--color-accent) 12%, transparent)',
            }}
          />
        ) : null}

        {/* Selection/editor overlays sit in canvas coordinates. Keep this
            clipped to the artboard bounds so camera tilt / dolly helpers
            never spill into the neutral workspace beside the scene.

            `data-export-hide="1"` removes this entire chrome layer
            (selection rings, resize handles, camera viewfinder gizmo,
            distance hints) from the captured stream during tab-capture
            export. None of these are scene content — they're editor
            affordances that don't belong in the output WebM. */}
        <div
          className="pointer-events-none absolute overflow-hidden"
          data-export-hide="1"
          style={{
            left: -canvasWidth / 2,
            top: -canvasHeight / 2,
            width: canvasWidth,
            height: canvasHeight,
            borderRadius: Math.max(0, sceneCorner),
          }}
        >
          {/* Camera viewfinder gizmo. Drawn OUTSIDE the camera-transform
              wrapper so it shows where the camera is in scene space
              (the rect doesn't compose with the very transform it
              represents). Visible when the user has Camera selected,
              so the panel doesn't gain extra noise during normal
              editing. */}
          {camera && camera.kind === 'camera' ? (
            <CameraGizmo
              camera={camera}
              cameraAnim={liveCameraAnim}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              zoom={view.zoom}
              selected={selection.includes(camera.id)}
            />
          ) : null}
          <div
            className="pointer-events-none absolute inset-0"
            style={
	              camera && camera.kind === 'camera' && cameraTransform
	                ? {
	                    transform: cameraTransform,
	                    transformOrigin: '0 0',
	                    transformStyle: 'preserve-3d',
	                  }
	                : undefined
            }
          >
            {solved && (
              <SelectionOverlay
                solved={solved}
                animated={animated}
                inherited={inherited}
                zoom={view.zoom}
              />
            )}
            {solved && (
              <DistanceOverlay
                solved={solved}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
                zoom={view.zoom}
                workspaceRef={workspaceRef}
                view={view}
                rootId={rootId}
              />
            )}
            {drawPreview && !drawPreview.workspaceOnly ? (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: drawPreview.x,
                  top: drawPreview.y,
                  width: Math.max(1, drawPreview.width),
                  height: Math.max(1, drawPreview.height),
                  border: `${1 / Math.max(view.zoom, 0.001)}px dashed var(--color-accent)`,
                  background: 'var(--color-accent-soft)',
                  borderRadius: tool === 'ellipse' ? '9999px' : 2,
                }}
              />
            ) : null}
            {marqueeRect && !marqueeRect.workspaceOnly ? (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: marqueeRect.x,
                  top: marqueeRect.y,
                  width: Math.max(1, marqueeRect.width),
                  height: Math.max(1, marqueeRect.height),
                  // Thinner solid border than the draw preview so the
                  // two visuals don't get confused when both happen on
                  // adjacent gestures. Accent color + low-opacity fill
                  // reads as "I'm selecting" rather than "I'm drawing."
                  border: `${1 / Math.max(view.zoom, 0.001)}px solid var(--color-accent)`,
                  background: 'color-mix(in oklab, var(--color-accent) 12%, transparent)',
                }}
              />
            ) : null}
          </div>
        </div>
        {previewCameraDepthOfField?.enabled &&
        camera &&
        camera.kind === 'camera' &&
        (selection.includes(camera.id) ||
          focusPickingCameraId === camera.id ||
          camera.showFocusPlane) ? (
          <CameraFocusMaskOverlay
            cameraDepthOfField={previewCameraDepthOfField}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            zoom={view.zoom}
            sceneCorner={sceneCorner}
            onPointerMove={onFocusMaskPointerMove}
            onPointerUp={onFocusMaskPointerUp}
            onHandlePointerDown={onFocusMaskPointerDown}
            onHandlePointerMove={onFocusMaskPointerMove}
            onHandlePointerUp={onFocusMaskPointerUp}
          />
        ) : null}
      </div>

      {/* Zoom indicator. `data-export-hide` removes it from any
          frame the export pipeline captures — it's editor chrome,
          not scene content. */}
      <div
        className="pointer-events-none absolute bottom-3 right-3 rounded bg-panel/80 px-2 py-1 font-mono text-[10px] text-text-muted backdrop-blur"
        data-export-hide="1"
      >
        {Math.round(view.zoom * 100)}%
      </div>

      {/* Floating tool dock — sits inside the canvas zone, centered
          horizontally, 16px above the bottom edge. Lives here (not
          App.Shell) so it's positioned relative to the canvas
          workspace and never bleeds into the Timeline below. */}
      <FloatingDock />

      {focusPickingCameraId ? (
        <div
          className="pointer-events-none absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded border border-border-strong bg-panel/95 px-3 py-2 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted shadow-lg"
          data-export-hide="1"
        >
          Click anywhere to set focus
        </div>
      ) : null}

      {/* File-drop highlight. Shown while a file drag hovers over the
          workspace. Pointer-events off so it doesn't eat the `drop` /
          `dragleave` events on the workspace itself. */}
      {isFileDragging ? (
        <div className="pointer-events-none absolute inset-2 rounded-md border-2 border-dashed border-accent/70 bg-accent/[0.06]">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-panel/90 px-3 py-1.5 font-mono text-[11px] text-accent shadow-lg">
            Drop to import image
          </div>
        </div>
      ) : null}
    </main>
  )
}

function toolToKind(tool: Tool): NodeKind {
  // The tool palette uses narrower names than the scene kinds
  // (rect vs rectangle). The palette wins on brevity; this mapping keeps
  // the data model canonical.
  switch (tool) {
    case 'rect':
      return 'rect'
    case 'ellipse':
      return 'ellipse'
    case 'text':
      return 'text'
    case 'frame':
      return 'frame'
    default:
      // Called only after DRAW_TOOLS check; fall back to rect defensively.
      return 'rect'
  }
}

// ---------------------------------------------------------------------------
// Scene paint layer
// ---------------------------------------------------------------------------

function WorkspaceLayer({
  order,
  canvasWidth,
  canvasHeight,
  zoom,
}: {
  order: NodeId[]
  canvasWidth: number
  canvasHeight: number
  zoom: number
}) {
  const api = useSceneAPI()
  const openContextMenu = useUI((s) => s.openContextMenu)
  const selection = useUI((s) => s.selection)
  const setSelection = useUI((s) => s.setSelection)

  const inherited = useMemo(() => {
    const map: Record<NodeId, InheritedAnim> = {}
    const visit = (id: NodeId, inherit: InheritedAnim) => {
      const node = api.getNode(id)
      if (!node) return
      map[id] = inherit
      const next: InheritedAnim = {
        x: inherit.x + node.transform.x,
        y: inherit.y + node.transform.y,
        z: inherit.z + node.transform.z,
        rotation: inherit.rotation + node.transform.rotation,
        rotationX: inherit.rotationX + node.transform.rotationX,
        rotationY: inherit.rotationY + node.transform.rotationY,
        scaleX: inherit.scaleX * node.transform.scaleX,
        scaleY: inherit.scaleY * node.transform.scaleY,
        opacity: inherit.opacity * node.appearance.opacity,
      }
      for (const child of api.getChildren(id)) visit(child.id, next)
    }
    for (const id of order) {
      const node = api.getNode(id)
      if (node?.parent === null) visit(id, IDENTITY_INHERITED)
    }
    return map
  }, [api, order])

  if (order.length === 0) return null

  return (
    <div
      className="absolute overflow-visible"
      data-export-hide="1"
      style={{
        left: -canvasWidth / 2,
        top: -canvasHeight / 2,
        width: canvasWidth,
        height: canvasHeight,
      }}
    >
      {order.map((id) => {
        const node = api.getNode(id)
        if (!node || !node.visible) return null
        const rect = workspaceRectForNode(node)
        const inherit = inherited[id] ?? IDENTITY_INHERITED
        const selected = selection.includes(id)
        const selectedX = rect.x + node.transform.x + inherit.x
        const selectedY = rect.y + node.transform.y + inherit.y
        return (
          <div key={id} className="absolute left-0 top-0">
            <NodeView
              node={node}
              rect={rect}
              anim={undefined}
              inherit={inherit}
              isRoot={false}
              isSelected={selected}
              onClick={(e) => {
                e.stopPropagation()
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const targetIds = selection.includes(id) ? selection : [id]
                if (!selection.includes(id)) setSelection([id])
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: buildNodeContextMenu(api, targetIds),
                })
              }}
            />
            {selected ? (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: selectedX,
                  top: selectedY,
                  width: rect.width,
                  height: rect.height,
                  border: `${1.5 / Math.max(zoom, 0.001)}px solid oklch(0.64 0.24 300)`,
                  boxShadow: `0 0 0 ${3 / Math.max(zoom, 0.001)}px oklch(0.64 0.24 300 / 0.16)`,
                }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function workspaceRectForNode(node: SceneNode): Rect {
  const width =
    'size' in node
      ? numericSizeAxis(node.size.width, node.kind === 'text' ? 72 : 100)
      : 100
  const height =
    'size' in node
      ? numericSizeAxis(node.size.height, node.kind === 'text' ? 24 : 100)
      : 100
  if (node.kind === 'text') {
    const textWidth = Math.max(24, node.text.length * node.fontSize * 0.58)
    return {
      x: 0,
      y: 0,
      width: node.size.width === 'hug' ? textWidth : width,
      height: node.size.height === 'hug' ? node.fontSize * node.lineHeight : height,
    }
  }
  return {
    x: 0,
    y: 0,
    width,
    height,
  }
}

function workspaceInheritedTransform(api: SceneAPI, node: SceneNode): InheritedAnim {
  let inherit = IDENTITY_INHERITED
  let parentId = node.parent
  const ancestors: SceneNode[] = []
  while (parentId) {
    const parent = api.getNode(parentId)
    if (!parent) break
    ancestors.push(parent)
    parentId = parent.parent
  }
  for (const parent of ancestors.reverse()) {
    inherit = {
      x: inherit.x + parent.transform.x,
      y: inherit.y + parent.transform.y,
      z: inherit.z + parent.transform.z,
      rotation: inherit.rotation + parent.transform.rotation,
      rotationX: inherit.rotationX + parent.transform.rotationX,
      rotationY: inherit.rotationY + parent.transform.rotationY,
      scaleX: inherit.scaleX * parent.transform.scaleX,
      scaleY: inherit.scaleY * parent.transform.scaleY,
      opacity: inherit.opacity * parent.appearance.opacity,
    }
  }
  return inherit
}

function numericSizeAxis(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Paints the scene graph into an absolutely-positioned tree of NodeView
 * divs. Exported so the render-window shell can reuse the exact same
 * paint code as the editor — the only differences between editor and
 * render-window rendering are chrome (overlays, gizmos, dock) and the
 * surrounding workspace transform. Everything below this line is
 * identical in both paths, which is the whole point: what you see in
 * the editor is bit-for-bit what gets exported.
 */
export function SceneLayer({
  rootId,
  solved,
  order,
  animated,
  inherited,
}: {
  rootId: NodeId | null
  solved: SolvedLayout
  order: NodeId[]
  animated: Record<NodeId, AnimatedValue>
  inherited: Record<NodeId, InheritedAnim>
}) {
  const api = useSceneAPI()
  const sceneVersion = useSceneVersion() // re-render on mutations
  const openContextMenu = useUI((s) => s.openContextMenu)
  const selection = useUI((s) => s.selection)
  const setSelection = useUI((s) => s.setSelection)

  const onNodeContext = (id: NodeId, clientX: number, clientY: number) => {
    // If the right-clicked node isn't in the current selection, replace
    // selection with it. Keeps the menu actions matching visible state.
    const targetIds = selection.includes(id) ? selection : [id]
    if (!selection.includes(id)) setSelection([id])
    openContextMenu({
      x: clientX,
      y: clientY,
      items: buildNodeContextMenu(api, targetIds),
    })
  }

  // Precompute "effective visibility" — a node is rendered only when
  // it AND every ancestor up to root are visible. Without this, hiding
  // a parent in the Layers panel left every child painted on the
  // canvas (matches Figma's behavior: hiding a frame hides everything
  // inside it). Walk the tree once per render so children inherit
  // their ancestor's visibility flag.
  const hiddenIds = useMemo(() => {
    const hidden = new Set<NodeId>()
    if (!rootId) return hidden
    const walk = (id: NodeId, parentHidden: boolean) => {
      const n = api.getNode(id)
      if (!n) return
      const eff = parentHidden || !n.visible
      if (eff) hidden.add(id)
      for (const c of api.getChildren(id)) walk(c.id, eff)
    }
    walk(rootId, false)
    return hidden
  }, [api, rootId, order, sceneVersion])

  // Per-node clip rect, derived from the closest ancestor frame whose
  // `clipsContent` is true. Needed because the renderer flattens the
  // scene tree — every node is an absolute sibling under the camera-
  // transform wrapper, so a parent frame's `overflow:hidden` has no
  // descendants in its DOM subtree to clip. Without this map, anything
  // larger than its parent (or positioned outside it) would bleed onto
  // siblings — exactly the bug the user reported.
  //
  // We walk the scene tree from root, accumulating the active clip
  // rect as we descend. When we cross a clipping frame, the current
  // clip becomes that frame's rect intersected with whatever clip we
  // were already inside — so a deeply nested clip-in-clip-in-clip
  // composes correctly.
  //
  // Skip the root in the clip map: the artboard div already applies
  // `overflow:hidden` at the DOM level, so root-level clipping is
  // handled by the canvas chrome and doesn't need a per-node clip-path.
  const ancestorClip = useMemo(() => {
    const map: Record<NodeId, ClipHit> = {}
    if (!rootId) return map
    const visit = (id: NodeId, currentClip: ClipHit | null) => {
      if (currentClip && id !== rootId) map[id] = currentClip
      const node = api.getNode(id)
      if (!node) return
      let nextClip: ClipHit | null = currentClip
      // The root's own clipsContent is already enforced by the artboard
      // div's overflow:hidden, so we don't fold it into the per-node
      // clip map — would just paint a redundant inset(0 0 0 0) on every
      // top-level child.
      if (node.kind === 'frame' && node.clipsContent && id !== rootId) {
        const r = solved[id]
        if (r) {
          const inherit = inherited[id] ?? IDENTITY_INHERITED
          const ownX = animated[id]?.x ?? node.transform.x
          const ownY = animated[id]?.y ?? node.transform.y
          // `solved` stores layout-space rects. Clipping, however,
          // happens in rendered world-space. Imported Figma roots are
          // centered with transform.x/y, and animated frames can move
          // too, so the clip wrapper must follow that translated frame
          // or it masks descendants at the stale pre-transform origin.
          const renderedRect: Rect = {
            ...r,
            x: r.x + ownX + inherit.x,
            y: r.y + ownY + inherit.y,
          }
          const nodeClip: ClipHit = {
            rect: renderedRect,
            cornerRadius: animated[id]?.cornerRadius ?? node.appearance.cornerRadius,
            cornerRadii: node.appearance.cornerRadii,
          }
          if (currentClip) {
            const x1 = Math.max(currentClip.rect.x, renderedRect.x)
            const y1 = Math.max(currentClip.rect.y, renderedRect.y)
            const x2 = Math.min(
              currentClip.rect.x + currentClip.rect.width,
              renderedRect.x + renderedRect.width,
            )
            const y2 = Math.min(
              currentClip.rect.y + currentClip.rect.height,
              renderedRect.y + renderedRect.height,
            )
            nextClip = {
              ...nodeClip,
              rect: {
                x: x1,
                y: y1,
                width: Math.max(0, x2 - x1),
                height: Math.max(0, y2 - y1),
              },
            }
          } else {
            nextClip = nodeClip
          }
        }
      }
      for (const c of api.getChildren(id)) visit(c.id, nextClip)
    }
    visit(rootId, null)
    return map
  }, [api, rootId, solved, order, sceneVersion, animated])

  // Mask info — for each node whose previous sibling carries
  // `isMask: true`, record the mask shape's solved rect + kind + corner
  // radius so NodeView can derive a CSS clip-path.
  //
  // Mask convention: sibling[i] with isMask=true clips sibling[i+1].
  // Only the immediate next sibling is masked (Figma's MVP behavior).
  // Multi-layer masking ("clip everything above") is a follow-up if
  // users ask for it — most motion-graphics masks are 1:1.
  //
  // Limitation in this MVP: clip-path is applied to the masked node's
  // own box in box-local coords. That means animating the masked
  // node's transform also drags the clip with it — fine for static
  // masks (avatar circles, container reveals where mask + content
  // share a parent that animates as a unit), wrong for "content
  // slides through a stationary mask" reveals. Real reveal behavior
  // needs a world-space clip wrapper; defer until requested.
  type MaskHit = {
    rect: Rect
    kind: NodeKind
    corner: number
  }
  const maskInfo = useMemo(() => {
    const map: Record<NodeId, MaskHit> = {}
    if (!rootId) return map
    const visit = (id: NodeId) => {
      const kids = api.getChildren(id)
      for (let i = 0; i < kids.length - 1; i++) {
        const masker = kids[i]!
        if (!masker.isMask) continue
        const masked = kids[i + 1]!
        const maskerRect = solved[masker.id]
        if (!maskerRect) continue
        // Corner radius — frames carry it on appearance.cornerRadius; rect
        // and ellipse don't have a separate field. For ellipse we let
        // the kind drive the clip path (clip-path: ellipse(...)) and
        // corner is unused; for rect/frame we read appearance.cornerRadius
        // when present.
        const corner = maxCornerRadius(
          masker.appearance.cornerRadius,
          masker.appearance.cornerRadii,
        )
        map[masked.id] = {
          rect: maskerRect,
          kind: masker.kind,
          corner,
        }
      }
      for (const k of kids) visit(k.id)
    }
    visit(rootId)
    return map
  }, [api, rootId, solved, sceneVersion])

  return (
    <>
      {order.map((id) => {
        const node = api.getNode(id)
        const rect = solved[id]
        if (!node || !rect || hiddenIds.has(id)) return null
        const inherit = inherited[id] ?? IDENTITY_INHERITED
        return (
          <NodeView
            key={id}
            node={node}
            rect={rect}
            anim={animated[id]}
            inherit={inherit}
            isRoot={id === rootId}
            isSelected={selection.includes(id)}
            ancestorClip={ancestorClip[id]}
            maskedBy={maskInfo[id]}
            onClick={(e) => {
              e.stopPropagation()
            }}
            onContextMenu={(e) => {
              // Skip context menu on the root — there's nothing useful
              // to do on the artboard itself.
              if (id === rootId) return
              e.preventDefault()
              e.stopPropagation()
              onNodeContext(id, e.clientX, e.clientY)
            }}
          />
        )
      })}
      {order.map((id) => {
        const node = api.getNode(id)
        const rect = solved[id]
        if (!node || !rect || hiddenIds.has(id)) return null
        return (
          <ClippedFrameStrokeOverlay
            key={`stroke-${id}`}
            node={node}
            rect={rect}
            anim={animated[id]}
            inherit={inherited[id] ?? IDENTITY_INHERITED}
            isRoot={id === rootId}
          />
        )
      })}
    </>
  )
}

/**
 * Paint clipped-frame strokes in a final overlay pass.
 *
 * The DOM renderer flattens the scene tree, so children are siblings
 * painted after their parent. A clipped card with a footer child can
 * therefore cover the parent's inside stroke at the bottom. Figma
 * paints frame strokes above children; this overlay restores that
 * ordering for clipped frames without changing layout.
 */
function ClippedFrameStrokeOverlay({
  node,
  rect,
  anim,
  inherit,
  isRoot,
}: {
  node: SceneNode
  rect: Rect
  anim: AnimatedValue | undefined
  inherit: InheritedAnim
  isRoot: boolean
}) {
  if (isRoot || node.kind !== 'frame' || !node.clipsContent) return null

  const stroke = node.appearance.stroke
  if (!stroke || stroke.width <= 0) return null

  const strokeStyle = stroke.style ?? 'solid'
  const strokeHasGradient = !!stroke.fill && stroke.fill.kind !== 'solid'
  const hasPerSideStroke =
    !!stroke.widths && strokeStyle === 'solid' && !strokeHasGradient
  if (hasPerSideStroke) return null

  const ownX = anim?.x ?? node.transform.x
  const ownY = anim?.y ?? node.transform.y
  const ownRot = anim?.rotation ?? node.transform.rotation
  const ownSX = anim?.scaleX ?? node.transform.scaleX
  const ownSY = anim?.scaleY ?? node.transform.scaleY
  const ownOp = anim?.opacity ?? node.appearance.opacity
  const tx = ownX + inherit.x
  const ty = ownY + inherit.y
  const tz = (anim?.z ?? node.transform.z) + inherit.z
  const rotation = ownRot + inherit.rotation
  const rotationX = (anim?.rotationX ?? node.transform.rotationX) + inherit.rotationX
  const rotationY = (anim?.rotationY ?? node.transform.rotationY) + inherit.rotationY
  const sx = ownSX * inherit.scaleX
  const sy = ownSY * inherit.scaleY
  const opacity = ownOp * inherit.opacity
  const anchorX = anim?.anchorX ?? node.transform.anchorX ?? 0.5
  const anchorY = anim?.anchorY ?? node.transform.anchorY ?? 0.5
  const anchorZ = anim?.anchorZ ?? node.transform.anchorZ ?? 0
  const transformOrigin = `${Number((anchorX * 100).toFixed(3))}% ${Number((anchorY * 100).toFixed(3))}% ${Number(anchorZ.toFixed(3))}px`

  const parts: string[] = []
  const transformSpace = node.transform.space ?? 'local'
  if (tx !== 0 || ty !== 0) parts.push(`translate(${tx}px, ${ty}px)`)
  if (transformSpace === 'world' && tz !== 0) parts.push(`translateZ(${tz}px)`)
  if (rotationX !== 0) parts.push(`rotateX(${rotationX}deg)`)
  if (rotationY !== 0) parts.push(`rotateY(${rotationY}deg)`)
  if (rotation !== 0) parts.push(`rotate(${rotation}deg)`)
  if (transformSpace === 'local' && tz !== 0) parts.push(`translateZ(${tz}px)`)
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`)
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        opacity,
        transform: parts.length > 0 ? parts.join(' ') : undefined,
        transformOrigin,
        transformStyle: 'preserve-3d',
      }}
    >
      <StrokeOverlay
        stroke={stroke}
        width={rect.width}
        height={rect.height}
        cornerRadius={maxCornerRadius(
          anim?.cornerRadius ?? node.appearance.cornerRadius,
          node.appearance.cornerRadii,
        )}
      />
    </div>
  )
}

/**
 * Scene-level effects compositor.
 *
 * This is intentionally a whole-scene pass, not a NodeView/per-layer
 * filter. Future shader work should plug in here: render a source scene
 * pass, then apply masks/effects to the composed scene or to explicitly
 * selected subtrees. `group3d` remains below this layer in the normal
 * scene renderer, so DOM auto-layout and 3D grouping are preserved.
 */
export function ScenePostProcessLayer({
  rootId,
  solved,
  order,
  animated,
  inherited,
  cameraDepthOfField,
  sceneFill,
  canvasWidth,
  canvasHeight,
  sceneCorner,
  sceneContentStyle,
  includeSceneFill = false,
  textureSource = false,
}: {
  rootId: NodeId | null
  solved: SolvedLayout
  order: NodeId[]
  animated: Record<NodeId, AnimatedValue>
  inherited: Record<NodeId, InheritedAnim>
  cameraDepthOfField?: CameraDepthOfField | null
  sceneFill: string | null
  canvasWidth: number
  canvasHeight: number
  sceneCorner: number
  sceneContentStyle?: CSSProperties
  includeSceneFill?: boolean
  textureSource?: boolean
}) {
  const sceneBody = (
    <>
      {includeSceneFill && sceneFill ? (
        <div
          className="pointer-events-none absolute"
          style={{
            left: 0,
            top: 0,
            width: canvasWidth,
            height: canvasHeight,
            background: sceneFill,
            borderRadius: Math.max(0, sceneCorner),
          }}
        />
      ) : null}
      <SceneLayer
        rootId={rootId}
        solved={solved}
        order={order}
        animated={animated}
        inherited={inherited}
      />
    </>
  )
  const scene = sceneContentStyle || textureSource ? (
    <div
      data-three-texture-source={textureSource ? '1' : undefined}
      className="absolute inset-0"
      style={sceneContentStyle}
    >
      {sceneBody}
    </div>
  ) : (
    sceneBody
  )
  if (
    !cameraDepthOfField?.enabled ||
    cameraDepthOfField.blurPx <= 0.05
  ) {
    return scene
  }

  const radius = Math.max(1, cameraDepthOfField.focusRadius)
  const feather = Math.max(24, cameraDepthOfField.featherPx * 1.4)
  const blur = Number(cameraDepthOfField.blurPx.toFixed(2))

  return (
    <SnapshotCompositor
      width={canvasWidth}
      height={canvasHeight}
      focus={{
        enabled: true,
        focusX: cameraDepthOfField.focusX,
        focusY: cameraDepthOfField.focusY,
        radius,
        feather,
        blurPx: blur,
        iso: cameraDepthOfField.iso,
      }}
    >
      {scene}
    </SnapshotCompositor>
  )
}

function CameraFocusMaskOverlay({
  cameraDepthOfField,
  canvasWidth,
  canvasHeight,
  zoom,
  sceneCorner,
  onPointerMove,
  onPointerUp,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
}: {
  cameraDepthOfField: CameraDepthOfField
  canvasWidth: number
  canvasHeight: number
  zoom: number
  sceneCorner: number
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
  onHandlePointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void
  onHandlePointerMove: (e: React.PointerEvent<HTMLElement>) => void
  onHandlePointerUp: (e: React.PointerEvent<HTMLElement>) => void
}) {
  const safeZoom = Math.max(zoom, 0.001)
  const radius = Math.max(1, cameraDepthOfField.focusRadius)
  const falloff = Math.max(1, cameraDepthOfField.focusFalloff)
  const outerRadius = radius + falloff
  const x = cameraDepthOfField.focusX
  const y = cameraDepthOfField.focusY
  const stroke = 1.5 / safeZoom
  const handleSize = 18 / safeZoom
  return (
    <div
      data-export-hide="1"
      className="pointer-events-none absolute overflow-hidden"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        left: -canvasWidth / 2,
        top: -canvasHeight / 2,
        width: canvasWidth,
        height: canvasHeight,
        borderRadius: Math.max(0, sceneCorner),
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          left: x - outerRadius,
          top: y - outerRadius,
          width: outerRadius * 2,
          height: outerRadius * 2,
          border: `${stroke}px dashed color-mix(in oklab, var(--color-accent) 34%, transparent)`,
          background:
            'radial-gradient(circle, transparent 0, transparent 58%, color-mix(in oklab, var(--color-accent) 5%, transparent) 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          left: x - radius,
          top: y - radius,
          width: radius * 2,
          height: radius * 2,
          border: `${stroke}px solid color-mix(in oklab, var(--color-accent) 62%, white 12%)`,
          boxShadow: `0 0 0 ${4 / safeZoom}px color-mix(in oklab, var(--color-accent) 12%, transparent)`,
        }}
      />
      <button
        type="button"
        aria-label="Move camera focus"
        title="Move camera focus"
        className="pointer-events-auto absolute cursor-grab rounded-full border-0 bg-accent p-0 shadow-lg active:cursor-grabbing"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        style={{
          left: x,
          top: y,
          width: handleSize,
          height: handleSize,
          transform: 'translate(-50%, -50%)',
          boxShadow: `0 0 0 ${3 / safeZoom}px color-mix(in oklab, var(--color-accent) 20%, transparent), 0 ${8 / safeZoom}px ${18 / safeZoom}px color-mix(in oklab, var(--color-accent) 20%, transparent)`,
        }}
      />
    </div>
  )
}

function DomFocusPlaneOverlay({
  camera,
  cameraAnim,
  cameraDepthOfField,
  canvasWidth,
  canvasHeight,
}: {
  camera: CameraNode
  cameraAnim: AnimatedValue | undefined
  cameraDepthOfField?: CameraDepthOfField | null
  canvasWidth: number
  canvasHeight: number
}) {
  const focusX =
    cameraDepthOfField?.focusWorldX ??
    cameraAnim?.focusWorldX ??
    cameraAnim?.focusX ??
    camera.focusWorldX ??
    camera.focusX ??
    canvasWidth / 2
  const focusY =
    cameraDepthOfField?.focusWorldY ??
    cameraAnim?.focusWorldY ??
    cameraAnim?.focusY ??
    camera.focusWorldY ??
    camera.focusY ??
    canvasHeight / 2
  const focusZ =
    cameraDepthOfField?.focusWorldZ ??
    cameraAnim?.focusWorldZ ??
    cameraAnim?.focusDistance ??
    camera.focusWorldZ ??
    camera.focusDistance ??
    0
  const label =
    Math.abs(focusZ) >= 100
      ? `${Number((focusZ / 100).toFixed(2))} m`
      : `${Number(focusZ.toFixed(1))} px`
  return (
    <div
      aria-hidden
      data-export-hide="1"
      className="pointer-events-none absolute inset-0"
      style={{
        transform: `translateZ(${focusZ}px)`,
        transformStyle: 'preserve-3d',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          border: '1px solid color-mix(in oklab, var(--color-accent) 46%, transparent)',
          backgroundImage:
            'linear-gradient(to right, color-mix(in oklab, var(--color-accent) 14%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--color-accent) 14%, transparent) 1px, transparent 1px)',
          backgroundSize: '96px 96px',
          boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--color-accent) 18%, transparent)',
        }}
      />
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{
          left: focusX,
          top: focusY,
          width: 18,
          height: 18,
          border: '2px solid var(--color-accent)',
          borderRadius: 999,
          boxShadow: '0 0 0 5px color-mix(in oklab, var(--color-accent) 16%, transparent)',
          background: 'color-mix(in oklab, var(--color-accent) 12%, transparent)',
        }}
      />
      <div
        className="absolute rounded border border-border-strong bg-panel/95 px-2 py-1 font-mono text-[10px] text-text-muted shadow-sm"
        style={{
          left: Math.min(canvasWidth - 120, Math.max(8, focusX + 14)),
          top: Math.min(canvasHeight - 28, Math.max(8, focusY + 14)),
        }}
      >
        Focus {label}
      </div>
    </div>
  )
}

/**
 * Render a single scene node as a positioned div.
 *
 * Pre-Pixi placeholder: solid fills only, no strokes, no effects,
 * no text glyphs. Enough to visually verify that Yoga is placing
 * things where we expect. Text nodes show their string content in
 * the app's monospace so the debug view remains legible.
 *
 * Two distinct kinds of position are composed here:
 *   - `rect.x / rect.y / rect.width / rect.height`  — from the Yoga
 *     solve, i.e. where auto-layout puts the node relative to the
 *     canvas origin. These map to `left / top / width / height`.
 *   - `node.transform.{x,y,rotation,scaleX,scaleY}` — the animatable
 *     post-layout offset. Lives on the CSS `transform` property so
 *     it never feeds back into the layout pass.
 *
 * Animated values from the engine are composited on top of the
 * static transform — ultra-cheap here because it's a plain numeric
 * add before the CSS transform string is assembled.
 *
 * Frame nodes with `clipsContent: true` get `overflow:hidden` so
 * children that exceed their bounds are clipped rather than bleeding
 * onto other frames. Matches Figma / Jitter.
 */
function NodeView({
  node,
  rect,
  anim,
  inherit,
  isRoot,
  isSelected,
  ancestorClip,
  maskedBy,
  onClick,
  onContextMenu,
}: {
  node: SceneNode
  rect: Rect
  anim: AnimatedValue | undefined
  inherit: InheritedAnim
  isRoot: boolean
  isSelected: boolean
  /**
   * World-space shape that this node should be clipped to, derived from
   * the closest clipping ancestor. Undefined when there is no clipping
   * ancestor (i.e. the node sits directly under root). The renderer
   * wraps the node in an overflow-hidden rounded box because the flat-DOM
   * structure means the parent frame's `overflow:hidden` can't reach
   * the child to clip it.
   */
  ancestorClip?: ClipHit
  /**
   * Mask shape info — present when the previous sibling has
   * `isMask: true`. The renderer applies a CSS clip-path on this
   * node so its painted pixels are limited to the mask shape's
   * silhouette. See the maskInfo memo in SceneLayer for build details.
   */
  maskedBy?: { rect: Rect; kind: NodeKind; corner: number }
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
}) {
  if (node.kind === 'audio') return null

  // Node background — serialize whatever Fill shape the model holds
  // (solid / linear / radial) into a CSS background value. Solid fills
  // return a bare color, gradients return a `linear-gradient(...)` or
  // `radial-gradient(...)` string, null returns undefined so the
  // parent's or canvas's default paint shows through.
  //
  // Text is a special case: its fill is painted through the glyphs via
  // background-clip: text on the inner <span>. Letting the wrapper
  // box also paint the fill would show a solid block of paint behind
  // the transparent text, losing the gradient-on-glyphs effect. So we
  // suppress the wrapper background for text nodes.
  // If the anim engine is tweening a fill color, it hands us a solid
  // OKLCH string via `anim.fill`. That override replaces the static
  // fill entirely (even when the static fill is a gradient) — a solid
  // tween between two gradients isn't meaningful, so the engine only
  // emits `anim.fill` when both endpoints were solid. We synthesise a
  // one-stop solid Fill so the rest of the paint pipeline stays uniform.
  const effectiveFill =
    anim?.fill !== undefined
      ? ({ kind: 'solid', color: anim.fill } as const)
      : node.appearance.fill
  // Keep the renderer on background-* longhands only. React warns when
  // a node switches between `background` shorthand and `backgroundImage`
  // across rerenders, and image fills naturally need longhands for size
  // and repeat anyway.
  const backgroundStyle =
    node.kind === 'text' ? {} : fillBackgroundStyle(effectiveFill)

  // Hover state for the placeholder outline below. Kept local so a
  // cursor hover doesn't fan out through the whole component tree.
  const [hovered, setHovered] = useState(false)

  // Frames without any paint would otherwise be invisible on the canvas,
  // but the user specifically didn't want the dashed hint to linger
  // when they're not interacting with it — "if I didn't tell it to
  // show, don't show". So we paint the silhouette only while the user
  // is either hovering or has the frame selected. Root is handled by
  // the canvas box itself so we skip it.
  //
  // Exception: when a frame has an active animation (any track is
  // emitting non-identity values), we force the silhouette on so the
  // user can actually SEE the frame fading, sliding, or scaling. Without
  // this, a fade-in on an empty frame looks like the preset did nothing
  // — the frame's div animates correctly but has no paint to show it.
  // Children still fade via inherited anim, but the frame itself needs
  // a visible handle too.
  const isEmptyFrame =
    !isRoot &&
    node.kind === 'frame' &&
    node.appearance.fill === null &&
    node.appearance.stroke === null
  // The dashed outline now appears ONLY on hover or selection, not
  // continuously while a frame has animation tracks. Earlier the
  // animated case forced it on so users could "see" a fade-in on an
  // otherwise invisible frame, but in real scenes that meant every
  // frame with any track painted a dashed border permanently — visual
  // noise that even bled into video exports. If you want a
  // permanent silhouette around a frame, set a faint stroke or fill
  // on it; the editor outline is just an interaction affordance.
  const needsDashedOutline =
    isEmptyFrame && (hovered || isSelected || !!node.workspaceOnly)

  // Root is the artboard — no transform, no rotation, no scale. Even
  // if stale state has a non-identity transform on it, we paint it
  // flat. `normalizeRoot` will clean up the underlying data on next
  // load; this is the in-render safety net so the Scene never tilts.
  //
  // For non-root nodes we compose three sources under REPLACE semantics:
  //   - node.transform.*  : the node's own static transform
  //   - anim.*            : absolute value at the current playhead when
  //                          a track exists — otherwise undefined
  //   - inherit.*         : the compounded contribution of every ancestor
  //                          (see composeInheritedAnim). Additive/
  //                          multiplicative against the OWN effective
  //                          value, since ancestors apply on top.
  //
  // "Effective own value" picks animated when present, static otherwise.
  // Inherited offsets still compose additively/multiplicatively because
  // they represent the accumulated contribution from ancestors, not a
  // replacement.
  const ownX = anim?.x ?? node.transform.x
  const ownY = anim?.y ?? node.transform.y
  const ownRot = anim?.rotation ?? node.transform.rotation
  const ownSX = anim?.scaleX ?? node.transform.scaleX
  const ownSY = anim?.scaleY ?? node.transform.scaleY
  const ownOp = anim?.opacity ?? node.appearance.opacity
  const tx = isRoot ? 0 : ownX + inherit.x
  const ty = isRoot ? 0 : ownY + inherit.y
  const tz = isRoot ? 0 : (anim?.z ?? node.transform.z) + inherit.z
  const rotation = isRoot ? 0 : ownRot + inherit.rotation
  const rotationX = isRoot ? 0 : (anim?.rotationX ?? node.transform.rotationX) + inherit.rotationX
  const rotationY = isRoot ? 0 : (anim?.rotationY ?? node.transform.rotationY) + inherit.rotationY
  const sx = isRoot ? 1 : ownSX * inherit.scaleX
  const sy = isRoot ? 1 : ownSY * inherit.scaleY
  const opacity = ownOp * inherit.opacity
  // cornerRadius from the engine REPLACES the static value when a track
  // is active; static is the fallback for the no-track case. See the
  // `AnimatedValue.cornerRadius` docstring for why this differs from
  // the additive/multiplicative composition used for transform/opacity.
  const cornerRadius = anim?.cornerRadius ?? node.appearance.cornerRadius
  // Per-corner override. When `appearance.cornerRadii` is set, write the
  // four-value CSS shorthand `tl tr br bl`. We deliberately ignore the
  // animated uniform `cornerRadius` here — once a designer promotes to
  // per-corner, the uniform track stops applying. This trade-off keeps
  // the data model honest: there is one source of truth at any time.
  const cornerRadii = node.appearance.cornerRadii
  // Ellipses are always circles/ellipses by definition — the
  // cornerRadius property on ellipse nodes doesn't mean anything. Paint
  // the wrapper with `border-radius: 9999px` so a drawn ellipse looks
  // like an ellipse even when the stored cornerRadius is 0. The stroke
  // overlay still gets the numeric `cornerRadius` and does its own
  // ellipse-aware path (inset ellipse painted via an SVG ellipse).
  const wrapperBorderRadius: number | string =
    node.kind === 'ellipse'
      ? '9999px'
      : cornerRadiusCss(cornerRadius, cornerRadii)
  // For SVG-based stroke overlays (dashed/dotted/inside-aligned/gradient
  // strokes) we can only express ONE rx today — fall back to the max of
  // the four corners when in per-corner mode. Solid solid-color strokes
  // are painted via CSS `box-shadow` strokeShadow and inherit the
  // wrapper's border-radius perfectly, so they work correctly already.
  const strokeOverlayCorner = maxCornerRadius(cornerRadius, cornerRadii)

  // Empty frames (fill=null, stroke=null) have no paint of their own —
  // applying the animated opacity to the wrapper would also fade out
  // the dashed placeholder we paint via `outline`, so the user can't
  // SEE the animation running on the frame. Skip opacity on the wrapper
  // for empty frames; the value still reaches children through
  // `composeInheritedAnim`, which is where the opacity matters anyway
  // (the frame itself is an invisible container). Non-empty frames and
  // every other node kind keep the wrapper opacity so their fill / text
  // / image content fades normally.
  // Mask shapes paint at reduced opacity so the user can still see and
  // edit them on the canvas — Figma hides them entirely once the
  // selection moves elsewhere, but for our DOM renderer that's
  // confusing because the mask shape still has fields in the
  // Inspector. 0.35 keeps it visible without competing with the
  // masked content.
  const baseWrapperOpacity = isEmptyFrame ? 1 : opacity
  const wrapperOpacity = node.isMask ? baseWrapperOpacity * 0.35 : baseWrapperOpacity

  // Mask clip-path. When this node is masked by a sibling, derive a
  // CSS clip-path string from the mask shape's local rect (relative
  // to this node's own box) and apply it to the styled inner box.
  //
  // Kind-specific shapes:
  //   - 'ellipse' → CSS ellipse(rx ry at cx cy), giving a true round
  //     mask matching the mask shape's bounding box.
  //   - 'rect' / 'frame' / everything else → inset(t r b l) optionally
  //     with `round Npx` when the masker carries a corner radius. This
  //     covers rounded-rectangle reveals.
  //
  // Coordinates are in the masked node's local box space (top-left of
  // the box is 0,0). World-coord clipping needs a wrapper layer; see
  // the maskInfo comment in SceneLayer for why MVP punts on that.
  let maskClipPath: string | undefined
  if (maskedBy) {
    const localX = maskedBy.rect.x - rect.x
    const localY = maskedBy.rect.y - rect.y
    const w = maskedBy.rect.width
    const h = maskedBy.rect.height
    if (maskedBy.kind === 'ellipse') {
      const rx = w / 2
      const ry = h / 2
      const cx = localX + rx
      const cy = localY + ry
      maskClipPath = `ellipse(${rx}px ${ry}px at ${cx}px ${cy}px)`
    } else {
      // inset insets are: top / right / bottom / left
      const t = localY
      const l = localX
      const r = rect.width - (localX + w)
      const b = rect.height - (localY + h)
      maskClipPath =
        maskedBy.corner > 0
          ? `inset(${t}px ${r}px ${b}px ${l}px round ${maskedBy.corner}px)`
          : `inset(${t}px ${r}px ${b}px ${l}px)`
    }
  }

  const parts: string[] = []
  const transformSpace = node.transform.space ?? 'local'
  if (tx !== 0 || ty !== 0) parts.push(`translate(${tx}px, ${ty}px)`)
  if (transformSpace === 'world' && tz !== 0) parts.push(`translateZ(${tz}px)`)
  if (rotationX !== 0) parts.push(`rotateX(${rotationX}deg)`)
  if (rotationY !== 0) parts.push(`rotateY(${rotationY}deg)`)
  if (rotation !== 0) parts.push(`rotate(${rotation}deg)`)
  if (transformSpace === 'local' && tz !== 0) parts.push(`translateZ(${tz}px)`)
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`)
  const transform = parts.length > 0 ? parts.join(' ') : undefined
  const anchorX = isRoot ? 0.5 : anim?.anchorX ?? node.transform.anchorX ?? 0.5
  const anchorY = isRoot ? 0.5 : anim?.anchorY ?? node.transform.anchorY ?? 0.5
  const anchorZ = isRoot ? 0 : anim?.anchorZ ?? node.transform.anchorZ ?? 0
  const transformOrigin = `${Number((anchorX * 100).toFixed(3))}% ${Number((anchorY * 100).toFixed(3))}% ${Number(anchorZ.toFixed(3))}px`
  const hasProjected3D =
    Math.abs(rotationX) > 0.001 ||
    Math.abs(rotationY) > 0.001 ||
    Math.abs(rotation) > 0.001 ||
    Math.abs(tz) > 0.001

  const clips = node.kind === 'frame' && node.clipsContent

  // Strokes split into two rendering paths:
  //
  //   solid  → boxShadow, because it cooperates with borderRadius and
  //            doesn't force us to reserve layout space the way CSS
  //            `border` would.
  //   dashed → an SVG overlay painted on top of the node box. boxShadow
  //   dotted → can't express dash patterns, so solid-only stays on it.
  //
  // Alignment mirrors Figma in both paths:
  //   inside  — outer edge of the stroke sits at the node boundary
  //   outside — inner edge of the stroke sits at the node boundary
  //   center  — the stroke straddles the boundary 50/50
  //
  // Re-rendered on every value change; no perf concern at current
  // scales. The SVG overlay is pointer-events:none so it doesn't eat
  // clicks meant for the node itself.
  const { stroke } = node.appearance
  const strokeStyle = stroke?.style ?? 'solid'
  // Box-shadow is the fast path for solid-color strokes. A gradient
  // stroke forces the SVG overlay path because box-shadow only accepts
  // a flat color. Same reason dashed/dotted go to SVG — we push the
  // harder case to SVG and keep the common case cheap.
  const strokeHasGradient = !!stroke?.fill && stroke.fill.kind !== 'solid'
  const strokeFlatColor = stroke?.fill?.kind === 'solid'
    ? stroke.fill.color
    : stroke?.color
  // Per-side widths take a different render path: CSS borders, one
  // per side. box-shadow can only express uniform strokes, so any
  // node imported with "1px bottom border only" (tabs, list rows,
  // dividers) needs the per-side path. We force inside-alignment for
  // per-side strokes — Figma allows center/outside but the layout
  // implications of mixed-width outside borders are too messy to
  // implement reliably for an MVP.
  const hasPerSideStroke =
    !!stroke && !!stroke.widths && strokeStyle === 'solid' && !strokeHasGradient
  const strokeBorderCss = hasPerSideStroke
    ? {
        borderTopWidth: stroke!.widths!.top,
        borderRightWidth: stroke!.widths!.right,
        borderBottomWidth: stroke!.widths!.bottom,
        borderLeftWidth: stroke!.widths!.left,
        borderStyle: 'solid' as const,
        borderColor: strokeFlatColor,
        // box-sizing keeps the outer dimensions stable so Yoga's solved
        // rect remains the authoritative size — borders eat into the
        // content box rather than expanding the wrapper.
        boxSizing: 'border-box' as const,
      }
    : undefined
  const strokeShadow =
    stroke &&
    stroke.width > 0 &&
    strokeStyle === 'solid' &&
    !strokeHasGradient &&
    !hasPerSideStroke &&
    !clips
      ? stroke.align === 'inside'
        ? `inset 0 0 0 ${stroke.width}px ${strokeFlatColor}`
        : stroke.align === 'outside'
          ? `0 0 0 ${stroke.width}px ${strokeFlatColor}`
          : `inset 0 0 0 ${stroke.width / 2}px ${strokeFlatColor}, 0 0 0 ${stroke.width / 2}px ${strokeFlatColor}`
      : undefined

  // Effect stack — Figma-style. Drop and inner shadows compose into
  // CSS box-shadow alongside any stroke shadow; layer blurs compose
  // into the same CSS filter pipeline as DOF blur. Effects are
  // applied in array order (later entries paint visually on top, so
  // they appear last in the comma-separated box-shadow list — CSS
  // paints box-shadow tail-to-head).
  //
  // `visible: false` rows are skipped so disabled effects don't
  // contribute to the rendered string but still survive in the data.
  const effects = node.appearance.effects ?? []
  const effectShadowParts: string[] = []
  const effectFilterParts: string[] = []
  for (const fx of effects) {
    if (fx.visible === false) continue
    if (fx.kind === 'shadow') {
      const spread = fx.spread ?? 0
      effectShadowParts.push(
        `${fx.offsetX}px ${fx.offsetY}px ${fx.blur}px ${spread}px ${fx.color}`,
      )
    } else if (fx.kind === 'inner-shadow') {
      const spread = fx.spread ?? 0
      effectShadowParts.push(
        `inset ${fx.offsetX}px ${fx.offsetY}px ${fx.blur}px ${spread}px ${fx.color}`,
      )
    } else if (fx.kind === 'blur') {
      effectFilterParts.push(`blur(${fx.amount}px)`)
    }
  }
  const effectShadowCss = effectShadowParts.join(', ')
  const effectFilterCss = effectFilterParts.join(' ')

  // Compose the final box-shadow string. Stroke shadow first so a
  // drop shadow paints OUTSIDE the stroke, matching Figma's stack
  // order (effects are above stroke in their effects panel).
  const composedBoxShadow = [strokeShadow, effectShadowCss]
    .filter(Boolean)
    .join(', ')
  const shouldRenderStrokeOverlay =
    !!stroke &&
    stroke.width > 0 &&
    !hasPerSideStroke &&
    !clips &&
    (strokeStyle !== 'solid' || strokeHasGradient)

  // Drag-to-move, activated on pointerdown. Only inner (non-root) nodes
  // get drag behavior — the root is the scene frame, which is positioned
  // by the canvas box itself.
  const drag = useDragToMove(node.id, isRoot)

  // Ancestor clip — when this node sits under a clipping frame, we
  // render an OUTER clip wrapper around the node's normal styled box.
  // The outer is positioned at the world-space clip rect with
  // `overflow: hidden`, has no transform of its own, and crops both
  // paint and pointer events. The inner box keeps the node's transform
  // / animation / styling and is positioned RELATIVE to the outer.
  //
  // Why two wrappers instead of `clip-path` on the styled box:
  // CSS applies `clip-path` BEFORE `transform`, so a clip mask in
  // element-local box coords rides along with any animation
  // transform — defeating the whole point of "child clipped by
  // parent" once the child starts moving. The outer-wrapper approach
  // keeps the clip in world space regardless of inner animation.
  //
  // When there's no clipping ancestor, render the styled box directly
  // (no wrapper) so unrelated nodes pay no DOM cost.
  const effectiveAncestorClip = ancestorClip
  const clipWrapperStyle =
    effectiveAncestorClip && !isRoot
      ? ({
          position: 'absolute' as const,
          left: effectiveAncestorClip.rect.x,
          top: effectiveAncestorClip.rect.y,
          width: effectiveAncestorClip.rect.width,
          height: effectiveAncestorClip.rect.height,
          overflow: 'hidden' as const,
          borderRadius: cornerRadiusCss(
            effectiveAncestorClip.cornerRadius,
            effectiveAncestorClip.cornerRadii,
          ),
          // Clip wrapper itself shouldn't intercept clicks — it's an
          // invisible mask. Inner re-enables pointer events so clicks
          // land on the actual node.
          pointerEvents: 'none' as const,
          // CRITICAL: propagate the camera's 3D context through the
          // wrapper. The camera-transform wrapper uses
          // `transformStyle: preserve-3d` so descendants' rotateX /
          // rotateY foreshorten under the camera's tilt. Without
          // explicitly preserving 3D here, this wrapper inherits the
          // CSS default (`flat`), which collapses 3D children into
          // 2D — meaning toggling Clip on a frame caused its
          // descendants to suddenly stop honoring camera rotation
          // and snap back to a flat-projection position. Looked like
          // an overflow bug ("clip is cutting things off") but was
          // really a 3D-inheritance bug.
          transformStyle: 'preserve-3d' as const,
        })
      : null

  // Inner box position. When wrapped, left/top become relative to the
  // clip wrapper's local coords; when not wrapped, they're world coords.
  const innerLeft = clipWrapperStyle ? rect.x - effectiveAncestorClip!.rect.x : rect.x
  const innerTop = clipWrapperStyle ? rect.y - effectiveAncestorClip!.rect.y : rect.y

  const innerBox = (
    <div
      data-node-id={node.id}
      data-node-kind={node.kind}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={(e) => {
        if (node.kind === 'component' || node.kind === 'instance') {
          e.stopPropagation()
          useUI
            .getState()
            .setComponentEditId(node.kind === 'instance' ? node.componentId : node.id)
          useUI
            .getState()
            .setSelection([node.kind === 'instance' ? node.componentId : node.id])
          return
        }
        // Double-click on a text node enters inline edit mode —
        // matches Figma. Pointer-down already started a drag, but
        // contentEditable's focus will take over the keystroke
        // stream; the drag effectively no-ops because the pointer
        // is up by the time onDoubleClick fires.
        if (node.kind === 'text') {
          e.stopPropagation()
          useUI.getState().setEditingTextId(node.id)
        }
      }}
      onPointerDown={drag.onPointerDown}
      // Hover gating for the empty-frame dashed placeholder. Cheap
      // enough to wire on every node; only the empty-frame path
      // actually reads `hovered`.
      onPointerEnter={isEmptyFrame ? () => setHovered(true) : undefined}
      onPointerLeave={isEmptyFrame ? () => setHovered(false) : undefined}
      style={{
        position: 'absolute',
        left: innerLeft,
        top: innerTop,
        width: rect.width,
        height: rect.height,
        ...backgroundStyle,
        opacity: wrapperOpacity,
        borderRadius: wrapperBorderRadius,
        boxShadow: composedBoxShadow || undefined,
        ...(strokeBorderCss ?? {}),
        transform,
        transformOrigin,
        transformStyle: 'preserve-3d',
        // Frames act as design-tool compositing groups. Without isolation,
        // a child using mix-blend-mode can blend against unrelated canvas
        // content instead of the frame's own fill/backdrop, which makes
        // imported Figma blend modes look broken.
        isolation: node.kind === 'frame' ? 'isolate' : undefined,
        mixBlendMode:
          node.appearance.blendMode && node.appearance.blendMode !== 'normal'
            ? node.appearance.blendMode
            : undefined,
        filter: effectFilterCss || undefined,
        overflow: clips ? 'hidden' : undefined,
        cursor: isRoot ? 'default' : 'move',
        // Mask shapes get an accent dashed outline regardless of
        // selection so users can spot which sibling is acting as the
        // mask without having to click around. Empty frames keep
        // their existing hover/selection-gated outline.
        outline: node.isMask
          ? '1px dashed var(--color-accent)'
          : needsDashedOutline
            ? '1px dashed var(--color-border-strong)'
            : undefined,
        outlineOffset: node.isMask || needsDashedOutline ? '-1px' : undefined,
        // Apply the sibling-mask clip-path. See maskedBy / maskInfo
        // for derivation. No-op when this node isn't being masked.
        clipPath: maskClipPath,
        // Re-enable pointer events: the clip wrapper above sets
        // pointer-events:none, so we have to reinstate them here for
        // clicks / drags to reach the node.
        pointerEvents: clipWrapperStyle ? 'auto' : undefined,
      }}
    >
      {node.kind === 'image' && node.src ? (
        <img
          src={node.src}
          alt=""
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            // object-fit maps our semantic fit values 1:1 — same names,
            // same meaning. 'none' preserves natural size (overflows the
            // box); the wrapping div's `overflow: hidden` (for frames
            // that set clipsContent) keeps that contained. For image
            // leaves we don't clip by default, which mirrors how Figma
            // handles overflow when you shrink an image below its
            // natural size with fit=none.
            objectFit: node.fit,
            // Inherit the rounded corners from the node box — without
            // this, the image's square edges poke through the parent's
            // corner radius at large radii.
            borderRadius: 'inherit',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {node.kind === 'video' ? (
        <MediaVideo node={node} />
      ) : null}
      {node.kind === 'text' ? (
        <TextGlyphs
          node={node}
          effectiveFill={effectiveFill}
          anim={anim}
        />
      ) : null}
      {shouldRenderStrokeOverlay ? (
        <StrokeOverlay
          stroke={stroke}
          width={rect.width}
          height={rect.height}
          cornerRadius={strokeOverlayCorner}
        />
      ) : null}
      {/* Layout guides — Figma-style stacked overlays. Only frames
          carry guides; visible flag toggled per-entry in the
          inspector. Painted last so they sit ABOVE content but
          stay below the selection chrome (which the SelectionOverlay
          renders outside the node entirely). Defensive `?? []` in
          case a stale doc shape reaches us — never crash on the
          new field. */}
      {node.kind === 'frame' && (node.layoutGuides ?? []).length > 0 && (
        <LayoutGuidesOverlay
          guides={node.layoutGuides ?? []}
          width={rect.width}
          height={rect.height}
        />
      )}
    </div>
  )

  if (clipWrapperStyle) {
    return <div style={clipWrapperStyle}>{innerBox}</div>
  }
  return innerBox
}

/**
 * Paints the stack of layout guides on top of a frame. Each guide
 * renders independently — they don't combine, just stack in array
 * order. Pointer-events:none across the whole layer so guides never
 * eat clicks meant for the frame or its children.
 */
function LayoutGuidesOverlay({
  guides,
  width,
  height,
}: {
  guides: import('@/scene').LayoutGuide[]
  width: number
  height: number
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      // Layout guides are editor aids, not output content. Hide them
      // from the captured stream during tab-capture export — without
      // this, your column / row / grid guides paint into the recorded
      // WebM right alongside the layout they're supposed to be helping
      // you align.
      data-export-hide="1"
    >
      {guides.map((g, i) => {
        if (!g.visible) return null
        if (g.kind === 'grid') {
          // CSS-gradient pixel grid: two repeating linear-gradients,
          // one for verticals and one for horizontals. Cheap and
          // crisp at any zoom.
          const lineColor = withOpacity(g.color, g.opacity)
          return (
            <div
              key={i}
              className="absolute inset-0"
              style={{
                backgroundImage: `linear-gradient(to right, ${lineColor} 1px, transparent 1px), linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`,
                backgroundSize: `${g.size}px ${g.size}px`,
              }}
            />
          )
        }
        if (g.kind === 'columns') {
          const fill = withOpacity(g.color, g.opacity)
          const bands = computeBands(
            g.type,
            g.count,
            width,
            g.width,
            g.margin,
            g.gutter,
          )
          return (
            <div key={i} className="absolute inset-0">
              {bands.map((b, j) => (
                <div
                  key={j}
                  className="absolute top-0 bottom-0"
                  style={{ left: b.offset, width: b.size, background: fill }}
                />
              ))}
            </div>
          )
        }
        // rows
        const fill = withOpacity(g.color, g.opacity)
        const bands = computeBands(
          g.type,
          g.count,
          height,
          g.height,
          g.margin,
          g.gutter,
        )
        return (
          <div key={i} className="absolute inset-0">
            {bands.map((b, j) => (
              <div
                key={j}
                className="absolute left-0 right-0"
                style={{ top: b.offset, height: b.size, background: fill }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Compute the per-band offset+size for a columns/rows guide, given
 * the parent dimension along the band axis. Three band-layout types:
 *   - 'stretch' — bands fill (axisLen − 2*margin − (count-1)*gutter)
 *   - 'fixed'   — packed from the start with the given band size
 *   - 'center'  — total block (count*size + (count-1)*gutter)
 *                 centered within axisLen
 */
function computeBands(
  type: 'stretch' | 'fixed' | 'center',
  count: number,
  axisLen: number,
  bandSize: number,
  margin: number,
  gutter: number,
): Array<{ offset: number; size: number }> {
  if (count <= 0) return []
  if (type === 'stretch') {
    const inner = Math.max(0, axisLen - 2 * margin - (count - 1) * gutter)
    const size = inner / count
    const out: Array<{ offset: number; size: number }> = []
    for (let i = 0; i < count; i++) {
      out.push({ offset: margin + i * (size + gutter), size })
    }
    return out
  }
  if (type === 'fixed') {
    const out: Array<{ offset: number; size: number }> = []
    for (let i = 0; i < count; i++) {
      out.push({ offset: margin + i * (bandSize + gutter), size: bandSize })
    }
    return out
  }
  // center
  const total = count * bandSize + (count - 1) * gutter
  const start = (axisLen - total) / 2
  const out: Array<{ offset: number; size: number }> = []
  for (let i = 0; i < count; i++) {
    out.push({ offset: start + i * (bandSize + gutter), size: bandSize })
  }
  return out
}

/**
 * Mix a base color with a 0..1 opacity. Implemented as a CSS
 * color-mix with `transparent` since we can't easily decompose
 * arbitrary CSS color strings. Browsers without color-mix support
 * (very old) get the base color at full opacity — acceptable
 * fallback.
 */
function withOpacity(color: string, opacity: number): string {
  const pct = Math.round(clamp01Local(opacity) * 100)
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

function clamp01Local(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Video leaf. Renders an `<video>` element whose playback is slaved to
 * the scene playhead.
 *
 *   - When the UI is NOT playing, we seek the element's currentTime so
 *     scrubbing the timeline scrubs the frame.
 *   - When playback starts, we call `play()` and stop spamming
 *     currentTime each frame — native video playback is smoother when
 *     we let the element run. We only resync if drift exceeds 200ms
 *     (e.g. the user scrubbed while paused and then hit play).
 *   - When the playhead is outside `[startTime, startTime + clipLen]`,
 *     the element holds its first or last frame and pauses, so the
 *     video isn't silently looping in the background.
 */
/**
 * Inline text renderer + editor.
 *
 * Reads `editingTextId` from the UI store. When this node is the one
 * being edited, renders a contentEditable div in place of the static
 * span — same typography, same layout — so the editor feels like the
 * text just woke up. On commit (Enter without shift, or blur), writes
 * the new value through `api.setNodeProperty`. Escape discards.
 *
 * Why a separate component: keeps the NodeView body uncluttered AND
 * lets us scope the `useUI` / `useSceneAPI` subscriptions so only text
 * nodes (a tiny fraction of the tree) re-render when edit mode flips.
 */
function TextGlyphs({
  node,
  effectiveFill,
  anim,
}: {
  node: Extract<SceneNode, { kind: 'text' }>
  // Match the type computed in NodeView — either node.appearance.fill
  // (whatever Fill union the scene model uses) or the synth solid the
  // animation engine emits.
  effectiveFill: Extract<SceneNode, { kind: 'text' }>['appearance']['fill']
  anim: AnimatedValue | undefined
}) {
  const editingTextId = useUI((s) => s.editingTextId)
  const setEditingTextId = useUI((s) => s.setEditingTextId)
  const playhead = useUI((s) => s.playhead)
  const api = useSceneAPI()
  const isEditing = editingTextId === node.id
  const hasTextAnimationTracks = listTracksForNode(api, node.id).some(
    (track) =>
      track.propertyId === 'text.progress' && track.keyframes.length >= 2,
  )
  const textAnimation =
    anim?.textAnimation ??
    (hasTextAnimationTracks ? null : normalizeTextAnimation(node.textAnimation))

  // Common typography style block. Shared between read and edit modes
  // so the text doesn't shift visually when you press Enter to edit.
  const textAlign: 'left' | 'right' | 'center' =
    node.textAlign === 'start'
      ? 'left'
      : node.textAlign === 'end'
        ? 'right'
        : 'center'
  // When the node hugs width, force `whiteSpace: 'pre'` so the text
  // never wraps — the box is supposed to be exactly the text's natural
  // width, and any sub-pixel measurement drift would otherwise cause
  // the last word to fold onto a new line. For fixed/fill widths we
  // keep `pre-wrap` + `break-word` so multi-line text wraps correctly.
  const hugWidth = node.size.width === 'hug'
  const sharedStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    // Text color layering — fill via background-clip: text when a
    // gradient/solid fill is set, otherwise plain `color`.
    ...(effectiveFill
      ? {
          ...fillBackgroundStyle(effectiveFill),
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'transparent',
        }
      : { color: node.color }),
    textAlign,
    whiteSpace: hugWidth ? 'pre' : 'pre-wrap',
    wordBreak: hugWidth ? 'normal' : 'break-word',
  }

  // contentEditable focus + select-all on mount. We do this with a ref
  // callback rather than autoFocus + a select effect because React
  // doesn't have a built-in "select all text" autoFocus variant, and
  // contentEditable's `autofocus` attribute is unreliable in Electron.
  const editRef = (el: HTMLDivElement | null) => {
    if (!el || !isEditing) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }

  const commit = (raw: string) => {
    // Strip a single trailing newline that contentEditable likes to
    // leave behind when the user lands on Enter for commit.
    const next = raw.replace(/\n$/, '')
    if (next !== node.text) {
      api.setNodeProperty(node.id, 'text', next)
    }
    setEditingTextId(null)
  }

  if (isEditing) {
    return (
      <div
        ref={editRef}
        contentEditable
        suppressContentEditableWarning
        // Make the editor swallow pointer events so the parent's
        // drag handler doesn't fight the cursor.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={(e) => commit((e.currentTarget.textContent ?? '').toString())}
        onKeyDown={(e) => {
          // Enter (no shift) commits + exits. Shift+Enter inserts a
          // newline so multi-line text is editable.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            commit((e.currentTarget.textContent ?? '').toString())
            return
          }
          // Escape discards changes and exits. We rely on React not
          // re-rendering between the keydown and blur to bypass the
          // commit() in onBlur.
          if (e.key === 'Escape') {
            e.preventDefault()
            setEditingTextId(null)
            ;(e.currentTarget as HTMLDivElement).blur()
            return
          }
          // Stop the global keyboard shortcut handler from claiming
          // Backspace / Delete / Cmd+A / etc. while the editor is
          // focused — those are text-editing actions inside the field.
          e.stopPropagation()
        }}
        style={{
          ...sharedStyle,
          // Allow caret/selection rendering and prevent the OS no-
          // cursor mask the read-only span uses.
          userSelect: 'text',
          cursor: 'text',
          outline: 'none',
        }}
      >
        {node.text}
      </div>
    )
  }

  return (
    <span
      style={{
        ...sharedStyle,
        // Static text shouldn't grab cursor flicker.
        userSelect: 'none',
      }}
    >
      {textAnimation
        ? renderTextAnimationSegments(
            node.text,
            textAnimation,
            playhead,
            sharedStyle,
            anim?.textProgress,
          )
        : node.text}
    </span>
  )
}

function renderTextAnimationSegments(
  text: string,
  config: TextAnimationConfig,
  playhead: number,
  sharedStyle: CSSProperties,
  progress?: number,
) {
  const segments = splitTextAnimationSegments(text, config.applyTo)
  const orderedCount = Math.max(1, segments.filter((s) => s.animate).length)
  let animateIndex = 0
  return segments.map((segment, index) => {
    if (!segment.animate) return segment.text
    const orderIndex =
      config.order === 'backward'
        ? orderedCount - animateIndex - 1
        : animateIndex
    animateIndex++
    const style = textAnimationSegmentStyle(
      config,
      playhead,
      progress,
      orderIndex,
      orderedCount,
      sharedStyle,
      segment.kind,
      segment.isLast ?? false,
    )
    return (
      <span key={`${index}-${segment.text}`} style={style}>
        {displayTextForSegment(
          segment.text,
          config,
          playhead,
          progress,
          orderIndex,
          orderedCount,
        )}
      </span>
    )
  })
}

function splitTextAnimationSegments(
  text: string,
  applyTo: TextAnimationConfig['applyTo'],
): Array<{ text: string; animate: boolean; kind: 'inline' | 'line'; isLast?: boolean }> {
  if (applyTo === 'layer') return [{ text, animate: true, kind: 'inline' }]
  if (applyTo === 'lines') {
    const lines = text.split(/(\n)/)
    return lines.map((part, index) => ({
      text: part,
      animate: part !== '\n' && part.length > 0,
      kind: part === '\n' ? 'inline' : 'line',
      isLast: index === lines.length - 1,
    }))
  }
  if (applyTo === 'words') {
    const parts = text.split(/(\s+)/)
    return parts.map((part, index) => ({
      text: part,
      animate: !/^\s+$/.test(part) && part.length > 0,
      kind: 'inline',
      isLast: index === parts.length - 1,
    }))
  }
  const chars = Array.from(text)
  return chars.map((char, index) => ({
    text: char,
    animate: char !== '\n' && char !== ' ',
    kind: 'inline',
    isLast: index === chars.length - 1,
  }))
}

function textAnimationSegmentStyle(
  config: TextAnimationConfig,
  playhead: number,
  progress: number | undefined,
  orderIndex: number,
  count: number,
  sharedStyle: CSSProperties,
  kind: 'inline' | 'line',
  isLast: boolean,
): CSSProperties {
  const totalSpan = config.duration + Math.max(0, count - 1) * config.delay
  const timelineProgress = progress === undefined
    ? undefined
    : Math.max(0, Math.min(1, progress))
  const globalElapsed = timelineProgress === undefined
    ? playhead - config.startTime
    : timelineProgress * totalSpan
  const raw = (globalElapsed - orderIndex * config.delay) / Math.max(0.05, config.duration)
  const u = Math.max(0, Math.min(1, raw))
  const eased = progress === undefined ? easeTextAnimation(u, config.acceleration) : u
  const exit = config.mode === 'out'
  const amount = exit ? eased : 1 - eased
  const lineHeight =
    typeof sharedStyle.fontSize === 'number' && typeof sharedStyle.lineHeight === 'number'
      ? sharedStyle.fontSize * sharedStyle.lineHeight
      : 32
  const travel = Math.max(1, lineHeight * config.travelDistance)
  const [dx, dy] = directionOffset(config.direction, travel * amount)
  const transforms: string[] = []
  let opacity = 1
  let filter: string | undefined
  let clipPath: string | undefined
  let color: string | undefined
  const authoredTracking =
    typeof sharedStyle.letterSpacing === 'number' ? sharedStyle.letterSpacing : 0
  let effectiveTracking = authoredTracking

  if (
    config.id === 'fade' ||
    config.id === 'slide-up' ||
    config.id === 'slide-down' ||
    config.id === 'slide-left' ||
    config.id === 'slide-right' ||
    config.id === 'blur-slide' ||
    config.id === 'blur' ||
    config.id === 'appear' ||
    config.id === 'typewriter'
  ) {
    opacity = config.id === 'appear' || config.id === 'typewriter'
      ? amount > 0.5 ? 0 : 1
      : 1 - amount
  }
  if (config.id.startsWith('slide') || config.id === 'blur-slide') {
    transforms.push(`translate(${dx}px, ${dy}px)`)
  }
  if (config.id === 'grow') {
    transforms.push(`scale(${1 - amount * 0.35})`)
    opacity = 1 - amount
  }
  if (config.id === 'shrink') {
    transforms.push(`scale(${1 + amount * 0.35})`)
    opacity = 1 - amount
  }
  if (config.id === 'blur' || config.id === 'blur-slide') {
    filter = `blur(${config.blurRadius * amount}px)`
  }
  if (config.id === 'mask-up' || config.id === 'mask-down' || config.id === 'gradient-reveal') {
    const pct = Math.round(amount * 100)
    clipPath =
      config.direction === 'down'
        ? `inset(${pct}% 0 0 0)`
        : `inset(0 0 ${pct}% 0)`
    opacity = 1
  }
  if (config.id === 'gradient-reveal') {
    const gradient = config.mode === 'in'
      ? config.endGradient ?? config.startGradient
      : config.startGradient ?? config.endGradient
    const background = fillToCss(gradient ?? null)
    if (background) {
      return {
        display: kind === 'line' ? 'block' : 'inline-block',
        whiteSpace: kind === 'line' ? 'pre-wrap' : 'pre',
        opacity,
        filter,
        clipPath,
        background,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        color: 'transparent',
        letterSpacing: effectiveTracking,
        marginRight: kind === 'inline' && !isLast && effectiveTracking !== 0 ? effectiveTracking : undefined,
        transform: transforms.length > 0 ? transforms.join(' ') : undefined,
        transformOrigin: '50% 50%',
        willChange: 'transform, opacity, filter, clip-path, letter-spacing',
      }
    }
  }
  if (config.id === 'flip') {
    transforms.push(`rotateX(${amount * -90}deg)`)
    opacity = 1 - amount
  }
  if (config.id === 'character-wave') {
    const phase = count <= 1 ? 0 : orderIndex / (count - 1)
    transforms.push(`translateY(${Math.sin((phase + u) * Math.PI * 2) * 8 * amount}px)`)
    opacity = 1 - amount * 0.35
  }
  if (config.id === 'tracking') {
    effectiveTracking = authoredTracking + amount * 10
    opacity = 1 - amount
  }
  if (config.id === 'skew') {
    transforms.push(`translate(${dx}px, ${dy}px) skewX(${amount * -14}deg)`)
    opacity = 1 - amount
  }
  if (config.id === 'color-fade') {
    color = config.mode === 'in'
      ? `color-mix(in oklab, currentColor ${Math.round(eased * 100)}%, transparent)`
      : `color-mix(in oklab, currentColor ${Math.round((1 - eased) * 100)}%, transparent)`
  }

  return {
    display: kind === 'line' ? 'block' : 'inline-block',
    whiteSpace: kind === 'line' ? 'pre-wrap' : 'pre',
    opacity,
    filter,
    clipPath,
    color,
    letterSpacing: effectiveTracking,
    marginRight: kind === 'inline' && !isLast && effectiveTracking !== 0 ? effectiveTracking : undefined,
    transform: transforms.length > 0 ? transforms.join(' ') : undefined,
    transformOrigin: '50% 50%',
    willChange: 'transform, opacity, filter, clip-path, letter-spacing',
  }
}

function easeTextAnimation(
  u: number,
  acceleration: TextAnimationConfig['acceleration'],
): number {
  if (acceleration === 'linear') return u
  if (acceleration === 'speed-up') return u * u
  if (acceleration === 'spring') {
    return Math.min(1, 1 - Math.cos(u * Math.PI * 2.4) * Math.exp(-5 * u))
  }
  if (acceleration === 'smooth') return u * u * (3 - 2 * u)
  return 1 - Math.pow(1 - u, 3)
}

function directionOffset(
  direction: TextAnimationConfig['direction'],
  distance: number,
): [number, number] {
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

function displayTextForSegment(
  text: string,
  config: TextAnimationConfig,
  playhead: number,
  progress: number | undefined,
  orderIndex: number,
  count: number,
): string {
  if (config.id !== 'scramble') return text
  const totalSpan = config.duration + Math.max(0, count - 1) * config.delay
  const timelineProgress = progress === undefined
    ? undefined
    : Math.max(0, Math.min(1, progress))
  const globalElapsed = timelineProgress === undefined
    ? playhead - config.startTime
    : timelineProgress * totalSpan
  const u = Math.max(0, Math.min(1, (globalElapsed - orderIndex * config.delay) / Math.max(0.05, config.duration)))
  if ((config.mode === 'in' && u >= 0.85) || (config.mode === 'out' && u <= 0.15)) return text
  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&'
  return Array.from(text)
    .map((char, index) => {
      if (/\s/.test(char)) return char
      const n = Math.abs(Math.sin((orderIndex + 1) * 17.17 + index * 9.91 + playhead * 24))
      return glyphs[Math.floor(n * glyphs.length) % glyphs.length]!
    })
    .join('')
}

function MediaVideo({
  node,
}: {
  node: Extract<SceneNode, { kind: 'video' }>
}) {
  const api = useSceneAPI()
  const ref = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const repairAttemptedRef = useRef<string>('')
  const [mediaReadyTick, setMediaReadyTick] = useState(0)
  const [localPoster, setLocalPoster] = useState('')
  const [decodeError, setDecodeError] = useState('')
  const [hasCanvasFrame, setHasCanvasFrame] = useState(false)
  const playing = useUI((s) => s.playing)
  const playhead = useUI((s) => s.playhead)
  const rate = clampPlaybackRate(node.playbackRate)
  const sourceClipLen = Math.max(0, (node.trimEnd || node.duration) - node.trimStart)
  const sceneClipLen = sourceClipLen / rate
  const local = clampLocal((playhead - node.startTime) * rate + node.trimStart, node)

  useEffect(() => {
    setHasCanvasFrame(false)
    setDecodeError('')
  }, [node.src])

  useEffect(() => {
    if (!node.src.startsWith('data:video/')) return
    if (node.importWarning === VIDEO_PLAYBACK_PROXY_WARNING) return
    if (repairAttemptedRef.current === node.src) return
    repairAttemptedRef.current = node.src

    let cancelled = false
    void repairVideoNodeSource(node, api)
      .catch((err) => {
        console.warn('[media] video self-repair failed', err)
      })
      .finally(() => {
        if (!cancelled) setMediaReadyTick((tick) => tick + 1)
      })
    return () => {
      cancelled = true
    }
  }, [api, node])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reflect muted + volume every render. These are cheap.
    el.muted = node.muted
    el.volume = Math.max(0, Math.min(1, node.volume))
    el.playbackRate = rate
  }, [node.muted, node.volume, rate])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const inRange = playhead >= node.startTime && playhead < node.startTime + sceneClipLen
    if (el.readyState < HTMLMediaElement.HAVE_METADATA) {
      el.load()
      return
    }
    if (playing && inRange) {
      if (el.paused || Math.abs(el.currentTime - local) > 0.35) {
        seekMediaElement(el, local, 0.2)
      }
      if (el.paused) {
        el.play().catch(() => {
          // Autoplay policies may reject — user interaction is required.
          // We pause silently; the user can click play again after
          // interacting and the browser will admit us.
        })
      }
    } else {
      if (!el.paused) el.pause()
      // While paused / out-of-range, pin the element to the scrubbed time.
      const pausedPreviewLocal = previewLocalForPausedVideo(local, node)
      seekMediaElement(el, pausedPreviewLocal, 0.05)
    }
  }, [playing, playhead, local, sceneClipLen, node, rate, mediaReadyTick])

  useEffect(() => {
    const video = ref.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    let raf = 0
    const draw = () => {
      if (drawVideoToCanvas(video, canvas)) {
        setHasCanvasFrame(true)
      }
      if (playing && !video.paused && !video.ended) {
        raf = requestAnimationFrame(draw)
      }
    }
    draw()
    if (playing) raf = requestAnimationFrame(draw)
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [playing, mediaReadyTick, playhead, node.src])

  if (!node.src) return null
  const poster = node.poster || localPoster || undefined
  const markVideoReady = () => {
    setDecodeError('')
    setMediaReadyTick((tick) => tick + 1)
    const el = ref.current
    const canvas = canvasRef.current
    if (el && canvas && drawVideoToCanvas(el, canvas)) {
      setHasCanvasFrame(true)
    }
    if (!el || node.poster || localPoster) return
    const frame = capturePosterFromVideoElement(el)
    if (frame) setLocalPoster(frame)
  }

  return (
    <>
      {poster ? (
        <img
          src={poster}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: node.fit,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: hasCanvasFrame ? 1 : 3,
          }}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: node.fit,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />
      <video
        ref={ref}
        src={node.src}
        poster={poster}
        draggable={false}
        playsInline
        preload="auto"
        onLoadedMetadata={markVideoReady}
        onLoadedData={markVideoReady}
        onCanPlay={markVideoReady}
        onSeeked={markVideoReady}
        onTimeUpdate={markVideoReady}
        onError={() => {
          const el = ref.current
          setDecodeError(el?.error?.message || 'Video decode failed')
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: node.fit,
          opacity: 0,
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      {decodeError ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-red-500/10 px-3 text-center font-mono text-[10px] text-red-700"
          style={{ zIndex: 3, borderRadius: 'inherit', pointerEvents: 'none' }}
        >
          {decodeError}
        </div>
      ) : null}
    </>
  )
}

async function repairVideoNodeSource(
  node: Extract<SceneNode, { kind: 'video' }>,
  api: SceneAPI,
) {
  const file = await dataUrlToFile(
    node.src,
    `${node.name || 'video'}.mp4`,
  )
  const normalized = await normalizeVideoFileForBrowser(file)
  if (!normalized.normalized) return

  const dataUrl = await readMediaFileAsDataUrl(normalized.file)
  const meta = await decodeVideoMeta(dataUrl).catch(() => ({
    width: typeof node.size.width === 'number' ? node.size.width : 1,
    height: typeof node.size.height === 'number' ? node.size.height : 1,
    duration: node.duration,
  }))
  const poster = await captureVideoPoster(dataUrl, meta.duration).catch(() => '')

  api.doc.transact(() => {
    api.setNodeProperty(node.id, 'src', dataUrl)
    api.setNodeProperty(node.id, 'duration', meta.duration)
    api.setNodeProperty(node.id, 'trimEnd', Math.min(node.trimEnd || meta.duration, meta.duration))
    api.setNodeProperty(node.id, 'poster', poster)
    api.setNodeProperty(
      node.id,
      'importWarning',
      VIDEO_PLAYBACK_PROXY_WARNING,
    )
  }, 'video-self-repair')
}

async function dataUrlToFile(dataUrl: string, fallbackName: string): Promise<File> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const mime = blob.type || dataUrl.match(/^data:([^;,]+)/)?.[1] || 'video/mp4'
  const ext = mime.includes('quicktime') ? 'mov' : mime.includes('webm') ? 'webm' : 'mp4'
  const name = /\.[a-z0-9]+$/i.test(fallbackName)
    ? fallbackName
    : `${fallbackName}.${ext}`
  return new File([blob], name, { type: mime })
}

function seekMediaElement(
  el: HTMLMediaElement,
  localTime: number,
  tolerance: number,
) {
  if (!Number.isFinite(localTime)) return
  const duration = Number.isFinite(el.duration) && el.duration > 0
    ? el.duration
    : Number.POSITIVE_INFINITY
  const next = Math.max(0, Math.min(duration, localTime))
  if (Math.abs(el.currentTime - next) <= tolerance) return
  try {
    el.currentTime = next
  } catch {
    // Some codecs reject early seeks until data is decoded. The
    // loadedmetadata/loadeddata handlers above re-run the sync pass.
  }
}

function clampLocal(
  t: number,
  node: Extract<SceneNode, { kind: 'video' | 'audio' }>,
): number {
  const trimEnd = node.trimEnd || node.duration || 0
  if (t < node.trimStart) return node.trimStart
  if (t > trimEnd) return trimEnd
  return t
}

function clampPlaybackRate(rate: number | undefined): number {
  return Math.max(0.05, Math.min(16, Number.isFinite(rate) ? rate! : 1))
}

function previewLocalForPausedVideo(
  local: number,
  node: Extract<SceneNode, { kind: 'video' }>,
): number {
  const trimStart = node.trimStart ?? 0
  const trimEnd = node.trimEnd || node.duration || trimStart
  if (local > trimStart + 0.001) return local
  if (trimEnd <= trimStart + 0.12) return local
  return Math.min(trimEnd, trimStart + 0.12)
}

function capturePosterFromVideoElement(el: HTMLVideoElement): string {
  if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return ''
  const width = el.videoWidth || 0
  const height = el.videoHeight || 0
  if (width <= 0 || height <= 0) return ''
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(el, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return ''
  }
}

function drawVideoToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): boolean {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false
  const width = video.videoWidth || 0
  const height = video.videoHeight || 0
  if (width <= 0 || height <= 0) return false
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  try {
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(video, 0, 0, width, height)
    return true
  } catch {
    return false
  }
}

/**
 * Audio "chip" — a non-visual node gets a small card on the artboard
 * so the user has something to click, drag, and inspect. Playback is
 * handled once by `AudioPlaybackHost`; this component is visual only.
 */
function AudioChip({
  node,
}: {
  node: Extract<SceneNode, { kind: 'audio' }>
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        height: '100%',
        padding: '0 10px',
        borderRadius: 'inherit',
        pointerEvents: 'none',
        fontSize: 11,
        color: 'var(--color-text-muted)',
        background: 'var(--color-panel-raised)',
        overflow: 'hidden',
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>
        {node.muted ? '×' : '♪'}
      </span>
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {node.name}
      </span>
    </div>
  )
}

/**
 * SVG overlay that paints a dashed or dotted stroke around a node box.
 *
 * Rationale: `box-shadow` gives us solid strokes for free (including
 * corner-radius cooperation) but can't express dash patterns. CSS
 * `border-style: dashed` can, but at wide stroke widths Chromium and
 * Safari render CSS dashes inconsistently — different dash counts
 * around the four edges, asymmetric corners, no control over dash
 * length or gap. An SVG path is the portable answer: every engine
 * renders `stroke-dasharray` the same way, corners are clean, and we
 * get pixel-accurate control over the pattern.
 *
 * Alignment handling mirrors the solid path:
 *   - 'inside'   → inset by stroke width / 2 so the stroke sits inside
 *   - 'center'   → exactly on the node boundary
 *   - 'outside'  → outset by stroke width / 2 so the stroke hangs out
 *
 * For 'dotted', we draw a zero-length dash with round line caps — this
 * is how CSS `border-style: dotted` is traditionally implemented and
 * produces evenly spaced, round dots that track the border radius.
 */
function StrokeOverlay({
  stroke,
  width,
  height,
  cornerRadius,
}: {
  stroke: Stroke
  width: number
  height: number
  cornerRadius: number
}) {
  const w = stroke.width
  const half = w / 2
  let inset = 0
  if (stroke.align === 'inside') inset = half
  else if (stroke.align === 'outside') inset = -half
  // center leaves inset = 0

  const rectX = inset
  const rectY = inset
  const rectW = Math.max(0, width - inset * 2)
  const rectH = Math.max(0, height - inset * 2)
  // SVG rect `rx` clamps to half the shortest side automatically, but
  // we also shrink it by inset to keep the curve concentric with the
  // parent's border-radius when the stroke is inside.
  const rx = Math.max(0, cornerRadius - inset)

  const dashArray =
    stroke.style === 'dotted'
      ? // Zero-length paint + round cap produces round dots; gap is
        // double the stroke width so dots don't bleed into each other.
        `0 ${Math.max(1, w * 2)}`
      : stroke.style === 'dashed'
        ? `${Math.max(0, stroke.dashLength ?? 6)} ${Math.max(0, stroke.dashGap ?? 4)}`
        : undefined

  // Gradient path: serialize the fill into an SVG <linearGradient> or
  // <radialGradient>. Stable id per render — the fill changes trigger
  // a re-render, so a new id is fine. `objectBoundingBox` units let us
  // keep the gradient coords in 0..1 matching the Inspector's model.
  const fill = stroke.fill ?? null
  const gradientId = fill && fill.kind !== 'solid' ? `sg-${gradientCounter++}` : null
  const strokePaint = gradientId ? `url(#${gradientId})` : (fill?.kind === 'solid' ? fill.color : stroke.color)

  return (
    <svg
      aria-hidden
      style={{
        position: 'absolute',
        // When outside-aligned, the stroke extends past the node box,
        // so the SVG has to render without being clipped by its own
        // viewport. Give it room in both directions via negative inset
        // + matching extra width/height.
        left: Math.min(0, inset),
        top: Math.min(0, inset),
        width: width + Math.max(0, -inset) * 2,
        height: height + Math.max(0, -inset) * 2,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {gradientId && fill ? (
        <defs>
          {fill.kind === 'linear' ? (
            // CSS linear-gradient angle 0 points up, angle 90 points
            // right. SVG's default x1/y1 → x2/y2 with 0/0 at top-left
            // points DOWN for 0°. Convert: x2 = 0.5 + 0.5*sin(a), etc.
            // A 180° CSS angle means top→bottom, which matches SVG's
            // (0,0)→(0,1). sin/cos math below reproduces that mapping.
            (() => {
              const a = ((fill.angle - 90) * Math.PI) / 180
              const x1 = 0.5 - Math.cos(a) * 0.5
              const y1 = 0.5 - Math.sin(a) * 0.5
              const x2 = 0.5 + Math.cos(a) * 0.5
              const y2 = 0.5 + Math.sin(a) * 0.5
              return (
                <linearGradient id={gradientId} x1={x1} y1={y1} x2={x2} y2={y2}>
                  {fill.stops.map((s, i) => (
                    <stop key={i} offset={s.at} stopColor={s.color} />
                  ))}
                </linearGradient>
              )
            })()
          ) : fill.kind === 'radial' ? (
            <radialGradient
              id={gradientId}
              cx={fill.cx}
              cy={fill.cy}
              r={0.5}
              // 'circle' keeps falloff isotropic; 'ellipse' lets it
              // stretch with the box. objectBoundingBox is the default.
              gradientUnits="objectBoundingBox"
            >
              {fill.stops.map((s, i) => (
                <stop key={i} offset={s.at} stopColor={s.color} />
              ))}
            </radialGradient>
          ) : null}
        </defs>
      ) : null}
      <rect
        x={rectX - Math.min(0, inset)}
        y={rectY - Math.min(0, inset)}
        width={rectW}
        height={rectH}
        rx={rx}
        ry={rx}
        fill="none"
        stroke={strokePaint}
        strokeWidth={w}
        strokeDasharray={dashArray}
        strokeLinecap={stroke.style === 'dotted' ? 'round' : 'butt'}
      />
    </svg>
  )
}

// Monotonic counter used to mint unique SVG gradient ids. Incrementing
// on every render would waste ids, but given the (element-count ×
// render-rate) product is tiny, the simplicity wins — no cleanup, no
// collisions, and React remounts don't leak because the SVG DOM node
// is GCed with the overlay.
let gradientCounter = 0

// Re-export for tests or any out-of-module caller — the fields hook tree
// may eventually want to know "is anything selected inside the canvas".
export type { SolvedLayout }

// ---------------------------------------------------------------------------
// Camera viewfinder gizmo
// ---------------------------------------------------------------------------

/**
 * On-canvas representation of the camera. Without this the camera was
 * a "ghost" node — selectable only from the Layers panel, with no
 * visual presence on the canvas. Now we draw:
 *   - A rectangle showing the camera's visible scene area at the
 *     current pose. Default camera (centered, identity scale) overlaps
 *     the artboard exactly. As the camera pans / zooms / rotates, the
 *     rectangle shifts / shrinks / tilts so the user can see where
 *     the lens is pointed.
 *   - A center crosshair at the camera's transform.x/y so the camera
 *     pivot is grabbable.
 *
 * Drawn OUTSIDE the camera's own transform wrapper — otherwise the
 * gizmo would compose with the very view it represents and always
 * appear identical to the artboard. This sits in scene-space so when
 * the camera moves, the gizmo moves to match.
 *
 * Pointer-events go through the rectangle outline; the inside is
 * click-through so users can still grab scene content under the
 * gizmo. Clicking the rectangle border or crosshair selects the
 * camera node.
 */
function CameraGizmo({
  camera,
  cameraAnim,
  canvasWidth,
  canvasHeight,
  zoom,
  selected,
}: {
  camera: CameraNode
  cameraAnim: AnimatedValue | undefined
  canvasWidth: number
  canvasHeight: number
  zoom: number
  selected: boolean
}) {
  const setSelection = useUI((s) => s.setSelection)

  // Effective camera pose — animation overrides static if present.
  const cx = cameraAnim?.x ?? camera.transform.x
  const cy = cameraAnim?.y ?? camera.transform.y
  const r = cameraAnim?.rotation ?? camera.transform.rotation
  const sx = cameraAnim?.scaleX ?? camera.transform.scaleX
  const sy = cameraAnim?.scaleY ?? camera.transform.scaleY

  // Visible scene area: the camera's view fits canvasWidth × canvasHeight
  // of pixels into the artboard. Scaling up means the camera shows a
  // smaller scene region (zoom in); scaling down shows more (zoom out).
  const viewW = canvasWidth / Math.max(0.0001, sx)
  const viewH = canvasHeight / Math.max(0.0001, sy)
  const left = cx - viewW / 2
  const top = cy - viewH / 2

  // Stroke widths are scaled by 1/zoom so the outline reads as 1px on
  // screen at any zoom level — same pattern selection chrome uses.
  const stroke = (selected ? 1.5 : 1) / Math.max(zoom, 0.001)
  const dotSize = 8 / Math.max(zoom, 0.001)

  const onSelect = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setSelection([camera.id])
  }

  // Label badge — 12px text scaled inverse to zoom so it stays
  // readable at any zoom level.
  const labelFontSize = 11 / Math.max(zoom, 0.001)
  const labelPadX = 6 / Math.max(zoom, 0.001)
  const labelPadY = 2 / Math.max(zoom, 0.001)
  const dashGap = 6 / Math.max(zoom, 0.001)
  const dashLen = 8 / Math.max(zoom, 0.001)

  return (
    <>
      {/* Viewfinder rectangle. Always uses the accent color so it's
          unmistakable as camera chrome (as opposed to a regular layer
          outline). Dashed border to differentiate from solid layer
          selections. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left,
          top,
          width: viewW,
          height: viewH,
          borderWidth: stroke * 1.5,
          borderStyle: 'dashed',
          borderColor: 'var(--color-accent)',
          opacity: selected ? 1 : 0.55,
          transform: r !== 0 ? `rotate(${r}deg)` : undefined,
          transformOrigin: 'center center',
          // Prevent the long dashes from looking blurry at low zoom.
          backgroundImage: 'none',
          // Tweak dash stroke to follow the same scale-with-zoom rule.
          borderImage: 'none',
          ['--dash-len' as string]: `${dashLen}px`,
          ['--dash-gap' as string]: `${dashGap}px`,
        }}
      />
      {/* Camera label — badge at the top-left of the viewfinder so the
          rectangle is unambiguously identified as the camera, not a
          stray frame outline. */}
      <div
        onPointerDown={onSelect}
        className="absolute cursor-pointer rounded font-mono uppercase tracking-wider text-white"
        style={{
          left,
          top,
          transform: `translate(0, calc(-100% - ${4 / Math.max(zoom, 0.001)}px))`,
          background: 'var(--color-accent)',
          padding: `${labelPadY}px ${labelPadX}px`,
          fontSize: labelFontSize,
          opacity: selected ? 1 : 0.7,
          pointerEvents: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        ◉ Camera
      </div>
      {/* Center pivot — accent-colored dot at the camera's position.
          Always visible (not just when selected) so the user can
          locate the camera at a glance. Soft halo when selected for
          extra emphasis. */}
      <div
        onPointerDown={onSelect}
        title="Camera"
        className="absolute cursor-pointer rounded-full"
        style={{
          left: cx - dotSize / 2,
          top: cy - dotSize / 2,
          width: dotSize,
          height: dotSize,
          background: 'var(--color-accent)',
          border: `${stroke}px solid white`,
          boxShadow: selected
            ? `0 0 0 ${stroke * 3}px var(--color-accent-soft), 0 1px 3px rgba(0,0,0,0.3)`
            : `0 1px 3px rgba(0,0,0,0.3)`,
          pointerEvents: 'auto',
        }}
      />
    </>
  )
}
