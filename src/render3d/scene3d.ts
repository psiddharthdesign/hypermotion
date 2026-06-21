// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { Rect, SolvedLayout } from '@/layout'
import type { CameraNode, Node, NodeId, SceneAPI } from '@/scene'
import {
  add3,
  cross3,
  dot3,
  focalLengthToFov,
  fovToFocalLength,
  len3,
  mul3,
  norm3,
  rotateEuler,
  sub3,
  type Ray3,
  type Vec3,
} from '@/render3d/math'

export interface ViewportSize {
  width: number
  height: number
}

export interface ResolvedCamera3D {
  nodeId: NodeId
  position: Vec3
  rotation: Vec3
  pointOfInterest: Vec3
  focalLength: number
  fieldOfView: number
  nearClip: number
  farClip: number
  focusDistance: number
  aperture: number
  blurLevel: number
  blurQuality: number
}

export interface Plane3D {
  nodeId: NodeId
  node: Node
  rect: Rect
  contentMode: 'self' | 'subtree'
  paintOrder: number
  center: Vec3
  rotation: Vec3
  scaleX: number
  scaleY: number
  anchor: Vec3
  right: Vec3
  down: Vec3
  normal: Vec3
  cameraDepth: number
}

interface PlaneBuildOptions {
  /**
   * Root children become planes even when their renderMode is still flat.
   * This is the bridge that lets normal auto-layout designs appear as
   * solid AE-style layers without requiring every old scene to be edited.
   */
  promoteRootChildren?: boolean
}

export interface FocusHit3D {
  nodeId: NodeId
  point: Vec3
  viewport: { x: number; y: number }
  cameraDepth: number
  localX: number
  localY: number
}

const IDENTITY_INHERITED = {
  origin: { x: 0, y: 0, z: 0 },
  anchor: { x: 0, y: 0, z: 0 },
  basisX: { x: 1, y: 0, z: 0 },
  basisY: { x: 0, y: 1, z: 0 },
  basisZ: { x: 0, y: 0, z: 1 },
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
}

interface Inherited3D {
  origin: Vec3
  anchor: Vec3
  basisX: Vec3
  basisY: Vec3
  basisZ: Vec3
  rotation: number
  rotationX: number
  rotationY: number
  scaleX: number
  scaleY: number
}

export function resolveCamera3D(
  camera: CameraNode,
  animated: AnimatedValue | undefined,
  viewport: ViewportSize,
): ResolvedCamera3D {
  const fieldOfView =
    animated?.fieldOfView ??
    camera.fieldOfView ??
    Math.max(
      1,
      Math.min(
        175,
        focalLengthToFov(
          animated?.focalLength ?? camera.focalLength ?? 1000,
          viewport.height,
        ),
      ),
    )
  const focalLength = Math.max(1, fovToFocalLength(fieldOfView, viewport.height))
  const transformZ = animated?.z ?? camera.transform.z
  const dolly = transformZ / 100
  const pointOfInterest = {
    x: animated?.pointOfInterestX ?? camera.pointOfInterestX ?? camera.focusWorldX ?? camera.transform.x,
    y: animated?.pointOfInterestY ?? camera.pointOfInterestY ?? camera.focusWorldY ?? camera.transform.y,
    z: animated?.pointOfInterestZ ?? camera.pointOfInterestZ ?? camera.focusWorldZ ?? 0,
  }
  const rotation = {
    x: animated?.rotationX ?? camera.transform.rotationX,
    y: animated?.rotationY ?? camera.transform.rotationY,
    z: animated?.rotation ?? camera.transform.rotation,
  }
  const basePosition = {
    x: animated?.x ?? camera.transform.x,
    y: animated?.y ?? camera.transform.y,
    z: pointOfInterest.z - Math.max(1, focalLength - dolly),
  }
  const orbitOffset = rotateEuler(sub3(basePosition, pointOfInterest), rotation.x, rotation.y, 0)
  const position = add3(pointOfInterest, orbitOffset)
  const focusWorld = {
    x: animated?.focusWorldX ?? camera.focusWorldX ?? camera.focusX ?? camera.transform.x,
    y: animated?.focusWorldY ?? camera.focusWorldY ?? camera.focusY ?? camera.transform.y,
    z: animated?.focusWorldZ ?? camera.focusWorldZ ?? 0,
  }
  const basis = cameraBasisFromPosition(position, pointOfInterest, rotation.z)
  const focusDepth = Math.max(
    0.001,
    (animated?.focusDistance ?? camera.focusDistance) || dot3(sub3(focusWorld, position), basis.forward),
  )
  const nearClip = Math.max(0.001, animated?.nearClip ?? camera.nearClip ?? 1)
  const authoredFarClip = Math.max(1, animated?.farClip ?? camera.farClip ?? 100000)
  const targetDepth = Math.max(1, dot3(sub3(pointOfInterest, position), basis.forward))
  const farClip = Math.max(
    authoredFarClip,
    targetDepth + Math.max(viewport.width, viewport.height) * 2,
    focusDepth + Math.max(viewport.width, viewport.height),
  )
  return {
    nodeId: camera.id,
    position,
    rotation,
    pointOfInterest,
    focalLength,
    fieldOfView,
    nearClip,
    farClip,
    focusDistance: focusDepth,
    aperture: Math.max(0, animated?.aperture ?? camera.aperture ?? 0),
    blurLevel: Math.max(0, animated?.blurLevel ?? camera.blurLevel ?? 0),
    blurQuality: Math.max(1, animated?.blurQuality ?? camera.blurQuality ?? 8),
  }
}

