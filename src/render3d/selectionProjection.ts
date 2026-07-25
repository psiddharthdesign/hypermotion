// SPDX-License-Identifier: Apache-2.0

import {
  add3,
  cross3,
  dot3,
  mul3,
  norm3,
  sub3,
  type Vec3,
} from '@/render3d/math'
import {
  projectWorldPoint,
  viewportPointToRay,
  type Plane3D,
  type ResolvedCamera3D,
  type ViewportSize,
} from '@/render3d/scene3d'

export interface ProjectedPoint2D {
  x: number
  y: number
}

/** Local corner order is stable so an SVG polygon never crosses itself. */
export type PlaneQuad<T> = readonly [T, T, T, T]

export interface ProjectedQuadBounds {
  x: number
  y: number
  width: number
  height: number
}

export type ProjectedResizeHandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'

export interface ProjectedResizeHandle {
  id: ProjectedResizeHandleId
  point: ProjectedPoint2D
  cursor: string
}

export interface WorkspaceProjection {
  canvas: ViewportSize
  workspace: ViewportSize
  view: {
    zoom: number
    panX: number
    panY: number
  }
}

/** Map one authored motion-path XYZ point through its parent translation basis. */
export function motionPathLocalPointToWorld(
  point: Vec3,
  plane: Plane3D,
): Vec3 {
  return add3(
    plane.motionPathOrigin,
    add3(
      add3(
        mul3(plane.motionPathBasisX, point.x),
        mul3(plane.motionPathBasisY, point.y),
      ),
      mul3(plane.motionPathBasisZ, point.z),
    ),
  )
}

/** Project one authored motion-path XYZ point through the active camera. */
export function projectMotionPathPoint(
  point: Vec3,
  plane: Plane3D,
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
): ProjectedPoint2D {
  return projectWorldPoint(
    motionPathLocalPointToWorld(point, plane),
    camera,
    viewport,
  )
}

/**
 * Intersect a viewport pointer with one fixed-Z slice of a motion path.
 *
 * Path coordinates live in the node's incoming parent basis, which can be
 * skewed by nested rotations and non-uniform scales. Solving the 2×2 Gram
 * system recovers local X/Y without assuming those basis vectors are unit or
 * perpendicular.
 */
export function viewportPointToMotionPathLocal(
  point: ProjectedPoint2D,
  fixedZ: number,
  plane: Plane3D,
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
): Vec3 | null {
  const basisX = plane.motionPathBasisX
  const basisY = plane.motionPathBasisY
  const normal = norm3(cross3(basisX, basisY))
  if (dot3(normal, normal) < 0.5) return null

  const sliceOrigin = motionPathLocalPointToWorld(
    { x: 0, y: 0, z: fixedZ },
    plane,
  )
  const ray = viewportPointToRay(camera, point.x, point.y, viewport)
  const denominator = dot3(ray.direction, normal)
  if (Math.abs(denominator) < 0.0001) return null
  const distance =
    dot3(sub3(sliceOrigin, ray.origin), normal) / denominator
  if (distance <= 0) return null

  const worldPoint = add3(ray.origin, mul3(ray.direction, distance))
  const relative = sub3(worldPoint, sliceOrigin)
  const xx = dot3(basisX, basisX)
  const xy = dot3(basisX, basisY)
  const yy = dot3(basisY, basisY)
  const determinant = xx * yy - xy * xy
  if (
    Math.abs(determinant) <=
    1e-12 * Math.max(1, Math.abs(xx * yy))
  ) {
    return null
  }
  const projectedX = dot3(relative, basisX)
  const projectedY = dot3(relative, basisY)
  return {
    x: (projectedX * yy - projectedY * xy) / determinant,
    y: (projectedY * xx - projectedX * xy) / determinant,
    z: fixedZ,
  }
}

