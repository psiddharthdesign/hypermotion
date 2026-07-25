// SPDX-License-Identifier: Apache-2.0

import {
  evaluateTextMotionPath,
  normalizeTextMotionPath,
  type TextMotionPath,
  type TextMotionPathNormalizer,
  type TextMotionPathPoint,
} from '@/anim/textMotionPath'

export type TextMotionPathPart = 'anchor' | 'in' | 'out'

export interface TextMotionPathPosition {
  x: number
  y: number
  z: number
}

/**
 * Edit one spatial part of a text motion path.
 *
 * The settled anchor at t=0 is intentionally immovable. Moving any other
 * anchor carries its Bezier handles with it, preserving the authored tangent;
 * moving a handle changes only that handle.
 */
export function editTextMotionPathPart(
  path: TextMotionPath,
  pointId: string,
  part: TextMotionPathPart,
  target: TextMotionPathPosition,
  normalizePath: TextMotionPathNormalizer = normalizeTextMotionPath,
): TextMotionPath {
  const points = path.points.map((point) => ({ ...point }))
  const index = points.findIndex((point) => point.id === pointId)
  const point = points[index]
  if (!point) return path

  if (part === 'anchor') {
    if (index === 0) return path
    const dx = target.x - point.x
    const dy = target.y - point.y
    const dz = target.z - point.z
    point.x = target.x
    point.y = target.y
    point.z = target.z
    point.inX += dx
    point.inY += dy
    point.inZ += dz
    point.outX += dx
    point.outY += dy
    point.outZ += dz
  } else if (part === 'in') {
    point.inX = target.x
    point.inY = target.y
    point.inZ = target.z
  } else {
    point.outX = target.x
    point.outY = target.y
    point.outZ = target.z
  }

  return normalizePath({ ...path, points }) ?? path
}

export function textMotionPathPartPosition(
  point: TextMotionPathPoint,
  part: TextMotionPathPart,
): TextMotionPathPosition {
  if (part === 'in') {
    return { x: point.inX, y: point.inY, z: point.inZ }
  }
  if (part === 'out') {
    return { x: point.outX, y: point.outY, z: point.outZ }
  }
  return { x: point.x, y: point.y, z: point.z }
}

/** Split the widest remaining t interval, which gives +Point a useful result. */
export function largestTextMotionPathSegmentMidpoint(
  path: TextMotionPath,
): number {
  let largestStart = 0
  let largestEnd = 1
  let largestSpan = -1
  for (let index = 0; index < path.points.length - 1; index++) {
    const start = path.points[index]!.t
    const end = path.points[index + 1]!.t
    if (end - start > largestSpan) {
      largestSpan = end - start
      largestStart = start
      largestEnd = end
    }
  }
  return (largestStart + largestEnd) / 2
}

/**
 * Find the curve amount nearest an XY editor position. A dense first pass plus
 * a short local refinement feels exact at inspector size without depending on
 * the path's spatial direction or requiring it to be monotonic in X/Y.
 */
export function nearestTextMotionPathAmount(
  path: TextMotionPath,
  target: Pick<TextMotionPathPosition, 'x' | 'y'>,
  samples = 160,
): number {
  const sampleCount = Math.max(16, Math.floor(samples))
  let bestAmount = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index <= sampleCount; index++) {
    const amount = index / sampleCount
    const point = evaluateTextMotionPath(amount, path)
    const distance = squaredDistance(point.x, point.y, target.x, target.y)
    if (distance < bestDistance) {
      bestDistance = distance
      bestAmount = amount
    }
  }

  let low = Math.max(0, bestAmount - 1 / sampleCount)
  let high = Math.min(1, bestAmount + 1 / sampleCount)
  // Ternary refinement is stable even on self-intersecting paths because the
  // dense pass has already selected the local branch nearest the pointer.
  for (let iteration = 0; iteration < 12; iteration++) {
    const left = low + (high - low) / 3
    const right = high - (high - low) / 3
    const leftPoint = evaluateTextMotionPath(left, path)
    const rightPoint = evaluateTextMotionPath(right, path)
    const leftDistance = squaredDistance(
      leftPoint.x,
      leftPoint.y,
      target.x,
      target.y,
    )
    const rightDistance = squaredDistance(
      rightPoint.x,
      rightPoint.y,
      target.x,
      target.y,
    )
    if (leftDistance <= rightDistance) high = right
    else low = left
  }
  return (low + high) / 2
}

function squaredDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}
