// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  MAX_TEXT_MOTION_PATH_POINTS,
  defaultTextMotionPath,
  evaluateTextMotionPath,
  normalizeTextMotionPath,
  removeTextMotionPathPoint,
  setTextMotionPathDistance,
  splitTextMotionPathAt,
  textMotionPathDistance,
} from './textMotionPath'

describe('text motion path', () => {
  it('provides a broad bowed drop with exact settled and start endpoints', () => {
    const path = defaultTextMotionPath()

    expect(evaluateTextMotionPath(0, path)).toEqual({ x: 0, y: 0, z: 0 })
    expect(evaluateTextMotionPath(1, path)).toEqual({ x: 0, y: -4, z: 0 })
    const middle = evaluateTextMotionPath(0.5, path)
    expect(middle.x).toBeLessThan(-1)
    expect(middle.y).toBeLessThan(-1)
    expect(middle.y).toBeGreaterThan(-3)
  })

  it('retargets XYZ distance while preserving the authored curve', () => {
    const path = splitTextMotionPathAt(
      defaultTextMotionPath(),
      0.4,
      'middle',
    )
    const before = [0, 0.25, 0.5, 0.75, 1].map((amount) =>
      evaluateTextMotionPath(amount, path),
    )

    const next = setTextMotionPathDistance(path, { x: 2, y: -6, z: 3 })

    expect(textMotionPathDistance(path)).toEqual({ x: 0, y: -4, z: 0 })
    expect(textMotionPathDistance(next)).toEqual({ x: 2, y: -6, z: 3 })
    expect(textMotionPathDistance(path)).toEqual({ x: 0, y: -4, z: 0 })
    for (const [index, amount] of [0, 0.25, 0.5, 0.75, 1].entries()) {
      const moved = evaluateTextMotionPath(amount, next)
      expect(moved.x).toBeCloseTo(before[index]!.x + 2 * amount)
      expect(moved.y).toBeCloseTo(before[index]!.y - 2 * amount)
      expect(moved.z).toBeCloseTo(before[index]!.z + 3 * amount)
    }
  })

  it('rejects unsupported versions and paths with fewer than two anchors', () => {
    expect(normalizeTextMotionPath(null)).toBeNull()
    expect(normalizeTextMotionPath({ version: 2, points: [] })).toBeNull()
    expect(
      normalizeTextMotionPath({
        version: 1,
        points: [{ id: 'only', t: 0, x: 0, y: 0 }],
      }),
    ).toBeNull()
  })

  it('sorts time, fixes the settled anchor, clamps space, and repairs controls', () => {
    const path = normalizeTextMotionPath({
      version: 1,
      points: [
        {
          id: 'duplicate',
          t: 3,
          x: 40,
          y: -40,
          z: 30,
          inX: 50,
          inY: -50,
          inZ: 20,
        },
        {
          id: 'duplicate',
          t: 0.5,
          x: -2,
          y: -1,
          z: Number.POSITIVE_INFINITY,
          outX: Number.NaN,
        },
        {
          id: 'settled',
          t: -2,
          x: 5,
          y: 6,
          z: 7,
          inX: -8,
          inY: -8,
          inZ: -8,
        },
        { id: 'invalid', t: Number.NaN, x: 0, y: 0 },
      ],
    })!

    expect(path.points).toHaveLength(3)
    expect(path.points[0]).toMatchObject({
      id: 'settled',
      t: 0,
      x: 0,
      y: 0,
      z: 0,
      inX: 0,
      inY: 0,
      inZ: 0,
    })
    expect(path.points[1]).toMatchObject({ t: 0.5, z: 0 })
    expect(path.points[2]).toMatchObject({
      t: 1,
      x: 10,
      y: -10,
      z: 10,
      outX: 10,
      outY: -10,
      outZ: 10,
    })
    expect(new Set(path.points.map((point) => point.id)).size).toBe(3)
    for (const point of path.points) {
      for (const key of [
        'x',
        'y',
        'z',
        'inX',
        'inY',
        'inZ',
        'outX',
        'outY',
        'outZ',
      ] as const) {
        expect(Number.isFinite(point[key])).toBe(true)
        expect(point[key]).toBeGreaterThanOrEqual(-10)
        expect(point[key]).toBeLessThanOrEqual(10)
      }
    }
  })

  it('enforces a stable time gap while allowing spatial reversals', () => {
    const path = normalizeTextMotionPath({
      version: 1,
      points: [
        { id: 'settled', t: 0, x: 0, y: 0 },
        { id: 'left', t: 0, x: -4, y: -1 },
        { id: 'right', t: 0, x: 4, y: -2 },
        { id: 'start', t: 1, x: 0, y: -4 },
      ],
    })!

    expect(path.points[1]!.t - path.points[0]!.t).toBeGreaterThanOrEqual(0.005)
    expect(path.points[2]!.t - path.points[1]!.t).toBeGreaterThanOrEqual(0.005)
    expect(path.points.map((point) => point.x)).toEqual([0, -4, 4, 0])
  })

  it('uses linear default handles when controls are omitted', () => {
    const path = normalizeTextMotionPath({
      version: 1,
      points: [
        { id: 'settled', t: 0, x: 0, y: 0, z: 0 },
        { id: 'start', t: 1, x: 3, y: -6, z: 9 },
      ],
    })!

    expect(evaluateTextMotionPath(0.25, path)).toEqual({
      x: 0.75,
      y: -1.5,
      z: 2.25,
    })
    expect(evaluateTextMotionPath(0.75, path)).toEqual({
      x: 2.25,
      y: -4.5,
      z: 6.75,
    })
  })

  it('clamps invalid amounts and returns zero for a missing path', () => {
    const path = defaultTextMotionPath()
    expect(evaluateTextMotionPath(Number.NaN, path)).toEqual({ x: 0, y: 0, z: 0 })
    expect(evaluateTextMotionPath(-1, path)).toEqual({ x: 0, y: 0, z: 0 })
    expect(evaluateTextMotionPath(2, path)).toEqual({ x: 0, y: -4, z: 0 })
    expect(evaluateTextMotionPath(0.5, null)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('splits all three axes with De Casteljau without changing the path', () => {
    const before = normalizeTextMotionPath({
      version: 1,
      points: [
        {
          id: 'settled',
          t: 0,
          x: 0,
          y: 0,
          z: 0,
          outX: -2,
          outY: -0.25,
          outZ: 1,
        },
        {
          id: 'bend',
          t: 0.65,
          x: 1.5,
          y: -3,
          z: 2,
          inX: -3,
          inY: -2,
          inZ: 2.5,
          outX: 2,
          outY: -3.5,
          outZ: 1,
        },
        {
          id: 'start',
          t: 1,
          x: 0,
          y: -5,
          z: -1,
          inX: 1,
          inY: -4.5,
          inZ: 0,
        },
      ],
    })!
    const after = splitTextMotionPathAt(before, 0.37, 'inserted')

    expect(after.points).toHaveLength(4)
    expect(after.points[1]).toMatchObject({ id: 'inserted', t: 0.37 })
    for (let index = 0; index <= 200; index++) {
      const amount = index / 200
      const expected = evaluateTextMotionPath(amount, before)
      const actual = evaluateTextMotionPath(amount, after)
      expect(actual.x).toBeCloseTo(expected.x, 8)
      expect(actual.y).toBeCloseTo(expected.y, 8)
      expect(actual.z).toBeCloseTo(expected.z, 8)
    }
  })

  it('does not split on an existing anchor or beyond the point cap', () => {
    const path = splitTextMotionPathAt(defaultTextMotionPath(), 0.5, 'middle')
    expect(splitTextMotionPathAt(path, 0.5, 'duplicate').points).toHaveLength(3)

    const capped = normalizeTextMotionPath({
      version: 1,
      points: Array.from({ length: MAX_TEXT_MOTION_PATH_POINTS }, (_, index) => ({
        id: `point-${index}`,
        t: index / (MAX_TEXT_MOTION_PATH_POINTS - 1),
        x: index % 2,
        y: -index / 2,
      })),
    })!
    expect(splitTextMotionPathAt(capped, 0.25, 'extra').points).toHaveLength(
      MAX_TEXT_MOTION_PATH_POINTS,
    )
  })

  it('retains the real temporal endpoints when imported data exceeds the cap', () => {
    const path = normalizeTextMotionPath({
      version: 1,
      points: Array.from({ length: 14 }, (_, index) => ({
        id: `point-${index}`,
        t: index / 13,
        x: index,
        y: -index,
      })),
    })!

    expect(path.points).toHaveLength(MAX_TEXT_MOTION_PATH_POINTS)
    expect(path.points[0]?.id).toBe('point-0')
    expect(path.points.at(-1)?.id).toBe('point-13')
    expect(path.points.at(-1)).toMatchObject({ t: 1, x: 10, y: -10 })
  })

  it('removes only interior anchors', () => {
    const withPoint = splitTextMotionPathAt(
      defaultTextMotionPath(),
      0.5,
      'middle',
    )

    expect(
      removeTextMotionPathPoint(withPoint, 'motion-path-settled').points,
    ).toHaveLength(3)
    expect(
      removeTextMotionPathPoint(withPoint, 'motion-path-start').points,
    ).toHaveLength(3)
    expect(removeTextMotionPathPoint(withPoint, 'middle').points).toHaveLength(2)
  })

  it('normalizes duplicate and blank ids deterministically', () => {
    const path = normalizeTextMotionPath({
      version: 1,
      points: [
        { id: 'same', t: 0, x: 0, y: 0 },
        { id: 'same', t: 0.5, x: -1, y: -2 },
        { id: 'same-1', t: 1, x: 0, y: -4 },
      ],
    })!

    expect(path.points.map((point) => point.id)).toEqual([
      'same',
      'same-1',
      'same-1-1',
    ])
  })
})
