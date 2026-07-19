// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { defaultTextMotionPath } from './textMotionPath'
import {
  evaluateTextStaggerCurve,
  textStaggerCurveForPreset,
} from './textStaggerCurve'
import {
  resolveTextMotionRailAmount,
  resolveTextSegmentMotion,
} from './textSegmentMotion'

describe('text segment spatial motion', () => {
  it('keeps absent spatial motion distinct for legacy direction rendering', () => {
    expect(resolveTextSegmentMotion(null, null, 48, 0.5)).toBeNull()
  })

  it('scales an authored path in line-height units', () => {
    const path = defaultTextMotionPath()
    const start = path.points.at(-1)!
    expect(resolveTextSegmentMotion(path, null, 20, 1)).toEqual({
      x: start.x * 20,
      y: start.y * 20,
      z: start.z * 20,
    })
    expect(resolveTextSegmentMotion(path, null, 20, 0)).toEqual({
      x: 0,
      y: 0,
      z: 0,
    })
  })

  it('lets a path override a stale straight vector', () => {
    const path = defaultTextMotionPath()
    const resolved = resolveTextSegmentMotion(
      path,
      { x: 9, y: 9, z: 9 },
      10,
      1,
    )!
    expect(resolved.x).toBe(path.points.at(-1)!.x * 10)
    expect(resolved.y).toBe(path.points.at(-1)!.y * 10)
    expect(resolved.z).toBe(path.points.at(-1)!.z * 10)
  })

  it('drives a complete rail with one run-level transport amount', () => {
    const timing = {
      mode: 'in' as const,
      duration: 1,
      delay: 0.1,
      startTime: 2,
      acceleration: 'linear' as const,
      staggerCurve: null,
    }
    expect(resolveTextMotionRailAmount(timing, 2, undefined, 5, 0, 5)).toBe(1)
    expect(resolveTextMotionRailAmount(timing, 3.4, undefined, 5, 0, 5)).toBe(0)
    expect(resolveTextMotionRailAmount(timing, 0, 0.5, 5, 0, 5)).toBeCloseTo(0.5)
  })

  it('retains global line offsets while reversing an exit', () => {
    const timing = {
      mode: 'out' as const,
      duration: 1,
      delay: 0.1,
      startTime: 0,
      acceleration: 'linear' as const,
      staggerCurve: null,
    }
    // A second two-letter line begins after the first three sequence slots.
    expect(resolveTextMotionRailAmount(timing, 0.2, undefined, 5, 3, 2)).toBe(0)
    expect(resolveTextMotionRailAmount(timing, 0.85, undefined, 5, 3, 2)).toBeCloseTo(0.5)
  })

  it('uses the editable spread profile once without separating rail segments', () => {
    const staggerCurve = textStaggerCurveForPreset('smooth')
    const timing = {
      mode: 'in' as const,
      duration: 1,
      delay: 0,
      startTime: 0,
      acceleration: 'linear' as const,
      staggerCurve,
    }
    expect(resolveTextMotionRailAmount(timing, 0, 0.25, 4, 0, 4)).toBeCloseTo(
      1 - evaluateTextStaggerCurve(0.25, staggerCurve),
    )
  })
})
