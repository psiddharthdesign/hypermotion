// SPDX-License-Identifier: Apache-2.0

import {
  normalizeTextStaggerCurve,
  type TextStaggerCurve,
} from '@/anim/textStaggerCurve'

const POINT_GAP = 0.005

export type StaggerCurvePart = 'anchor' | 'in' | 'out'

export function editCurvePart(
  curve: TextStaggerCurve,
  pointId: string,
  part: StaggerCurvePart,
  targetX: number,
  targetY: number,
): TextStaggerCurve {
  const points = curve.points.map((point) => ({ ...point }))
  const index = points.findIndex((point) => point.id === pointId)
  const point = points[index]
  if (!point) return curve
  if (part === 'anchor') {
    if (index === 0 || index === points.length - 1) return curve
    const previous = points[index - 1]!
    const next = points[index + 1]!
    const x = clamp(targetX, previous.x + POINT_GAP, next.x - POINT_GAP)
    const y = clamp(targetY, previous.y, next.y)
    const dx = x - point.x
    const dy = y - point.y
    point.x = x
    point.y = y
    point.inX += dx
    point.inY += dy
    point.outX += dx
    point.outY += dy
  } else if (part === 'in') {
    point.inX = targetX
    point.inY = targetY
  } else {
    point.outX = targetX
    point.outY = targetY
  }
  return normalizeTextStaggerCurve({ version: 1, points }) ?? curve
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
