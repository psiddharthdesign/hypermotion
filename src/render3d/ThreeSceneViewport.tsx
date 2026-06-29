// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { AnimatedValue } from '@/anim'
import type { Rect, SolvedLayout } from '@/layout'
import type { CameraNode, Fill, Node, NodeId, SceneAPI } from '@/scene'
import { fillToCss } from '@/scene'
import {
  buildWorldPlanes,
  cameraFrustumCorners,
  depthBlurAmount,
  resolveCamera3D,
  type Plane3D,
  type ResolvedCamera3D,
} from '@/render3d/scene3d'
import { dot3, sub3 } from '@/render3d/math'

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
  onAvailabilityChange?: (available: boolean) => void
}

interface PlaneRecord {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  outline: THREE.LineSegments
  texture: THREE.CanvasTexture
  textureRequest: number
}

interface PlaneFocusMask {
  x: number
  y: number
  radius: number
  falloff: number
}

const MAX_TEXTURE_SCALE = 4
const MAX_TEXTURE_DIMENSION = 4096

function textureScaleForRect(rect: Rect): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const desired = Math.min(MAX_TEXTURE_SCALE, Math.max(2, dpr * 2))
  const maxSide = Math.max(1, Math.ceil(Math.max(rect.width, rect.height)))
  return Math.max(1, Math.min(desired, MAX_TEXTURE_DIMENSION / maxSide))
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
  onAvailabilityChange,
}: ThreeSceneViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const planesRef = useRef<Map<NodeId, PlaneRecord>>(new Map())
  const helpersRef = useRef<THREE.Group | null>(null)
  const [webglUnavailable, setWebglUnavailable] = useState(false)

  const baseCamera = useMemo(
    () => resolveCamera3D(camera, cameraAnim, { width, height }),
    [camera, cameraAnim, width, height],
  )
  const focusTargetWorld = useMemo(() => {
    if ((camera.focusMode ?? 'screen') !== 'target' || !camera.focusTargetNodeId) {
      return null
    }
    const targetPlane = buildWorldPlanes(api, layout, animated, baseCamera, {
      independentNodes: true,
    }).find((plane) => plane.nodeId === camera.focusTargetNodeId)
    return targetPlane?.center ?? null
  }, [api, layout, animated, baseCamera, camera.focusMode, camera.focusTargetNodeId])
  const resolvedCamera = useMemo(
    () => resolveCamera3D(camera, cameraAnim, { width, height }, focusTargetWorld),
    [camera, cameraAnim, width, height, focusTargetWorld],
  )
  const planes = buildWorldPlanes(api, layout, animated, resolvedCamera)

  useEffect(() => {
    if (webglUnavailable) return
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch (error) {
      console.warn('3D helper disabled: WebGL context creation failed.', error)
      setWebglUnavailable(true)
      onAvailabilityChange?.(false)
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(width, height, false)
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
        record.mesh.geometry.dispose()
        record.mesh.material.dispose()
        record.texture.dispose()
        record.outline.geometry.dispose()
        ;(record.outline.material as THREE.Material).dispose()
      }
      planesRef.current.clear()
      renderer.dispose()
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

  useEffect(() => {
    if (webglUnavailable) return
    const renderer = rendererRef.current
    const perspective = cameraRef.current
    if (!renderer || !perspective) return
    renderer.setSize(width, height, false)
    perspective.aspect = width / Math.max(1, height)
    perspective.updateProjectionMatrix()
  }, [webglUnavailable, width, height])

  useEffect(() => {
    if (webglUnavailable) return
    const scene = sceneRef.current
    const perspective = cameraRef.current
    const renderer = rendererRef.current
    if (!scene || !perspective || !renderer) return

    syncThreeCamera(perspective, resolvedCamera, width, height)
    syncBackground(scene, sceneFill)
    if (showPlanes) {
      syncPlanes(
        scene,
        planesRef.current,
        api,
        layout,
        planes,
        selectedIds,
        resolvedCamera,
        renderer,
        perspective,
      )
    } else {
      clearPlanes(scene, planesRef.current)
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
  }, [api, layout, planes, resolvedCamera, sceneFill, selectedIds, showHelpers, showPlanes, focusWorldPoint, width, height, webglUnavailable])

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
  scene.background = sceneFill ? new THREE.Color(parseCssColor(sceneFill)) : null
}

function syncPlanes(
  scene: THREE.Scene,
  records: Map<NodeId, PlaneRecord>,
  api: SceneAPI,
  layout: SolvedLayout,
  planes: Plane3D[],
  selectedIds: NodeId[],
  camera: ResolvedCamera3D,
  renderer: THREE.WebGLRenderer,
  perspective: THREE.PerspectiveCamera,
) {
  const active = new Set<NodeId>()
  const selected = new Set(selectedIds)
  for (const plane of planes) {
    active.add(plane.nodeId)
    let record = records.get(plane.nodeId)
    const blur = depthBlurAmount(
      plane.cameraDepth,
      plane.center,
      camera.focusWorld,
      camera.focusDistance,
      camera.focusRadius,
      camera.focusFalloff,
      camera.aperture,
      camera.blurLevel,
      camera.focalLength,
      camera.depthOfField,
    )
    const focusMask = focusMaskForPlane(plane, camera)
    const canvas = renderPlaneCanvas(api, layout, plane, blur, focusMask)
    if (!record) {
      const geometry = new THREE.PlaneGeometry(plane.rect.width, plane.rect.height)
      const texture = createPlaneTexture(canvas, renderer)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = plane.node.name
      const outline = makePlaneOutline(plane.rect.width, plane.rect.height)
      scene.add(mesh)
      scene.add(outline)
      record = { mesh, outline, texture, textureRequest: 0 }
      records.set(plane.nodeId, record)
    } else {
      const current = record.mesh.geometry.parameters
      if (current.width !== plane.rect.width || current.height !== plane.rect.height) {
        record.mesh.geometry.dispose()
        record.mesh.geometry = new THREE.PlaneGeometry(plane.rect.width, plane.rect.height)
        record.outline.geometry.dispose()
        record.outline.geometry = makePlaneOutlineGeometry(plane.rect.width, plane.rect.height)
      }
    }
    const previousImage = record.texture.image as HTMLCanvasElement | undefined
    if (
      previousImage &&
      (previousImage.width !== canvas.width || previousImage.height !== canvas.height)
    ) {
      const material = record.mesh.material as THREE.MeshBasicMaterial
      record.texture.dispose()
      record.texture = createPlaneTexture(canvas, renderer)
      material.map = record.texture
      material.needsUpdate = true
    } else {
      record.texture.image = canvas
    }
    record.texture.needsUpdate = true
    applyPlaneTransform(record.mesh, plane)
    applyPlaneTransform(record.outline, plane)
    record.mesh.renderOrder = plane.paintOrder
    record.outline.renderOrder = 100000 + plane.paintOrder
    record.mesh.material.opacity = (plane.node.appearance.opacity ?? 1)
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
    record.mesh.geometry.dispose()
    record.mesh.material.dispose()
    record.texture.dispose()
    record.outline.geometry.dispose()
    ;(record.outline.material as THREE.Material).dispose()
    records.delete(id)
  }
}

function clearPlanes(scene: THREE.Scene, records: Map<NodeId, PlaneRecord>) {
  for (const [, record] of records) {
    scene.remove(record.mesh)
    scene.remove(record.outline)
    record.mesh.geometry.dispose()
    record.mesh.material.dispose()
    record.texture.dispose()
    record.outline.geometry.dispose()
    ;(record.outline.material as THREE.Material).dispose()
  }
  records.clear()
}

function queueDomPlaneTexture(
  record: PlaneRecord,
  plane: Plane3D,
  blurPx: number,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  perspective: THREE.PerspectiveCamera,
) {
  if (plane.contentMode === 'self') return
  const request = record.textureRequest + 1
  record.textureRequest = request
  renderDomPlaneTexture(plane.rect, blurPx).then((canvas) => {
    if (!canvas || record.textureRequest !== request) return
    record.texture.image = canvas
    record.texture.needsUpdate = true
    renderer.render(scene, perspective)
  }).catch(() => {
    // Keep the deterministic scene-data fallback if DOM snapshotting fails.
  })
}

async function renderDomPlaneTexture(
  rootRect: Rect,
  blurPx: number,
): Promise<HTMLCanvasElement | null> {
  if (typeof document === 'undefined') return null
  const source = document.querySelector<HTMLElement>('[data-three-texture-source="1"]')
  if (!source) return null
  const width = Math.max(1, Math.ceil(rootRect.width))
  const height = Math.max(1, Math.ceil(rootRect.height))
  const sourceClone = source.cloneNode(true) as HTMLElement
  sourceClone.removeAttribute('data-three-texture-source')
  sourceClone.style.position = 'absolute'
  sourceClone.style.left = `${-rootRect.x}px`
  sourceClone.style.top = `${-rootRect.y}px`
  sourceClone.style.width = source.style.width || `${Math.ceil(source.getBoundingClientRect().width)}px`
  sourceClone.style.height = source.style.height || `${Math.ceil(source.getBoundingClientRect().height)}px`
  sourceClone.style.transform = 'none'
  sourceClone.style.transformOrigin = '0 0'
  sourceClone.style.opacity = '1'
  sourceClone.style.pointerEvents = 'none'
  sourceClone.style.background = 'transparent'
  for (const el of Array.from(sourceClone.querySelectorAll<HTMLElement>('[data-export-hide="1"]'))) {
    el.remove()
  }
  const wrapper = document.createElement('div')
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  wrapper.style.position = 'relative'
  wrapper.style.width = `${width}px`
  wrapper.style.height = `${height}px`
  wrapper.style.overflow = 'hidden'
  wrapper.style.background = 'transparent'
  wrapper.appendChild(sourceClone)
  const serialized = new XMLSerializer().serializeToString(wrapper)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject>` +
    `</svg>`
  const image = await loadSvgImage(svg)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.dataset.blur = String(Number(blurPx.toFixed(2)))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, width, height)
  if (blurPx > 0.05) ctx.filter = `blur(${Number(blurPx.toFixed(2))}px)`
  ctx.drawImage(image, 0, 0)
  ctx.filter = 'none'
  return canvas
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to rasterize DOM plane texture'))
    image.src = url
  })
}

function renderPlaneCanvas(
  api: SceneAPI,
  layout: SolvedLayout,
  plane: Plane3D,
  blurPx: number,
  focusMask: PlaneFocusMask | null,
): HTMLCanvasElement {
  const sharp = renderSharpPlaneCanvas(api, layout, plane)
  if (blurPx <= 0.05) return sharp
  const blurred = renderBlurredPlaneCanvas(api, layout, plane, blurPx)
  if (!focusMask) return blurred
  return compositeFocusedPlaneTexture(blurred, sharp, focusMask)
}

function renderSharpPlaneCanvas(
  api: SceneAPI,
  layout: SolvedLayout,
  plane: Plane3D,
): HTMLCanvasElement {
  if (plane.contentMode === 'self') {
    return renderPlaneTexture(plane.node, plane.rect, 0)
  }
  return (
    renderSubtreeTexture(api, layout, plane.nodeId, plane.rect, 0) ??
    renderPlaneTexture(plane.node, plane.rect, 0)
  )
}

function renderBlurredPlaneCanvas(
  api: SceneAPI,
  layout: SolvedLayout,
  plane: Plane3D,
  blurPx: number,
): HTMLCanvasElement {
  if (plane.contentMode === 'self') {
    return renderPlaneTexture(plane.node, plane.rect, blurPx)
  }
  return (
    renderSubtreeTexture(api, layout, plane.nodeId, plane.rect, blurPx) ??
    renderPlaneTexture(plane.node, plane.rect, blurPx)
  )
}

function focusMaskForPlane(
  plane: Plane3D,
  camera: ResolvedCamera3D,
): PlaneFocusMask | null {
  if (!camera.depthOfField || camera.aperture <= 0 || camera.blurLevel <= 0) return null
  const rel = sub3(camera.focusWorld, plane.center)
  const sx = Math.max(0.0001, Math.abs(plane.scaleX))
  const sy = Math.max(0.0001, Math.abs(plane.scaleY))
  const x = dot3(rel, plane.right) / sx + plane.rect.width / 2
  const y = dot3(rel, plane.down) / sy + plane.rect.height / 2
  const scale = Math.max(0.0001, (sx + sy) / 2)
  const radius = camera.focusRadius / scale
  const falloff = camera.focusFalloff / scale
  const margin = radius + falloff
  if (
    x < -margin ||
    x > plane.rect.width + margin ||
    y < -margin ||
    y > plane.rect.height + margin
  ) {
    return null
  }
  return { x, y, radius, falloff }
}

function compositeFocusedPlaneTexture(
  blurred: HTMLCanvasElement,
  sharp: HTMLCanvasElement,
  focus: PlaneFocusMask,
): HTMLCanvasElement {
  const width = blurred.width
  const height = blurred.height
  const scale = Number(blurred.dataset.textureScale || '1') || 1
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  output.dataset.textureScale = String(scale)
  const ctx = output.getContext('2d')
  if (!ctx) return blurred
  ctx.drawImage(blurred, 0, 0)

  const sharpLayer = document.createElement('canvas')
  sharpLayer.width = width
  sharpLayer.height = height
  sharpLayer.dataset.textureScale = String(scale)
  const sharpCtx = sharpLayer.getContext('2d')
  if (!sharpCtx) return blurred
  sharpCtx.drawImage(sharp, 0, 0)
  sharpCtx.globalCompositeOperation = 'destination-in'
  const gradient = sharpCtx.createRadialGradient(
    focus.x * scale,
    focus.y * scale,
    Math.max(0, focus.radius * scale),
    focus.x * scale,
    focus.y * scale,
    Math.max((focus.radius + focus.falloff) * scale, (focus.radius + 1) * scale),
  )
  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(0.75, 'rgba(0,0,0,1)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  sharpCtx.fillStyle = gradient
  sharpCtx.fillRect(0, 0, width, height)
  sharpCtx.globalCompositeOperation = 'source-over'

  ctx.drawImage(sharpLayer, 0, 0)
  return output
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

function makePlaneOutline(width: number, height: number): THREE.LineSegments {
  return new THREE.LineSegments(
    makePlaneOutlineGeometry(width, height),
    new THREE.LineBasicMaterial({ color: 0x0a84ff, depthTest: false }),
  )
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
  group.clear()
  if (!show) return
  const grid = new THREE.GridHelper(Math.max(width, height), 24, 0x9ca3af, 0xd1d5db)
  grid.rotation.x = Math.PI / 2
  grid.position.set(width / 2, height / 2, -400)
  group.add(grid)

  const helperCamera = new THREE.PerspectiveCamera(
    camera.fieldOfView,
    width / Math.max(1, height),
    camera.nearClip,
    Math.min(camera.farClip, 2400),
  )
  syncThreeCamera(helperCamera, camera, width, height)
  const frustum = new THREE.CameraHelper(helperCamera)
  ;(frustum.material as THREE.LineBasicMaterial).color.set(0x94a3b8)
  group.add(frustum)

  const corners = cameraFrustumCorners(camera, { width, height }, camera.focusDistance)
  const focusGeometry = new THREE.BufferGeometry().setFromPoints([
    toThreeVector(corners[0]!),
    toThreeVector(corners[1]!),
    toThreeVector(corners[2]!),
    toThreeVector(corners[3]!),
    toThreeVector(corners[0]!),
  ])
  const focusPlane = new THREE.Line(
    focusGeometry,
    new THREE.LineBasicMaterial({ color: 0x0a84ff, depthTest: false, transparent: true, opacity: 0.8 }),
  )
  group.add(focusPlane)

  const focusCenter =
    focusWorldPoint ??
    {
      x: (corners[0]!.x + corners[2]!.x) / 2,
      y: (corners[0]!.y + corners[2]!.y) / 2,
      z: (corners[0]!.z + corners[2]!.z) / 2,
    }
  const lineGeometry = new THREE.BufferGeometry().setFromPoints([
    toThreeVector(camera.position),
    toThreeVector(focusCenter),
  ])
  group.add(
    new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({ color: 0x0a84ff, depthTest: false }),
    ),
  )
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(8, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0x0a84ff, depthTest: false }),
  )
  marker.position.copy(toThreeVector(focusCenter))
  group.add(marker)
}

function renderPlaneTexture(node: Node, rect: Rect, blurPx: number): HTMLCanvasElement {
  const w = Math.max(1, Math.ceil(rect.width))
  const h = Math.max(1, Math.ceil(rect.height))
  const scale = textureScaleForRect(rect)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(w * scale))
  canvas.height = Math.max(1, Math.ceil(h * scale))
  canvas.dataset.textureScale = String(scale)
  canvas.dataset.blur = String(Number(blurPx.toFixed(2)))
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.clearRect(0, 0, w, h)
  if (blurPx > 0.05) {
    ctx.filter = `blur(${Number((blurPx * scale).toFixed(2))}px)`
  }
  const cornerRadius =
    node.kind === 'ellipse'
      ? Math.min(w, h) / 2
      : Math.max(0, Math.min(node.appearance.cornerRadius ?? 0, Math.min(w, h) / 2))
  withRoundedClip(ctx, w, h, cornerRadius, () => {
    paintFill(ctx, node.appearance.fill, w, h, node.kind === 'text')
    if (node.kind === 'image' && node.src) {
      paintImagePlaceholder(ctx, w, h)
    }
  })
  if (node.kind === 'text') {
    ctx.fillStyle = node.color ?? '#111111'
    ctx.font = `${node.fontWeight ?? 400} ${node.fontSize ?? 16}px ${node.fontFamily ?? 'Inter'}`
    ctx.textBaseline = 'top'
    paintText(ctx, node.text, 0, 0, w, node.fontSize ?? 16, node.lineHeight ?? 1.2)
  }
  ctx.filter = 'none'
  const stroke = node.appearance.stroke
  if (stroke && stroke.width > 0) {
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    roundedRectPath(
      ctx,
      stroke.width / 2,
      stroke.width / 2,
      w - stroke.width,
      h - stroke.width,
      Math.max(0, cornerRadius - stroke.width / 2),
    )
    ctx.stroke()
  }
  return canvas
}

function renderSubtreeTexture(
  api: SceneAPI,
  layout: SolvedLayout,
  rootId: NodeId,
  rootRect: Rect,
  blurPx: number,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const width = Math.max(1, Math.ceil(rootRect.width))
  const height = Math.max(1, Math.ceil(rootRect.height))
  const scale = textureScaleForRect(rootRect)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  canvas.dataset.textureScale = String(scale)
  canvas.dataset.blur = String(Number(blurPx.toFixed(2)))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.clearRect(0, 0, width, height)
  if (blurPx > 0.05) {
    ctx.filter = `blur(${Number((blurPx * scale).toFixed(2))}px)`
  }
  const paint = (id: NodeId) => {
    const node = api.getNode(id)
    const rect = layout[id]
    if (!node || !rect || node.kind === 'camera' || !node.visible) return
    const extracted3D = id !== rootId && isExplicit3DNode(node)
    if (extracted3D) return
    paintNodeIntoSubtree(ctx, node, rect, rootRect)
    for (const child of node.children) paint(child)
  }
  paint(rootId)
  ctx.filter = 'none'
  return canvas
}

function isExplicit3DNode(node: Node): boolean {
  const renderMode = node.transform.renderMode ?? 'flat'
  return renderMode === 'plane' || renderMode === 'group3d'
}

function paintNodeIntoSubtree(
  ctx: CanvasRenderingContext2D,
  node: Node,
  rect: Rect,
  rootRect: Rect,
) {
  const x = rect.x - rootRect.x
  const y = rect.y - rootRect.y
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  ctx.save()
  ctx.globalAlpha *= node.appearance.opacity ?? 1
  ctx.translate(x + w / 2, y + h / 2)
  const rot = node.transform.rotation ?? 0
  if (rot !== 0) ctx.rotate(THREE.MathUtils.degToRad(rot))
  ctx.scale(node.transform.scaleX ?? 1, node.transform.scaleY ?? 1)
  ctx.translate(-w / 2, -h / 2)
  const localRect = { x: 0, y: 0, width: w, height: h }
  const nodeForPaint = node
  renderNodePaint(ctx, nodeForPaint, localRect)
  ctx.restore()
}

function renderNodePaint(ctx: CanvasRenderingContext2D, node: Node, rect: Rect) {
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  const cornerRadius =
    node.kind === 'ellipse'
      ? Math.min(w, h) / 2
      : Math.max(0, Math.min(node.appearance.cornerRadius ?? 0, Math.min(w, h) / 2))
  withRoundedClip(ctx, w, h, cornerRadius, () => {
    paintFill(ctx, node.appearance.fill, w, h, node.kind === 'text')
    if (node.kind === 'image' && node.src) paintImagePlaceholder(ctx, w, h)
  })
  if (node.kind === 'text') {
    ctx.fillStyle = node.color ?? '#111111'
    ctx.font = `${node.fontWeight ?? 400} ${node.fontSize ?? 16}px ${node.fontFamily ?? 'Inter'}`
    ctx.textBaseline = 'top'
    paintText(ctx, node.text, 0, 0, w, node.fontSize ?? 16, node.lineHeight ?? 1.2)
  }
  const stroke = node.appearance.stroke
  if (stroke && stroke.width > 0) {
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    roundedRectPath(
      ctx,
      stroke.width / 2,
      stroke.width / 2,
      w - stroke.width,
      h - stroke.width,
      Math.max(0, cornerRadius - stroke.width / 2),
    )
    ctx.stroke()
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
  const css = fillToCss(fill)
  ctx.fillStyle = parseCssColor(css ?? '#f8fafc')
  ctx.fillRect(0, 0, width, height)
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

function paintText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  lineHeight: number,
) {
  const lineHeightPx = Math.max(1, fontSize * lineHeight)
  const words = text.split(/(\s+)/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line + word
    if (ctx.measureText(next).width <= maxWidth || line.trim() === '') {
      line = next
    } else {
      lines.push(line.trimEnd())
      line = word.trimStart()
    }
  }
  if (line) lines.push(line.trimEnd())
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeightPx))
}

function paintImagePlaceholder(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#f8fafc')
  gradient.addColorStop(1, '#e2e8f0')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

function parseCssColor(value: string): string {
  if (value.startsWith('oklch(')) return '#f8fafc'
  if (value.startsWith('linear-gradient') || value.startsWith('radial-gradient') || value.startsWith('conic-gradient')) {
    return '#f8fafc'
  }
  return value
}
