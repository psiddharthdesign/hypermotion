// SPDX-License-Identifier: Apache-2.0

import type { Transform } from '@/scene'

export interface PivotAnchor {
  anchorX: number
  anchorY: number
  anchorZ: number
}

type PivotTransformPatch = Pick<
  Transform,
  'x' | 'y' | 'z' | 'anchorX' | 'anchorY' | 'anchorZ'
>

const radians = (degrees: number) => (degrees * Math.PI) / 180

function rotateEuler(
  point: { x: number; y: number; z: number },
  rotationX: number,
  rotationY: number,
  rotationZ: number,
) {
  const rx = radians(rotationX)
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const afterX = {
    x: point.x,
    y: point.y * cx - point.z * sx,
    z: point.y * sx + point.z * cx,
  }
  const ry = radians(rotationY)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const afterY = {
    x: afterX.x * cy + afterX.z * sy,
    y: afterX.y,
    z: -afterX.x * sy + afterX.z * cy,
  }
  const rz = radians(rotationZ)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  return {
    x: afterY.x * cz - afterY.y * sz,
    y: afterY.x * sz + afterY.y * cz,
    z: afterY.z,
  }
}

/**
 * Change a transform origin without moving the rendered layer.
 *
 * A transform around origin O contributes `O + A(point - O)`. Moving the
 * origin from O0 to O1 is therefore offset by `(I - A)(O0 - O1)`. Applying
 * that compensation to x/y/z keeps every transformed point stationary,
 * including scaled, rotated, and tilted layers.
 */
export function pivotPreservingTransformPatch(
  transform: Transform,
  width: number,
  height: number,
  next: PivotAnchor,
): PivotTransformPatch {
  const previous = {
    anchorX: transform.anchorX ?? 0.5,
    anchorY: transform.anchorY ?? 0.5,
    anchorZ: transform.anchorZ ?? 0,
  }
  const delta = {
    x: width * (previous.anchorX - next.anchorX),
    y: height * (previous.anchorY - next.anchorY),
    z: previous.anchorZ - next.anchorZ,
  }
  const transformedDelta = rotateEuler(
    {
      x: delta.x * transform.scaleX,
      y: delta.y * transform.scaleY,
      z: delta.z,
    },
    transform.rotationX,
    transform.rotationY,
    transform.rotation,
  )

  return {
    x: transform.x + delta.x - transformedDelta.x,
    y: transform.y + delta.y - transformedDelta.y,
    z: transform.z + delta.z - transformedDelta.z,
    ...next,
  }
}