/**
 * Resolve local motion-path depth from the closest points between the camera
 * ray and the path's fixed-X/Y world line.
 *
 * The inherited Z basis may be scaled or skewed, so its magnitude remains in
 * the line solve. Nearly parallel lines are intentionally rejected because
 * their depth is undefined or too unstable for an editor drag.
 */
export function viewportPointToMotionPathDepth(
  point: ProjectedPoint2D,
  fixedX: number,
  fixedY: number,
  plane: Plane3D,
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
): Vec3 | null {
  const ray = viewportPointToRay(camera, point.x, point.y, viewport)
  const depthOrigin = motionPathLocalPointToWorld(
    { x: fixedX, y: fixedY, z: 0 },
    plane,
  )
  const depthBasis = plane.motionPathBasisZ
  const rayLengthSquared = dot3(ray.direction, ray.direction)
  const depthLengthSquared = dot3(depthBasis, depthBasis)
  if (
    !Number.isFinite(rayLengthSquared) ||
    !Number.isFinite(depthLengthSquared) ||
    rayLengthSquared <= 1e-12 ||
    depthLengthSquared <= 1e-12
  ) {
    return null
  }

  const rayDepth = dot3(ray.direction, depthBasis)
  const determinant =
    rayLengthSquared * depthLengthSquared - rayDepth * rayDepth
  if (
    !Number.isFinite(determinant) ||
    determinant <= 1e-8 * rayLengthSquared * depthLengthSquared
  ) {
    return null
  }

  const originDelta = sub3(ray.origin, depthOrigin)
  const rayOrigin = dot3(ray.direction, originDelta)
  const depthOriginProjection = dot3(depthBasis, originDelta)
  const rayDistance =
    (rayDepth * depthOriginProjection -
      depthLengthSquared * rayOrigin) /
    determinant
  const z =
    (rayLengthSquared * depthOriginProjection -
      rayDepth * rayOrigin) /
    determinant
  if (
    !Number.isFinite(rayDistance) ||
    !Number.isFinite(z) ||
    rayDistance <= 0
  ) {
    return null
  }

  return { x: fixedX, y: fixedY, z }
}

/**
 * Resolve the exact world-space corners used by a WebGL plane.
 *
 * `Plane3D.center`, `right`, `down`, and scale already contain the node's
 * complete inherited transform. Reusing them keeps selection chrome on the
 * same geometry as painting and hit testing instead of rebuilding an
 * approximate CSS camera transform from scene nodes.
 */
export function planeWorldQuad(plane: Plane3D): PlaneQuad<Vec3> {
  // The normalized basis already carries a mirrored axis' direction. Using
  // the signed scale a second time would cancel that mirror and swap the
  // projected handle labels, so the magnitude belongs here.
  const halfWidth = (plane.rect.width * Math.abs(plane.scaleX)) / 2
  const halfHeight = (plane.rect.height * Math.abs(plane.scaleY)) / 2
  const horizontal = mul3(plane.right, halfWidth)
  const vertical = mul3(plane.down, halfHeight)

  const topLeft = add3(
    add3(plane.center, mul3(horizontal, -1)),
    mul3(vertical, -1),
  )
  const topRight = add3(add3(plane.center, horizontal), mul3(vertical, -1))
  const bottomRight = add3(add3(plane.center, horizontal), vertical)
  const bottomLeft = add3(
    add3(plane.center, mul3(horizontal, -1)),
    vertical,
  )
  return [topLeft, topRight, bottomRight, bottomLeft]
}

/**
 * Intersect one viewport pointer with the selected rendered plane and return
 * its authored local coordinates. Resize gestures use this instead of
 * dividing screen deltas by zoom, which is invalid after camera tilt/dolly.
 */
