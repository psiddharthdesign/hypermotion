// SPDX-License-Identifier: Apache-2.0

import { Matrix3, Matrix4, Vector3 } from 'three'
import type { AnimatedValue } from '@/anim'
import { recordKeyframesForPatch, stampToActiveTracksForPatch } from '@/anim/recordKeyframes'
import { evaluateLayerMotionPath } from '@/anim/layerMotionPath'
import type { SceneAPI } from '@/scene'
import { normalizeExtrusionDepth } from '@/scene/extrusion'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { extrusionOutline } from '@/render3d/extrusionGeometry'
import { extrusionShapeForPlane, extrusionWorldMatrix } from '@/render3d/extrusionScene'
import { cameraBasis, cameraSpaceDepth, projectWorldPoint, viewportPointToRay, type Plane3D, type ResolvedCamera3D, type ViewportSize } from '@/render3d/scene3d'
import { rotateEuler, type Vec3 } from '@/render3d/math'

export type SolidFaceAxis = 'width' | 'height' | 'diameter' | 'depth'
export interface SolidEditableFace {
  id: string
  axis: SolidFaceAxis
  normal: Vec3
  localCenter: Vec3
  worldCenter: Vec3
  /** World vector for one authored pixel of outward movement. */
  worldAxis: Vec3
  points: { x: number; y: number }[]
  cameraDepth: number
}
export interface SolidFaceEdit {
  size?: { width?: number; height?: number }
  depth?: number
  /** Translation in the incoming parent basis, separate from a motion path. */
  translationDelta: Vec3
}

const vector = (v: Vec3) => new Vector3(v.x, v.y, v.z)
const plain = (v: Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z })

/** Actual front/back/wall polygons, projected through the editor's active camera. */
export function solidEditableFaces(plane: Plane3D, camera: ResolvedCamera3D, viewport: ViewportSize): SolidEditableFace[] {
  const shape = extrusionShapeForPlane(plane)
  if (!shape || plane.opacity <= 0) return []
  const outline = extrusionOutline(shape)
  if (outline.length < 3) return []
  const matrix = new Matrix4().fromArray(extrusionWorldMatrix(plane))
  const normals = new Matrix3().getNormalMatrix(matrix)
  const faces: SolidEditableFace[] = []
  const addFace = (id: string, normal: Vec3, localPoints: Vec3[], axis: SolidFaceAxis) => {
    const localCenter = localPoints.reduce<Vector3>((sum, p) => sum.add(vector(p)), new Vector3()).multiplyScalar(1 / localPoints.length)
    const worldCenter = localCenter.clone().applyMatrix4(matrix)
    const worldNormal = vector(normal).applyMatrix3(normals).normalize()
    const viewDirection = camera.projection === 'orthographic'
      ? vector(cameraBasis(camera).forward)
      : worldCenter.clone().sub(vector(camera.position)).normalize()
    if (worldNormal.dot(viewDirection) >= -1e-7) return
    const worldPoints = localPoints.map(p => vector(p).applyMatrix4(matrix))
    if (worldPoints.some(p => cameraSpaceDepth(p, camera) <= camera.nearClip)) return
    // Rounded box corners choose the closest straight dimension. Ellipses
    // retain their radial normal so a side pull scales both diameters.
    const editNormal = axis === 'width' ? { x: Math.sign(normal.x), y: 0, z: 0 }
      : axis === 'height' ? { x: 0, y: Math.sign(normal.y), z: 0 } : normal
    const worldAxis = vector(editNormal).applyMatrix3(new Matrix3().setFromMatrix4(matrix))
    faces.push({ id, axis, normal: editNormal, localCenter: plain(localCenter), worldCenter: plain(worldCenter), worldAxis: plain(worldAxis),
      points: worldPoints.map(p => projectWorldPoint(p, camera, viewport)), cameraDepth: cameraSpaceDepth(worldCenter, camera) })
  }
  addFace('front', { x: 0, y: 0, z: -1 }, outline.map(p => ({ ...p, z: 0 })), 'depth')
  addFace('back', { x: 0, y: 0, z: 1 }, outline.map(p => ({ ...p, z: shape.depth })), 'depth')
  if (shape.depth > 0) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!
      const b = outline[(i + 1) % outline.length]!
      const edge = Math.hypot(b.x - a.x, b.y - a.y)
      if (edge < 1e-8) continue
      const normal = { x: (b.y - a.y) / edge, y: (a.x - b.x) / edge, z: 0 }
      addFace(`side-${i}`, normal, [{ ...a, z: 0 }, { ...b, z: 0 }, { ...b, z: shape.depth }, { ...a, z: shape.depth }],
        shape.kind === 'ellipse' ? 'diameter' : Math.abs(normal.x) >= Math.abs(normal.y) ? 'width' : 'height')
    }
  }
  return faces.sort((a, b) => b.cameraDepth - a.cameraDepth)
}

