// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  evaluateTextStaggerCurve,
  normalizeTextStaggerCurve,
  removeTextStaggerCurvePoint,
  splitTextStaggerCurveAt,
  textStaggerCurveForPreset,
} from './textStaggerCurve'

describe('manual text stagger curve', () => {
  it('rejects unknown curve versions', () => {
    expect(
      normalizeTextStaggerCurve({ version: 2, points: [] }),
    ).toBeNull()
  })

  it('keeps the linear preset identical to progress', () => {
    const curve = textStaggerCurveForPreset('none')
    for (let index = 0; index <= 20; index++) {
      const progress = index / 20
      expect(evaluateTextStaggerCurve(progress, curve)).toBeCloseTo(progress, 6)
    }
  })

  it('normalizes malformed anchors and controls into a monotonic spline', () => {
    const curve = normalizeTextStaggerCurve({
      version: 1,
      points: [
        { id: 'end', x: 4, y: 8, inX: -1, inY: -2 },
        { id: 'middle', x: 0.5, y: 0.7, inX: 1, inY: 1, outX: -1, outY: -1 },
        { id: 'start', x: -2, y: -4, outX: 2, outY: 2 },
        { id: 'bad', x: Number.NaN, y: 0.4 },
      ],
    })!

    expect(curve.points[0]).toMatchObject({ x: 0, y: 0 })
    expect(curve.points.at(-1)).toMatchObject({ x: 1, y: 1 })
    for (let index = 0; index < curve.points.length - 1; index++) {
      const left = curve.points[index]!
      const right = curve.points[index + 1]!
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

  it('evaluates custom multi-point curves within bounds and monotonically', () => {
    const curve = normalizeTextStaggerCurve({
      version: 1,
      points: [
        { id: 'start', x: 0, y: 0, outX: 0.1, outY: 0 },
        { id: 'middle', x: 0.42, y: 0.2, inX: 0.3, inY: 0.05, outX: 0.65, outY: 0.3 },
        { id: 'end', x: 1, y: 1, inX: 0.8, inY: 0.95 },
      ],
    })!
    let previous = -1
    for (let index = 0; index <= 100; index++) {
      const value = evaluateTextStaggerCurve(index / 100, curve)
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      previous = value
    }
  })

  it('adds a point with de Casteljau subdivision without changing the shape', () => {
    const before = textStaggerCurveForPreset('smooth')
    const after = splitTextStaggerCurveAt(before, 0.37, 'inserted')
    expect(after.points).toHaveLength(3)
    expect(after.points[1]?.id).toBe('inserted')
    for (let index = 0; index <= 100; index++) {
      const progress = index / 100
      expect(evaluateTextStaggerCurve(progress, after)).toBeCloseTo(
        evaluateTextStaggerCurve(progress, before),
        5,
      )
    }
  })

  it('stays monotonic with handles bunched against an endpoint', () => {
    const curve = normalizeTextStaggerCurve({
      version: 1,
      points: [
        { id: 'start', x: 0, y: 0, outX: 0.99, outY: 1 },
        { id: 'end', x: 1, y: 1, inX: 0.9999, inY: 1 },
      ],
    })!
    let previous = -1
    for (let index = 0; index <= 2000; index++) {
      const value = evaluateTextStaggerCurve(index / 2000, curve)
      expect(value).toBeGreaterThanOrEqual(previous - 1e-10)
      previous = value
    }

    const split = splitTextStaggerCurveAt(curve, 0.37, 'inserted')
    for (let index = 0; index <= 500; index++) {
      const phase = index / 500
      expect(evaluateTextStaggerCurve(phase, split)).toBeCloseTo(
        evaluateTextStaggerCurve(phase, curve),
        7,
      )
    }
  })

  it('retains both real endpoints when imported data exceeds the point cap', () => {
    const curve = normalizeTextStaggerCurve({
      version: 1,
      points: Array.from({ length: 13 }, (_, index) => ({
        id: `point-${index}`,
        x: index / 12,
        y: index / 12,
      })),
    })!
    expect(curve.points).toHaveLength(12)
    expect(curve.points[0]?.id).toBe('point-0')
    expect(curve.points.at(-1)?.id).toBe('point-12')
    expect(curve.points.at(-1)).toMatchObject({ x: 1, y: 1 })
  })

  it('only removes interior points', () => {
    const withPoint = splitTextStaggerCurveAt(
      textStaggerCurveForPreset('soft'),
      0.5,
      'middle',
    )
    expect(removeTextStaggerCurvePoint(withPoint, 'curve-start').points).toHaveLength(3)
    expect(removeTextStaggerCurvePoint(withPoint, 'middle').points).toHaveLength(2)
  })
})
