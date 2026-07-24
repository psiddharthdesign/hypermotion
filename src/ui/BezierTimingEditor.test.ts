// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  BEZIER_TIMING_Y_MAX,
  BEZIER_TIMING_Y_MIN,
  buildBezierTimingPath,
  clampBezierTiming,
  evaluateBezierTiming,
  projectBezierTimingPoint,
  unprojectBezierTimingPoint,
  updateBezierTimingHandle,
} from './bezierTimingEditorMath'

const bounds = { x: 12, y: 10, width: 240, height: 118 }

describe('custom Bezier timing editor math', () => {
  it('clamps time controls and permits bounded value overshoot', () => {
    expect(clampBezierTiming([-1, -4, 2, 7])).toEqual([
      0,
      BEZIER_TIMING_Y_MIN,
      1,
      BEZIER_TIMING_Y_MAX,
    ])
  })

  it('uses safe defaults for non-finite input', () => {
    expect(
      clampBezierTiming([
        Number.NaN,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.NaN,
      ]),
    ).toEqual([0.42, 0, 0.58, 1])
  })

  it('updates only the requested handle', () => {
    expect(updateBezierTimingHandle([0.2, 0.4, 0.7, 0.9], 2, 0.8, 1.5))
      .toEqual([0.2, 0.4, 0.8, 1.5])
  })

  it('round-trips normal and overshoot points through the graph projection', () => {
    for (const y of [-2, -0.5, 0, 0.5, 1, 2, 3]) {
      const projected = projectBezierTimingPoint({ x: 0.37, y }, bounds)
      const restored = unprojectBezierTimingPoint(projected, bounds)
      expect(restored.x).toBeCloseTo(0.37, 8)
      expect(restored.y).toBeCloseTo(y, 8)
    }
  })

  it('keeps pointer values outside the graph within supported model limits', () => {
    expect(unprojectBezierTimingPoint({ x: -500, y: -500 }, bounds)).toEqual({
      x: 0,
      y: BEZIER_TIMING_Y_MAX,
    })
    expect(unprojectBezierTimingPoint({ x: 900, y: 900 }, bounds)).toEqual({
      x: 1,
      y: BEZIER_TIMING_Y_MIN,
    })
  })

  it('evaluates fixed endpoints and produces a sampled SVG path', () => {
    const curve: [number, number, number, number] = [0.42, 0, 0.58, 1]
    expect(evaluateBezierTiming(curve, 0)).toEqual({ x: 0, y: 0 })
    expect(evaluateBezierTiming(curve, 1)).toEqual({ x: 1, y: 1 })

    const path = buildBezierTimingPath(curve, bounds, 8)
    expect(path).toMatch(/^M /)
    expect(path.match(/ L /g)).toHaveLength(8)
    expect(path).not.toContain('NaN')
  })
})
