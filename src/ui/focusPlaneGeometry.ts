// SPDX-License-Identifier: Apache-2.0

import {
  cameraBasis,
  cameraSpaceDepth,
  focusPlaneCorners,
  projectWorldPoint,
  viewportPointToRay,
  type ResolvedCamera3D,
  type ViewportSize,
} from '@/render3d/scene3d'
import { add3, dot3, mul3, sub3, type Vec3 } from '@/render3d/math'

type ScreenPoint = { x: number; y: number }

export interface FocusPlaneGuideGeometry {
  center: ScreenPoint
  /** Near/far-clipped polygon; a tilted plane may produce more than four corners. */
  corners: ScreenPoint[]
  worldCenter: Vec3
}

/** Clip before projecting so guides crossing the camera never explode in size. */
function clipAtDepth(
  polygon: Vec3[],
  camera: ResolvedCamera3D,
  limit: number,
  keepBeyond: boolean,
): Vec3[] {
  const result: Vec3[] = []
  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i]
    const end = polygon[(i + 1) % polygon.length]
    const startDepth = cameraSpaceDepth(start, camera)
    const endDepth = cameraSpaceDepth(end, camera)
    const startInside = keepBeyond ? startDepth >= limit : startDepth <= limit
    const endInside = keepBeyond ? endDepth >= limit : endDepth <= limit
    if (startInside) result.push(start)
    if (startInside !== endInside) {
      const amount = (limit - startDepth) / (endDepth - startDepth)
      result.push(add3(start, mul3(sub3(end, start), amount)))
    }
  }
  return result
}

/** The editable guide uses the same world plane as the depth-of-field renderer. */
export function focusPlaneGuideGeometry(
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
): FocusPlaneGuideGeometry | null {
  const centerDepth = cameraSpaceDepth(camera.focusWorld, camera)
  if (!Number.isFinite(centerDepth) || centerDepth < camera.nearClip || centerDepth > camera.farClip) {
    return null
  }
  const worldCorners = focusPlaneCorners(camera, viewport)
  const clipped = clipAtDepth(
    clipAtDepth(worldCorners, camera, camera.nearClip, true),
    camera,
    camera.farClip,
    false,
  )
  if (clipped.length < 3) return null
  return {
    center: projectWorldPoint(camera.focusWorld, camera, viewport),
    corners: clipped.map((point) => projectWorldPoint(point, camera, viewport)),
    worldCenter: { ...camera.focusWorld },
  }
}

function pointAtDepth(
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
  point: ScreenPoint,
  depth: number,
): Vec3 {
  const ray = viewportPointToRay(camera, point.x, point.y, viewport)
  const { forward } = cameraBasis(camera)
  return add3(ray.origin, mul3(ray.direction, depth / dot3(ray.direction, forward)))
}

/** Drag in composition pixels. The camera-space depth stays fixed, including camera rotation and roll. */
export function moveFocusPlaneInView(
  camera: ResolvedCamera3D,
  viewport: ViewportSize,
  startWorld: Vec3,
  deltaScreen: ScreenPoint,
): Vec3 {
  const depth = cameraSpaceDepth(startWorld, camera)
  if (depth < camera.nearClip || !Number.isFinite(depth)) return { ...startWorld }
  const startScreen = projectWorldPoint(startWorld, camera, viewport)
  return pointAtDepth(camera, viewport, {
    x: startScreen.x + deltaScreen.x,
    y: startScreen.y + deltaScreen.y,
  }, depth)
}

/** Drag upward to move the plane away from the camera, with projection-scaled sensitivity. */
export function moveFocusPlaneDepth(
  camera: ResolvedCamera3D,
  _viewport: ViewportSize,
  startWorld: Vec3,
  deltaScreenY: number,
): Vec3 {
  const depth = cameraSpaceDepth(startWorld, camera)
  if (!Number.isFinite(depth)) return { ...startWorld }
  const unitsPerPixel = camera.projection === 'orthographic'
    ? 1 / Math.max(0.000001, camera.zoomY)
    : Math.max(camera.nearClip, depth) / camera.focalLength
  return setFocusPlaneDepth(camera, startWorld, depth - deltaScreenY * unitsPerPixel)
}

/** Set the plane centre's depth along the camera view, preserving its lateral position and tilt. */
export function setFocusPlaneDepth(
  camera: ResolvedCamera3D,
  startWorld: Vec3,
  distance: number,
): Vec3 {
  const depth = cameraSpaceDepth(startWorld, camera)
  if (!Number.isFinite(depth) || !Number.isFinite(distance)) return { ...startWorld }
  const nextDepth = Math.max(camera.nearClip, distance)
  const { forward } = cameraBasis(camera)
  return add3(startWorld, mul3(forward, nextDepth - depth))
}
