// SPDX-License-Identifier: Apache-2.0

import { cameraSpaceDepth, projectWorldPoint, type Plane3D, type ResolvedCamera3D } from './scene3d'
import { add3, mul3 } from './math'

type PaddingPlane = Pick<Plane3D, 'rect' | 'textureRect' | 'center' | 'textureCenter' | 'right' | 'down' | 'scaleX' | 'scaleY'>

/**
 * Transparent source pixels are part of the aperture convolution. Without a
 * gutter a filled card's mipmaps stay opaque up to the map edge, every tap is
 * cut off in a discrete alpha step, and the mesh clips the outside blur halo.
 * Convert the lens' screen-pixel support into authored plane units, including
 * perspective, tilt and non-uniform scale. Buckets avoid repaints on tiny
 * camera changes; the cap bounds nearly edge-on/zero-scale planes.
 */
export function depthOfFieldTexturePadding(
  plane: PaddingPlane,
  camera: ResolvedCamera3D,
  maximumBlur: number,
): { x: number; y: number } {
  if (!camera.depthOfField || !Number.isFinite(maximumBlur) || maximumBlur <= 0.05) {
    return { x: 0, y: 0 }
  }
  const center = plane.textureCenter ?? plane.center
  const rect = plane.textureRect ?? plane.rect
  const right = mul3(plane.right, Math.abs(plane.scaleX))
  const down = mul3(plane.down, Math.abs(plane.scaleY))
  const viewport = { width: 1, height: 1 }
  const origin = projectWorldPoint(center, camera, viewport)
  const alongX = projectWorldPoint(add3(center, right), camera, viewport)
  const alongY = projectWorldPoint(add3(center, down), camera, viewport)
  const xx = alongX.x - origin.x
  const xy = alongX.y - origin.y
  const yx = alongY.x - origin.x
  const yy = alongY.y - origin.y
  const determinant = Math.abs(xx * yy - yx * xy)
  const depth = Math.max(camera.nearClip, cameraSpaceDepth(center, camera))
  const depthSpan =
    Math.abs(cameraSpaceDepth(add3(center, right), camera) - depth) * rect.width / 2 +
    Math.abs(cameraSpaceDepth(add3(center, down), camera) - depth) * rect.height / 2
  const perspectiveMargin = Math.pow(1 + depthSpan / depth, 2)
  const ratio = Math.max(0.25, Math.min(4, camera.bokehRatio))
  const apertureStretch = Math.max(Math.sqrt(ratio), 1 / Math.sqrt(ratio))
  // Include the sparse-kernel mip prefilter as well as the aperture radius.
  const support = (maximumBlur * apertureStretch * 2 + 2) * perspectiveMargin
  const bucket = (value: number) => Math.min(1024, Math.ceil(Math.max(0, value) / 16) * 16)
  return {
    x: bucket(support * Math.hypot(yx, yy) / Math.max(0.000001, determinant)),
    y: bucket(support * Math.hypot(xx, xy) / Math.max(0.000001, determinant)),
  }
}