function rotateAroundAxis(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const rad = (deg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const k = norm3(axis)
  return add3(
    add3(mul3(v, c), mul3(cross3(k, v), s)),
    mul3(k, dot3(k, v) * (1 - c)),
  )
}

function cameraBasisFromPosition(
  position: Vec3,
  pointOfInterest: Vec3,
  rollDeg: number,
): { right: Vec3; down: Vec3; forward: Vec3 } {
  const forward = norm3(sub3(pointOfInterest, position))
  const worldDown = { x: 0, y: 1, z: 0 }
  let right = cross3(worldDown, forward)
  if (len3(right) < 0.0001) right = { x: 1, y: 0, z: 0 }
  right = norm3(right)
  let down = norm3(cross3(forward, right))
  if (rollDeg !== 0) {
    right = rotateAroundAxis(right, forward, rollDeg)
    down = rotateAroundAxis(down, forward, rollDeg)
  }
  return { right, down, forward }
}

function cameraBasis(camera: ResolvedCamera3D): { right: Vec3; down: Vec3; forward: Vec3 } {
  return cameraBasisFromPosition(camera.position, camera.pointOfInterest, camera.rotation.z)
}

export function viewportPointToRay(
  camera: ResolvedCamera3D,
  viewportX: number,
  viewportY: number,
  viewport: ViewportSize,
): Ray3 {
  const local = norm3({
    x: viewportX - viewport.width / 2,
    y: viewportY - viewport.height / 2,
    z: camera.focalLength,
  })
  const basis = cameraBasis(camera)
  return {
    origin: camera.position,
    direction: norm3(
      add3(
        add3(mul3(basis.right, local.x), mul3(basis.down, local.y)),
        mul3(basis.forward, local.z),
      ),
    ),
  }
}

export function worldToCamera(point: Vec3, camera: ResolvedCamera3D): Vec3 {
  const rel = sub3(point, camera.position)
  const basis = cameraBasis(camera)
  return {
    x: dot3(rel, basis.right),
    y: dot3(rel, basis.down),
    z: dot3(rel, basis.forward),
  }
}

export function cameraSpaceDepth(point: Vec3, camera: ResolvedCamera3D): number {
  return worldToCamera(point, camera).z
}

export function projectWorldPoint(
  point: Vec3,
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
): { x: number; y: number } {
  const cameraSpace = worldToCamera(point, camera)
  const z = Math.max(camera.nearClip, cameraSpace.z)
  const scale = camera.focalLength / z
  return {
    x: viewport.width / 2 + cameraSpace.x * scale,
    y: viewport.height / 2 + cameraSpace.y * scale,
  }
}

export function buildWorldPlanes(
  api: SceneAPI,
  layout: SolvedLayout,
  animated: Record<NodeId, AnimatedValue>,
  camera: ResolvedCamera3D,
  options: PlaneBuildOptions = {},
): Plane3D[] {
  const rootId = api.getRoot()
  if (!rootId) return []
  const planes: Plane3D[] = []

  const mapPoint = (transform: Inherited3D, point: Vec3): Vec3 =>
    add3(
      transform.origin,
      add3(
        add3(
          mul3(transform.basisX, point.x - transform.anchor.x),
          mul3(transform.basisY, point.y - transform.anchor.y),
        ),
        mul3(transform.basisZ, point.z - transform.anchor.z),
      ),
    )

  const mapLocalVector = (transform: Inherited3D, vector: Vec3): Vec3 =>
    add3(
      add3(mul3(transform.basisX, vector.x), mul3(transform.basisY, vector.y)),
      mul3(transform.basisZ, vector.z),
    )

  const visit = (id: NodeId, inherited: Inherited3D): void => {
    const node = api.getNode(id)
    const rect = layout[id]
    if (!node || !rect || node.kind === 'camera') return
    const a = animated[id]
    const isRoot = id === rootId
    const x = a?.x ?? node.transform.x
    const y = a?.y ?? node.transform.y
    const z = a?.z ?? node.transform.z
    const rotation = a?.rotation ?? node.transform.rotation
    const rotationX = a?.rotationX ?? node.transform.rotationX
    const rotationY = a?.rotationY ?? node.transform.rotationY
    const scaleX = a?.scaleX ?? node.transform.scaleX
    const scaleY = a?.scaleY ?? node.transform.scaleY
    const anchor = {
      x: (a?.anchorX ?? node.transform.anchorX ?? 0.5) * rect.width,
      y: (a?.anchorY ?? node.transform.anchorY ?? 0.5) * rect.height,
      z: a?.anchorZ ?? node.transform.anchorZ ?? 0,
    }
    const anchorPoint = {
      x: rect.x + anchor.x,
      y: rect.y + anchor.y,
      z: anchor.z,
    }
    const translation = isRoot
      ? mapLocalVector(inherited, { x: 0, y: 0, z })
      : mapLocalVector(inherited, { x, y, z })
    const localBasisX = rotateEuler({ x: isRoot ? 1 : scaleX, y: 0, z: 0 }, rotationX, rotationY, rotation)
    const localBasisY = rotateEuler({ x: 0, y: isRoot ? 1 : scaleY, z: 0 }, rotationX, rotationY, rotation)
    const localBasisZ = rotateEuler({ x: 0, y: 0, z: 1 }, rotationX, rotationY, rotation)
    const nextInherited: Inherited3D = {
      origin: add3(mapPoint(inherited, anchorPoint), translation),
      anchor: anchorPoint,
      basisX: mapLocalVector(inherited, localBasisX),
      basisY: mapLocalVector(inherited, localBasisY),
      basisZ: mapLocalVector(inherited, localBasisZ),
      rotation: inherited.rotation + rotation,
      rotationX: inherited.rotationX + rotationX,
      rotationY: inherited.rotationY + rotationY,
      scaleX: isRoot ? inherited.scaleX : inherited.scaleX * scaleX,
      scaleY: isRoot ? inherited.scaleY : inherited.scaleY * scaleY,
    }

    const parent = node.parent ? api.getNode(node.parent) : null
    const renderMode = node.transform.renderMode ?? 'flat'
    const parentMode = parent?.transform.renderMode ?? 'flat'
    const isRootChild = node.parent === rootId
    const shouldEmitPlane =
      !isRoot &&
      (renderMode === 'plane' ||
        renderMode === 'group3d' ||
        parentMode === 'group3d' ||
        (options.promoteRootChildren ?? true) && isRootChild)

    if (shouldEmitPlane) {
      const rotX = nextInherited.rotationX
      const rotY = nextInherited.rotationY
      const rotZ = nextInherited.rotation
      const right = norm3(nextInherited.basisX)
      const down = norm3(nextInherited.basisY)
      const normal = norm3(nextInherited.basisZ)
      const center = mapPoint(nextInherited, {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        z: 0,
      })
      planes.push({
        nodeId: id,
        node,
        rect,
        contentMode: renderMode === 'group3d' ? 'self' : 'subtree',
        paintOrder: planes.length,
        center,
        rotation: { x: rotX, y: rotY, z: rotZ },
        scaleX: nextInherited.scaleX,
        scaleY: nextInherited.scaleY,
        anchor,
        right,
        down,
        normal,
        cameraDepth: cameraSpaceDepth(center, camera),
      })
    }

    if (!shouldEmitPlane || (node.transform.renderMode ?? 'flat') === 'group3d') {
      for (const child of node.children) visit(child, nextInherited)
    }
  }

  visit(rootId, IDENTITY_INHERITED)
  return planes
}

export function hitTestPlanes(
  planes: Plane3D[],
  ray: Ray3,
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
): FocusHit3D | null {
  let best: (FocusHit3D & { t: number }) | null = null
  for (let i = planes.length - 1; i >= 0; i--) {
    const plane = planes[i]!
    if (!plane.node.visible || plane.node.locked) continue
    const denom = dot3(ray.direction, plane.normal)
    if (Math.abs(denom) < 0.0001) continue
    const t = dot3(sub3(plane.center, ray.origin), plane.normal) / denom
    if (t <= 0 || (best && t >= best.t)) continue
    const point = add3(ray.origin, mul3(ray.direction, t))
    const rel = sub3(point, plane.center)
    const localX = dot3(rel, plane.right) / Math.max(0.0001, Math.abs(plane.scaleX)) + plane.rect.width / 2
    const localY = dot3(rel, plane.down) / Math.max(0.0001, Math.abs(plane.scaleY)) + plane.rect.height / 2
    if (localX < 0 || localX > plane.rect.width || localY < 0 || localY > plane.rect.height) continue
    best = {
      nodeId: plane.nodeId,
      point,
      viewport: projectWorldPoint(point, camera, viewport),
      cameraDepth: cameraSpaceDepth(point, camera),
      localX,
      localY,
      t,
    }
  }
  return best
}

export function depthBlurAmount(
  cameraDepth: number,
  focusDistance: number,
  aperture: number,
  blurLevel: number,
  focalLength: number,
): number {
  if (aperture <= 0 || blurLevel <= 0) return 0
  const delta = Math.abs(cameraDepth - focusDistance)
  const depthScale = Math.max(80, focalLength * 0.35)
  const falloff = 1 - Math.exp(-(delta / depthScale) * aperture * 1.6)
  return Math.max(0, Math.min(blurLevel, blurLevel * falloff))
}

export function cameraFrustumCorners(camera: ResolvedCamera3D, viewport: ViewportSize, depth: number): Vec3[] {
  const basis = cameraBasis(camera)
  const halfH = (depth / camera.focalLength) * (viewport.height / 2)
  const halfW = (depth / camera.focalLength) * (viewport.width / 2)
  const center = add3(camera.position, mul3(basis.forward, depth))
  return [
    add3(add3(center, mul3(basis.right, -halfW)), mul3(basis.down, -halfH)),
    add3(add3(center, mul3(basis.right, halfW)), mul3(basis.down, -halfH)),
    add3(add3(center, mul3(basis.right, halfW)), mul3(basis.down, halfH)),
    add3(add3(center, mul3(basis.right, -halfW)), mul3(basis.down, halfH)),
  ]
}
