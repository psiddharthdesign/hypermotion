// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  cornerShapePath,
  needsCornerShapePath,
  normalizeCornerSmoothing,
} from './cornerShape'

describe('normalizeCornerSmoothing', () => {
  it('defaults invalid values and clamps finite values', () => {
    expect(normalizeCornerSmoothing(undefined)).toBe(0)
    expect(normalizeCornerSmoothing(Number.NaN)).toBe(0)
    expect(normalizeCornerSmoothing(-0.2)).toBe(0)
    expect(normalizeCornerSmoothing(0.6)).toBe(0.6)
    expect(normalizeCornerSmoothing(1.4)).toBe(1)
  })
})

describe('cornerShapePath', () => {
  it('produces distinct circular and continuous corner geometry', () => {
    const circular = cornerShapePath({
      width: 120,
      height: 72,
      cornerRadius: 16,
      cornerSmoothing: 0,
    })
    const continuous = cornerShapePath({
      width: 120,
      height: 72,
      cornerRadius: 16,
      cornerSmoothing: 0.6,
    })

    expect(circular).not.toBe(continuous)
    expect(continuous).toMatch(/^M /)
    expect(continuous).toMatch(/ Z$/)
    expect(continuous).not.toMatch(/NaN|Infinity/)
  })

  it('keeps per-corner radii and inset strokes finite', () => {
    const path = cornerShapePath({
      width: 100,
      height: 60,
      cornerRadius: 0,
      cornerRadii: { tl: 4, tr: 12, br: 24, bl: 8 },
      cornerSmoothing: 0.6,
      inset: 2,
    })

    expect(path).toContain('M ')
    expect(path).toContain('L ')
    expect(path).not.toMatch(/NaN|Infinity|-[0-9]+\.0{4} -[0-9]+\.0{4}/)
  })

  it('allows one large corner when adjacent corners leave room', () => {
    const path = cornerShapePath({
      width: 100,
      height: 60,
      cornerRadius: 0,
      cornerRadii: { tl: 50, tr: 0, br: 0, bl: 0 },
      cornerSmoothing: 0.6,
    })

    expect(path).toContain('a 50.0000 50.0000')
  })

  it('uses the shared path only for smoothing or per-corner radii', () => {
    expect(needsCornerShapePath(0)).toBe(false)
    expect(needsCornerShapePath(undefined)).toBe(false)
    expect(needsCornerShapePath(0.6)).toBe(true)
    expect(needsCornerShapePath(0, { tl: 1, tr: 2, br: 3, bl: 4 })).toBe(true)
  })
})