/** Adjacent rounded wall facets edit the same dimension as their adjoining flat side. */
export function solidFaceHighlightKey(face: Pick<SolidEditableFace, 'id' | 'axis' | 'normal'>): string {
  if (face.axis === 'depth') return face.id
  if (face.axis === 'diameter') return 'diameter'
  return `${face.axis}:${face.axis === 'width' ? Math.sign(face.normal.x) : Math.sign(face.normal.y)}`
}

export interface SolidEditableOutlineEdge {
  kind: 'rim' | 'vertical'
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/**
 * Editor contours describe the solid rather than its tessellation. Smooth
 * corners contribute cap rims and their two silhouettes, never every seam
 * between tiny wall polygons. True square corners retain their hard edge.
 */
export function solidEditableOutline(plane: Plane3D, camera: ResolvedCamera3D, viewport: ViewportSize): SolidEditableOutlineEdge[] {
  const shape = extrusionShapeForPlane(plane)
  if (!shape || plane.opacity <= 0) return []
  const outline = extrusionOutline(shape)
  if (outline.length < 3) return []
  const visibleFaces = new Set(solidEditableFaces(plane, camera, viewport).map(face => face.id))
  const matrix = new Matrix4().fromArray(extrusionWorldMatrix(plane))
  const result: SolidEditableOutlineEdge[] = []
  const add = (kind: SolidEditableOutlineEdge['kind'], a: Vec3, b: Vec3) => {
    const from = vector(a).applyMatrix4(matrix)
    const to = vector(b).applyMatrix4(matrix)
    if (cameraSpaceDepth(from, camera) <= camera.nearClip || cameraSpaceDepth(to, camera) <= camera.nearClip) return
    result.push({ kind, from: projectWorldPoint(from, camera, viewport), to: projectWorldPoint(to, camera, viewport) })
  }
  const edgeNormals = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    return { x: (b.y - a.y) / length, y: (a.x - b.x) / length }
  })
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    const sideVisible = visibleFaces.has(`side-${i}`)
    if (visibleFaces.has('front') || sideVisible) add('rim', { ...a, z: 0 }, { ...b, z: 0 })
    if (shape.depth <= 0) {
      if (!visibleFaces.has('front') && visibleFaces.has('back')) add('rim', { ...a, z: 0 }, { ...b, z: 0 })
      continue
    }
    if (visibleFaces.has('back') || sideVisible) add('rim', { ...a, z: shape.depth }, { ...b, z: shape.depth })
    const previous = (i + outline.length - 1) % outline.length
    const previousVisible = visibleFaces.has(`side-${previous}`)
    const dot = edgeNormals[i]!.x * edgeNormals[previous]!.x + edgeNormals[i]!.y * edgeNormals[previous]!.y
    const sharp = dot < Math.cos(Math.PI / 6)
    const silhouette = sideVisible !== previousVisible
    if (silhouette || (sharp && (sideVisible || previousVisible))) add('vertical', { ...a, z: 0 }, { ...a, z: shape.depth })
  }
  return result
}

/** Ray/axis closest point gives stable dragging for rotated orthographic and perspective views. */
export function solidFaceDragDelta(start: { x: number; y: number }, current: { x: number; y: number }, face: Pick<SolidEditableFace, 'worldCenter' | 'worldAxis'>,
  camera: ResolvedCamera3D, viewport: ViewportSize, shift = false): number {
  const axis = vector(face.worldAxis)
  const lengthSquared = axis.lengthSq()
  if (lengthSquared < 1e-12) return 0
  const parameter = (point: { x: number; y: number }) => {
    const ray = viewportPointToRay(camera, point.x, point.y, viewport)
    const direction = vector(ray.direction)
    const relative = vector(ray.origin).sub(vector(face.worldCenter))
    const aa = lengthSquared
    const bb = direction.lengthSq()
    const ab = axis.dot(direction)
    const denominator = aa * bb - ab * ab
    if (denominator <= 1e-5 * aa * bb) return null
    return (bb * axis.dot(relative) - ab * direction.dot(relative)) / denominator
  }
  const from = parameter(start)
  const to = parameter(current)
  let delta: number
  if (from === null || to === null) {
    // An axis aimed straight at the lens has no screen projection. Up/down
    // scrubbing is an intentional fallback, in screen-pixel-sized scene units.
    const projectionScale = camera.projection === 'orthographic' ? camera.zoomY
      : camera.focalLength / Math.max(camera.nearClip, cameraSpaceDepth(face.worldCenter, camera))
    delta = (start.y - current.y) / Math.max(1e-6, projectionScale * Math.sqrt(lengthSquared))
  } else delta = to - from
  return Number.isFinite(delta) ? delta * (shift ? 10 : 1) : 0
}

