// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  splitTextStaggerCurveAt,
  textStaggerCurveForPreset,
} from '@/anim/textStaggerCurve'
import { editCurvePart } from './staggerCurveEditorMath'

describe('trail profile editor math', () => {
  it('moves an interior anchor with its handles while endpoints stay fixed', () => {
    const curve = splitTextStaggerCurveAt(
      textStaggerCurveForPreset('smooth'),
      0.5,
      'middle',
    )
    const before = curve.points[1]!
    const moved = editCurvePart(curve, 'middle', 'anchor', 0.65, 0.35)
    const point = moved.points[1]!

    expect(point).toMatchObject({ x: 0.65, y: 0.35 })
    expect(point.inX - before.inX).toBeCloseTo(0.15, 8)
    expect(point.inY - before.inY).toBeCloseTo(0.35 - before.y, 8)
    expect(moved.points[0]).toMatchObject({ x: 0, y: 0 })
    expect(moved.points.at(-1)).toMatchObject({ x: 1, y: 1 })
  })

  it('does not move fixed endpoint anchors', () => {
    const curve = textStaggerCurveForPreset('none')
    expect(editCurvePart(curve, 'curve-start', 'anchor', 0.5, 0.5)).toEqual(
      curve,
    )
    expect(editCurvePart(curve, 'curve-end', 'anchor', 0.5, 0.5)).toEqual(
      curve,
    )
  })

  it('keeps anchors and handles monotonic under extreme drags', () => {
    const curve = splitTextStaggerCurveAt(
      textStaggerCurveForPreset('none'),
      0.5,
      'middle',
    )
    const movedAnchor = editCurvePart(
      curve,
      'middle',
      'anchor',
      -10,
      10,
    )
    const movedHandle = editCurvePart(
      movedAnchor,
      'middle',
      'out',
      -10,
      -10,
    )

    for (let index = 0; index < movedHandle.points.length - 1; index++) {
      const left = movedHandle.points[index]!
      const right = movedHandle.points[index + 1]!
      expect(left.x).toBeLessThan(right.x)
      expect(left.y).toBeLessThanOrEqual(right.y)
      expect(left.outX).toBeGreaterThanOrEqual(left.x)
      expect(left.outX).toBeLessThanOrEqual(right.inX)
      expect(right.inX).toBeLessThanOrEqual(right.x)
      expect(left.outY).toBeGreaterThanOrEqual(left.y)
      expect(left.outY).toBeLessThanOrEqual(right.inY)
      expect(right.inY).toBeLessThanOrEqual(right.y)
    }
  })
})