export function viewportPointToPlaneLocal(
  point: ProjectedPoint2D,
  plane: Plane3D,
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
): ProjectedPoint2D | null {
  const ray = viewportPointToRay(camera, point.x, point.y, viewport)
  const denominator = dot3(ray.direction, plane.normal)
  if (Math.abs(denominator) < 0.0001) return null
  const distance = dot3(sub3(plane.center, ray.origin), plane.normal) / denominator
  if (distance <= 0) return null
  const worldPoint = add3(ray.origin, mul3(ray.direction, distance))
  const relative = sub3(worldPoint, plane.center)
  return {
    x:
      dot3(relative, plane.right) /
        Math.max(0.0001, Math.abs(plane.scaleX)) +
      plane.rect.width / 2,
    y:
      dot3(relative, plane.down) /
        Math.max(0.0001, Math.abs(plane.scaleY)) +
      plane.rect.height / 2,
  }
}

/** Project a rendered plane to the active camera's canvas viewport. */
export function projectPlaneQuad(
  plane: Plane3D,
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
): PlaneQuad<ProjectedPoint2D> {
  const [topLeft, topRight, bottomRight, bottomLeft] = planeWorldQuad(plane)
  return [
    projectWorldPoint(topLeft, camera, viewport),
    projectWorldPoint(topRight, camera, viewport),
    projectWorldPoint(bottomRight, camera, viewport),
    projectWorldPoint(bottomLeft, camera, viewport),
  ]
}

export function projectedQuadBounds(
  quad: PlaneQuad<ProjectedPoint2D>,
): ProjectedQuadBounds {
  const xs = quad.map((point) => point.x)
  const ys = quad.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Map canvas-relative projected corners into workspace-relative pixels.
 *
 * Canvas selection overlays normally live inside the workspace transform and
 * therefore do not need this conversion. It is useful for screen-fixed
 * handles and tests: workspace zoom must scale the projected quad exactly
 * once, while pan only translates it.
 */
export function canvasQuadToWorkspace(
  quad: PlaneQuad<ProjectedPoint2D>,
  projection: WorkspaceProjection,
): PlaneQuad<ProjectedPoint2D> {
  const { canvas, workspace, view } = projection
  const zoom = Math.max(0.001, view.zoom)
  const mapPoint = (point: ProjectedPoint2D): ProjectedPoint2D => ({
    x:
      workspace.width / 2 +
      view.panX +
      (point.x - canvas.width / 2) * zoom,
    y:
      workspace.height / 2 +
      view.panY +
      (point.y - canvas.height / 2) * zoom,
  })
  return [mapPoint(quad[0]), mapPoint(quad[1]), mapPoint(quad[2]), mapPoint(quad[3])]
}

/** Resolve all eight handle anchors and rotate their cursors with the quad. */
export function projectedResizeHandles(
  quad: PlaneQuad<ProjectedPoint2D>,
): ProjectedResizeHandle[] {
  const [nw, ne, se, sw] = quad
  const midpoint = (
    a: ProjectedPoint2D,
    b: ProjectedPoint2D,
  ): ProjectedPoint2D => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const positions: Record<ProjectedResizeHandleId, ProjectedPoint2D> = {
    nw,
    n: midpoint(nw, ne),
    ne,
    e: midpoint(ne, se),
    se,
    s: midpoint(sw, se),
    sw,
    w: midpoint(nw, sw),
  }
  const opposite: Record<ProjectedResizeHandleId, ProjectedResizeHandleId> = {
    nw: 'se',
    n: 's',
    ne: 'sw',
    e: 'w',
    se: 'nw',
    s: 'n',
    sw: 'ne',
    w: 'e',
  }
  return (Object.keys(positions) as ProjectedResizeHandleId[]).map((id) => {
    const point = positions[id]
    const across = positions[opposite[id]]
    return {
      id,
      point,
      cursor: resizeCursorForDirection(point.x - across.x, point.y - across.y),
    }
  })
}

function resizeCursorForDirection(dx: number, dy: number): string {
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180
  if (angle < 22.5 || angle >= 157.5) return 'ew-resize'
  if (angle < 67.5) return 'nwse-resize'
  if (angle < 112.5) return 'ns-resize'
  return 'nesw-resize'
}
