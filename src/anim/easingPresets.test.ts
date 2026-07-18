// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { normalizeTextAnimation } from './textAnimations'
import {
  MAX_EASING_STRENGTH,
  clampEasingStrength,
  findEasingPreset,
} from './easingPresets'

function curve(id: Parameters<typeof findEasingPreset>[0], strength: number) {
  const easing = findEasingPreset(id).build(strength)
  if (typeof easing !== 'object' || !('bezier' in easing)) {
    throw new Error(`${id} did not produce a bezier curve`)
  }
  return easing.bezier
}

describe('easing strength range', () => {
  it('preserves the established curve at strength 100', () => {
    expect(curve('overshoot', 100)).toEqual([0.34, 2, 0.64, 1])
    const smooth = curve('smooth', 100)
    expect(smooth[0]).toBeCloseTo(0.85)
    expect(smooth[1]).toBe(0)
    expect(smooth[2]).toBeCloseTo(0.15)
    expect(smooth[3]).toBe(1)
  })

  it('extends curve character through strength 200', () => {
    expect(curve('overshoot', 200)).toEqual([0.34, 2.8, 0.64, 1])
    expect(curve('elastic', 200)[3]).toBe(3)
  })

  it('keeps every extrapolated bezier time control valid', () => {
    const presetIds = [
      'smooth',
      'natural',
      'slow-down',
      'accelerate',
      'elastic',
      'bounce',
      'overshoot',
      'impulse',
      'swing',
      'custom',
    ] as const
    for (const id of presetIds) {
      for (const strength of [0, 50, 100, 150, 200]) {
        const [x1, , x2] = curve(id, strength)
        expect(Number.isFinite(x1)).toBe(true)
        expect(Number.isFinite(x2)).toBe(true)
        expect(x1).toBeGreaterThanOrEqual(0)
        expect(x1).toBeLessThanOrEqual(1)
        expect(x2).toBeGreaterThanOrEqual(0)
        expect(x2).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps producing a distinct curve throughout the added range', () => {
    for (const id of [
      'smooth',
      'natural',
      'slow-down',
      'accelerate',
      'elastic',
      'bounce',
      'overshoot',
      'impulse',
      'swing',
      'custom',
    ] as const) {
      expect(curve(id, 150)).not.toEqual(curve(id, 100))
      expect(curve(id, 200)).not.toEqual(curve(id, 150))
    }
  })

  it('clamps UI and persisted text strengths to the shared range', () => {
    expect(clampEasingStrength(-10)).toBe(0)
    expect(clampEasingStrength(250)).toBe(MAX_EASING_STRENGTH)
    expect(
      normalizeTextAnimation({
        id: 'fade',
        easingStrength: 200,
      })?.easingStrength,
    ).toBe(200)
    expect(
      normalizeTextAnimation({
        id: 'fade',
        easingStrength: 250,
      })?.easingStrength,
    ).toBe(MAX_EASING_STRENGTH)
  })
})
