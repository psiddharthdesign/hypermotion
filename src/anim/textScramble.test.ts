// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_ANIMATION } from './textAnimations'
import {
  scrambleCharacterForSegment,
  scrambleTextForSegment,
} from './textScramble'
import { normalizeTextStaggerCurve } from './textStaggerCurve'

const config = {
  ...DEFAULT_TEXT_ANIMATION,
  id: 'scramble' as const,
  startTime: 2,
  duration: 1,
}

const quadraticProfile = normalizeTextStaggerCurve({
  version: 1,
  points: [
    { id: 'start', x: 0, y: 0, outX: 1 / 3, outY: 0 },
    { id: 'end', x: 1, y: 1, inX: 2 / 3, inY: 1 / 3 },
  ],
})!

describe('shared text scramble', () => {
  it('uses the segment order in its deterministic glyph seed', () => {
    expect(scrambleTextForSegment('Depth', config, 2.4, undefined, 0, 2)).not.toBe(
      scrambleTextForSegment('Depth', config, 2.4, undefined, 1, 2),
    )
  })

  it('holds replacement glyphs on a shared 30 Hz cadence', () => {
    expect(
      scrambleTextForSegment('Depth', config, 2.401, undefined, 0, 1),
    ).toBe(scrambleTextForSegment('Depth', config, 2.42, undefined, 0, 1))
  })

  it('selects the same pre-baked letter as the string renderer', () => {
    for (const playhead of [2.01, 2.2, 2.42, 2.8, 3]) {
      expect(
        scrambleCharacterForSegment(
          'D',
          config,
          playhead,
          undefined,
          0,
          1,
        ),
      ).toBe(
        scrambleTextForSegment('D', config, playhead, undefined, 0, 1),
      )
    }
  })

  it('keeps the glyph cadence stable when the stagger curve is smooth', () => {
    const smooth = { ...config, smoothing: 'smooth' as const }
    expect(
      scrambleTextForSegment('Depth', smooth, 2.401, undefined, 0, 3),
    ).toBe(scrambleTextForSegment('Depth', smooth, 2.42, undefined, 0, 3))
  })

  it('uses a traveling custom profile for settling without retiming its seed', () => {
    const custom = {
      ...config,
      delay: 0.1,
      staggerCurve: quadraticProfile,
    }
    const linear = { ...custom, staggerCurve: null }

    // Segment 1 is 87.5% through its linear phase but only 76.6% settled on
    // the authored quadratic strip profile at this instant.
    expect(
      scrambleTextForSegment('Depth', custom, 2.975, undefined, 1, 5),
    ).not.toBe('Depth')
    expect(
      scrambleTextForSegment('Depth', linear, 2.975, undefined, 1, 5),
    ).toBe('Depth')

    expect(
      scrambleTextForSegment('Depth', custom, 2.401, undefined, 2, 5),
    ).toBe(scrambleTextForSegment('Depth', custom, 2.42, undefined, 2, 5))
  })

  it('settles an entrance to the original text', () => {
    expect(
      scrambleTextForSegment('Depth', config, 2.9, undefined, 0, 1),
    ).toBe('Depth')
  })

  it('keeps an exit original at first and freezes after its range', () => {
    const exit = { ...config, mode: 'out' as const }
    expect(scrambleTextForSegment('Depth', exit, 2.1, undefined, 0, 1)).toBe(
      'Depth',
    )
    expect(scrambleTextForSegment('Depth', exit, 20, undefined, 0, 1)).toBe(
      scrambleTextForSegment('Depth', exit, 3, undefined, 0, 1),
    )
  })
})
