// SPDX-License-Identifier: Apache-2.0
import type { PlaneClip3D } from './scene3d'
import { add3, cross3, dot3, mul3, norm3, sub3, type Vec3 } from './math'

/** Inward half-spaces, shared by the renderer and pointer hit testing. */
export function clipBoundaries(clip: PlaneClip3D): Array<{ normal: Vec3; point: Vec3 }> {
  if (clip.width <= 1e-6 || clip.height <= 1e-6 || dot3(cross3(clip.right, clip.down), cross3(clip.right, clip.down)) < 1e-12) return [
    { normal: { x: 1, y: 0, z: 0 }, point: add3(clip.center, { x: 1, y: 0, z: 0 }) },
    { normal: { x: -1, y: 0, z: 0 }, point: sub3(clip.center, { x: 1, y: 0, z: 0 }) },
  ]
  if (!clip.outline) return [
    { normal: clip.right, point: add3(clip.center, mul3(clip.right, -clip.width / 2)) },
    { normal: mul3(clip.right, -1), point: add3(clip.center, mul3(clip.right, clip.width / 2)) },
    { normal: clip.down, point: add3(clip.center, mul3(clip.down, -clip.height / 2)) },
    { normal: mul3(clip.down, -1), point: add3(clip.center, mul3(clip.down, clip.height / 2)) },
  ]
  const normal = cross3(clip.right, clip.down)
  return clip.outline.flatMap((point, index, points) => {
    const edge = sub3(points[(index + 1) % points.length]!, point)
    if (dot3(edge, edge) < 1e-12) return []
    let inward = norm3(cross3(normal, edge))
    if (dot3(inward, sub3(clip.center, point)) < 0) inward = mul3(inward, -1)
    return [{ normal: inward, point }]
  })
}

export function clipContainsPoint(clip: PlaneClip3D, point: Vec3): boolean {
  return clipBoundaries(clip).every((edge) => dot3(edge.normal, sub3(point, edge.point)) >= -1e-6)
}