function parentBasis(plane: Plane3D): Matrix3 {
  return new Matrix3().set(
    plane.motionPathBasisX.x, plane.motionPathBasisY.x, plane.motionPathBasisZ.x,
    plane.motionPathBasisX.y, plane.motionPathBasisY.y, plane.motionPathBasisZ.y,
    plane.motionPathBasisX.z, plane.motionPathBasisY.z, plane.motionPathBasisZ.z,
  )
}

function sizeCenterOffset(plane: Plane3D, width: number, height: number, animated?: AnimatedValue): Vector3 {
  const ax = plane.anchor.x / plane.rect.width
  const ay = plane.anchor.y / plane.rect.height
  const dw = width - plane.rect.width
  const dh = height - plane.rect.height
  const naturalLocal = rotateEuler({ x: (0.5 - ax) * dw * (animated?.scaleX ?? plane.node.transform.scaleX), y: (0.5 - ay) * dh * (animated?.scaleY ?? plane.node.transform.scaleY), z: 0 },
    animated?.rotationX ?? plane.node.transform.rotationX, animated?.rotationY ?? plane.node.transform.rotationY, animated?.rotation ?? plane.node.transform.rotation)
  return vector(naturalLocal).applyMatrix3(parentBasis(plane))
    .addScaledVector(vector(plane.motionPathBasisX), ax * dw)
    .addScaledVector(vector(plane.motionPathBasisY), ay * dh)
}

/** Snap the edited dimension without moving the opposite face off its anchor. */
export function snapSolidFaceDelta(plane: Plane3D, face: Pick<SolidEditableFace, 'axis' | 'normal'>, outwardDelta: number, spacing: number): number {
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(outwardDelta)) return outwardDelta
  const initial = face.axis === 'depth' ? plane.extrusion?.depth ?? 0
    : face.axis === 'width' ? plane.rect.width : face.axis === 'height' ? plane.rect.height
      : Math.hypot(face.normal.x * plane.rect.width, face.normal.y * plane.rect.height)
  return Math.round((initial + outwardDelta) / spacing) * spacing - initial
}

/** Recover the actual scalar movement after a dimension hits its min/max. */
export function solidFaceEffectiveDelta(plane: Plane3D, face: Pick<SolidEditableFace, 'axis' | 'normal'>, edit: SolidFaceEdit): number {
  if (face.axis === 'depth') return (edit.depth ?? plane.extrusion?.depth ?? 0) - (plane.extrusion?.depth ?? 0)
  if (face.axis === 'width') return (edit.size?.width ?? plane.rect.width) - plane.rect.width
  if (face.axis === 'height') return (edit.size?.height ?? plane.rect.height) - plane.rect.height
  return Math.hypot(face.normal.x * (edit.size?.width ?? plane.rect.width), face.normal.y * (edit.size?.height ?? plane.rect.height))
    - Math.hypot(face.normal.x * plane.rect.width, face.normal.y * plane.rect.height)
}

/** Predict precisely the prism that the renderer will show after a face edit. */
export function solidFacePreviewPlane(plane: Plane3D, edit: SolidFaceEdit, animated?: AnimatedValue): Plane3D {
  const width = edit.size?.width ?? plane.rect.width
  const height = edit.size?.height ?? plane.rect.height
  const center = vector(plane.center).add(sizeCenterOffset(plane, width, height, animated))
    .add(vector(edit.translationDelta).applyMatrix3(parentBasis(plane)))
  return {
    ...plane,
    rect: { ...plane.rect, width, height },
    center: plain(center),
    anchor: { ...plane.anchor, x: plane.anchor.x * width / plane.rect.width, y: plane.anchor.y * height / plane.rect.height },
    extrusion: plane.extrusion ? { ...plane.extrusion, depth: edit.depth ?? plane.extrusion.depth } : undefined,
    extrusionCornerRadius: (animated?.fullRadius ?? (plane.node.appearance.fullRadius ? 1 : 0)) >= 0.5
      ? Math.min(width, height) / 2 : plane.extrusionCornerRadius,
  }
}

