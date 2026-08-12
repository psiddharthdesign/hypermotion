// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { masterTimelineRevealScrollLeft } from './masterTimelineViewport'

describe('masterTimelineRevealScrollLeft', () => {
  it('does not disturb an exact time that is already visible', () => {
    expect(
      masterTimelineRevealScrollLeft({
        time: 12,
        pixelsPerSecond: 72,
        scrollLeft: 500,
        clientWidth: 800,
        scrollWidth: 2400,
      }),
    ).toBe(500)
  })

  it('reveals a time beyond the right edge with working room after it', () => {
    expect(
      masterTimelineRevealScrollLeft({
        time: 30,
        pixelsPerSecond: 72,
        scrollLeft: 0,
        clientWidth: 1000,
        scrollWidth: 2360,
      }),
    ).toBe(1192)
  })

  it('reveals an earlier time after the viewport has scrolled right', () => {
    expect(
      masterTimelineRevealScrollLeft({
        time: 2,
        pixelsPerSecond: 72,
        scrollLeft: 900,
        clientWidth: 800,
        scrollWidth: 2400,
      }),
    ).toBe(112)
  })

  it('clamps to the available horizontal scroll range', () => {
    expect(
      masterTimelineRevealScrollLeft({
        time: 100,
        pixelsPerSecond: 72,
        scrollLeft: 0,
        clientWidth: 1000,
        scrollWidth: 2100,
      }),
    ).toBe(1100)
  })
})
