// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  formatNumericDisplayValue,
  formatNumericValue,
  parseNumericExpression,
  stabilizeNumericValue,
} from './numericExpression'

describe('numeric field values', () => {
  it('preserves authored decimal precision', () => {
    expect(formatNumericValue(1.23456789)).toBe('1.23456789')
    expect(formatNumericValue(-0.125)).toBe('-0.125')
    expect(formatNumericValue(-0)).toBe('0')
  })

  it('uses a compact two-decimal presentation outside edit mode', () => {
    expect(formatNumericDisplayValue(411.2778001)).toBe('411.28')
    expect(formatNumericDisplayValue(-16.474)).toBe('-16.47')
    expect(formatNumericDisplayValue(48)).toBe('48')
    expect(formatNumericDisplayValue(-0)).toBe('0')
  })

  it('parses literals and safe arithmetic', () => {
    expect(parseNumericExpression('1.23456789')).toBe(1.23456789)
    expect(parseNumericExpression('.125')).toBe(0.125)
    expect(parseNumericExpression('1920 / 16 * 9')).toBe(1080)
    expect(parseNumericExpression('100*2')).toBe(200)
  })

  it('rejects incomplete and identifier-bearing drafts', () => {
    expect(parseNumericExpression('')).toBeNull()
    expect(parseNumericExpression('-')).toBeNull()
    expect(parseNumericExpression('1.')).toBe(1)
    expect(parseNumericExpression('window.alert(1)')).toBeNull()
  })

  it('removes common binary stepping noise', () => {
    expect(stabilizeNumericValue(0.1 + 0.2)).toBe(0.3)
  })
})
