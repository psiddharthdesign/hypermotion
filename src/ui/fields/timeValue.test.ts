// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { formatTimeValue, parseTimeValueDraft } from './timeValue'

describe('TimeField value conversion', () => {
  it('uses the configured unit for bare numbers', () => {
    expect(parseTimeValueDraft('2.5', 'seconds')).toBe(2.5)
    expect(parseTimeValueDraft('250', 'milliseconds')).toBe(250)
  })

  it('converts authored units into the configured value unit', () => {
    expect(parseTimeValueDraft('10s', 'seconds')).toBe(10)
    expect(parseTimeValueDraft('2m', 'seconds')).toBe(120)
    expect(parseTimeValueDraft('1hr', 'seconds')).toBe(3600)
    expect(parseTimeValueDraft('2s', 'milliseconds')).toBe(2000)
    expect(parseTimeValueDraft('250ms', 'seconds')).toBe(0.25)
  })

  it('retains arithmetic for unitless drafts', () => {
    expect(parseTimeValueDraft('60*2', 'seconds')).toBe(120)
  })

  it('formats values without forced decimal rounding', () => {
    expect(formatTimeValue(1.23456789, 'seconds')).toBe('1.23456789')
    expect(formatTimeValue(250.125, 'milliseconds')).toBe('250.125')
  })
})
