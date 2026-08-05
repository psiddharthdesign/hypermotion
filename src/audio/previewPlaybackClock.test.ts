// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  previewAudioLocalDrift,
  resolvePreviewAudioClock,
  shouldSeekPreviewMediaElement,
} from './previewPlaybackClock'

describe('preview audio clock', () => {
  it('stops a non-looping clip after one trimmed cycle', () => {
    const before = resolvePreviewAudioClock({
      timelineTime: 4.9,
      startTime: 1,
      trimStart: 2,
      trimEnd: 6,
      playbackRate: 1,
      loop: false,
    })
    const ended = resolvePreviewAudioClock({
      timelineTime: 5,
      startTime: 1,
      trimStart: 2,
      trimEnd: 6,
      playbackRate: 1,
      loop: false,
    })

    expect(before.active).toBe(true)
    expect(before.localTime).toBeCloseTo(5.9)
    expect(ended.active).toBe(false)
    expect(ended.localTime).toBe(6)
  })

  it('keeps a loop active and wraps inside its trimmed source range', () => {
    const clock = resolvePreviewAudioClock({
      timelineTime: 10.5,
      startTime: 1,
      trimStart: 2,
      trimEnd: 5,
      playbackRate: 1,
      loop: true,
    })

    expect(clock.active).toBe(true)
    expect(clock.sourceClipDuration).toBe(3)
    expect(clock.timelineClipDuration).toBe(3)
    expect(clock.localTime).toBeCloseTo(2.5)
  })

  it('applies playback rate before wrapping', () => {
    const clock = resolvePreviewAudioClock({
      timelineTime: 4,
      startTime: 1,
      trimStart: 3,
      trimEnd: 5,
      playbackRate: 2,
      loop: true,
    })

    expect(clock.timelineClipDuration).toBe(1)
    expect(clock.localTime).toBe(3)
  })

  it('stays inactive before the clip starts', () => {
    expect(
      resolvePreviewAudioClock({
        timelineTime: 0.5,
        startTime: 1,
        trimStart: 2,
        trimEnd: 4,
        playbackRate: 1,
        loop: true,
      }),
    ).toMatchObject({ active: false, localTime: 2 })
  })
})

describe('preview audio drift', () => {
  it('measures looped positions across the seam', () => {
    expect(
      previewAudioLocalDrift({
        actualTime: 7.95,
        expectedTime: 2.05,
        trimStart: 2,
        trimEnd: 8,
        loop: true,
      }),
    ).toBeCloseTo(0.1)
  })

  it('preserves linear drift for one-shot clips', () => {
    expect(
      previewAudioLocalDrift({
        actualTime: 7.95,
        expectedTime: 2.05,
        trimStart: 2,
        trimEnd: 8,
        loop: false,
      }),
    ).toBeCloseTo(5.9)
  })

  it('seeks the media fallback after it crosses a trimmed loop boundary', () => {
    expect(
      shouldSeekPreviewMediaElement({
        currentTime: 8.01,
        expectedTime: 2.01,
        trimStart: 2,
        trimEnd: 8,
        loop: true,
        paused: false,
        tolerance: 0.35,
      }),
    ).toBe(true)
    expect(
      shouldSeekPreviewMediaElement({
        currentTime: 7.95,
        expectedTime: 2.05,
        trimStart: 2,
        trimEnd: 8,
        loop: true,
        paused: false,
        tolerance: 0.35,
      }),
    ).toBe(false)
  })
})