/** Resize around the opposite face, compensating for the layer's rotating anchor. */
export function solidFaceEdit(plane: Plane3D, face: Pick<SolidEditableFace, 'axis' | 'normal'>, outwardDelta: number, animated?: AnimatedValue): SolidFaceEdit | null {
  const shape = extrusionShapeForPlane(plane)
  if (!shape || !Number.isFinite(outwardDelta)) return null
  const matrix = new Matrix4().fromArray(extrusionWorldMatrix(plane))
  const linear = new Matrix3().setFromMatrix4(matrix)
  const parent = parentBasis(plane)
  if (Math.abs(parent.determinant()) < 1e-12) return null
  let width = shape.width
  let height = shape.height
  const desiredCenter = new Vector3()
  let depth: number | undefined
  if (face.axis === 'depth') {
    depth = normalizeExtrusionDepth(shape.depth + outwardDelta)
    // The front is the layer's Z=0, so pulling it moves the layer while the
    // back stays planted. Pulling the back changes depth without translation.
    if (face.normal.z < 0) desiredCenter.set(0, 0, shape.depth - depth).applyMatrix3(linear)
  } else {
    if (face.axis === 'width') {
      width = Math.max(1, Math.min(100000, shape.width + outwardDelta))
      desiredCenter.set(face.normal.x * (width - shape.width) / 2, 0, 0)
    } else if (face.axis === 'height') {
      height = Math.max(1, Math.min(100000, shape.height + outwardDelta))
      desiredCenter.set(0, face.normal.y * (height - shape.height) / 2, 0)
    } else {
      const diameter = Math.hypot(face.normal.x * shape.width, face.normal.y * shape.height)
      const ratio = Math.max(1 / Math.min(shape.width, shape.height), Math.min(100000 / Math.max(shape.width, shape.height), 1 + outwardDelta / Math.max(1, diameter)))
      width *= ratio
      height *= ratio
      desiredCenter.set(face.normal.x, face.normal.y, 0).multiplyScalar(diameter * (ratio - 1) / 2)
    }
    desiredCenter.applyMatrix3(linear)
    // Changing dimensions also changes the layer's anchor in solved layout.
    // Subtract that automatic movement before applying our desired half-delta.
    desiredCenter.sub(sizeCenterOffset(plane, width, height, animated))
  }
  const translationDelta = plain(desiredCenter.applyMatrix3(parent.invert()))
  const size = face.axis === 'width' ? { width } : face.axis === 'height' ? { height } : { width, height }
  return { ...(depth === undefined ? { size } : { depth }), translationDelta }
}

/** Final static values and Auto Key/current tracks form one undoable action. */
export function commitSolidFaceEdit(api: SceneAPI, nodeId: string, edit: SolidFaceEdit, time: number, recording: boolean, animated?: AnimatedValue): void {
  const node = api.getNode(nodeId)
  if (!node || node.locked || !node.extrusion || (node.kind !== 'rect' && node.kind !== 'ellipse')) return
  const path = node.motionPath && animated?.motionPathProgress !== undefined
    ? evaluateLayerMotionPath(node.motionPath, animated.motionPathProgress) : { x: 0, y: 0, z: 0 }
  const stamp = recording ? recordKeyframesForPatch : stampToActiveTracksForPatch
  api.doc.transact(() => {
    if (edit.size) {
      api.setNodeProperty(nodeId, 'size', { ...node.size, ...edit.size })
      stamp(api, nodeId, time, 'size', edit.size)
    }
    if (edit.depth !== undefined) {
      const patch = { depth: normalizeExtrusionDepth(edit.depth) }
      api.setNodeProperty(nodeId, 'extrusion', { ...node.extrusion!, ...patch })
      stamp(api, nodeId, time, 'extrusion', patch)
    }
    const staticPatch: Partial<Vec3> = {}
    const authorPatch: Partial<Vec3> = {}
    for (const axis of ['x', 'y', 'z'] as const) {
      if (Math.abs(edit.translationDelta[axis]) < 1e-9) continue
      staticPatch[axis] = node.transform[axis] + edit.translationDelta[axis]
      authorPatch[axis] = (animated?.[axis] ?? node.transform[axis]) - path[axis] + edit.translationDelta[axis]
    }
    if (Object.keys(staticPatch).length) {
      api.setNodeProperty(nodeId, 'transform', { ...node.transform, ...staticPatch })
      stamp(api, nodeId, time, 'transform', authorPatch)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
}
