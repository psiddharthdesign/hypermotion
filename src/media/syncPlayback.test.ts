// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { syncMediaPlayback } from './syncPlayback'

function createMedia() {
  let currentTime = 0
  const seeks: number[] = []
  const media = {
    readyState: 4,
    duration: 30,
    paused: true,
    seeking: false,
    get currentTime() { return currentTime },
    set currentTime(value: number) {
      currentTime = value
      seeks.push(value)
      media.seeking = true
    },
    load: vi.fn(),
    play: vi.fn(async () => { media.paused = false }),
    pause: vi.fn(() => { media.paused = true }),
  }
  return { media: media as unknown as HTMLMediaElement, state: media, seeks }
}

describe('timeline media playback', () => {
  it('lets slow metadata loading finish without restarting it every frame', () => {
    const { media, state } = createMedia()
    state.readyState = 0
    for (let frame = 0; frame < 60; frame++) {
      syncMediaPlayback(media, frame / 60, true, frame * 1000 / 60)
    }
    expect(state.load).not.toHaveBeenCalled()
    expect(state.play).not.toHaveBeenCalled()

    state.readyState = 4
    syncMediaPlayback(media, 1, true, 1000)
    expect(state.currentTime).toBe(1)
    expect(state.play).toHaveBeenCalledOnce()
  })

  it('does not replace an in-flight seek as the playhead advances', () => {
    const { media, state, seeks } = createMedia()
    syncMediaPlayback(media, 2, true, 0)
    // A long-GOP clip can take longer than the drift threshold to seek.
    for (let frame = 1; frame <= 120; frame++) {
      syncMediaPlayback(media, 2 + frame / 60, true, frame * 1000 / 60)
    }
    expect(seeks).toEqual([2])
    expect(state.play).toHaveBeenCalledOnce()

    state.seeking = false
    syncMediaPlayback(media, 4.1, true, 2100)
    expect(seeks).toEqual([2])
    // Drift correction resumes after allowing the decoder time to progress.
    syncMediaPlayback(media, 5.1, true, 3100)
    expect(seeks).toEqual([2, 5.1])
  })

  it('does not interrupt buffering to chase the timeline', () => {
    const { media, state, seeks } = createMedia()
    state.paused = false
    state.readyState = 1
    syncMediaPlayback(media, 5, true, 2000)
    expect(seeks).toEqual([])
    state.readyState = 4
    syncMediaPlayback(media, 5.1, true, 2100)
    expect(seeks).toEqual([5.1])
  })

  it('throttles repeated drift corrections even when seeks finish quickly', () => {
    const { media, state, seeks } = createMedia()
    state.paused = false
    syncMediaPlayback(media, 1, true, 0)
    state.seeking = false
    syncMediaPlayback(media, 1.5, true, 500)
    expect(seeks).toEqual([1])
    syncMediaPlayback(media, 2, true, 1000)
    expect(seeks).toEqual([1, 2])
  })

  it('keeps ordinary playback within tolerance without seeking', () => {
    const { media, state, seeks } = createMedia()
    state.paused = false
    syncMediaPlayback(media, 0.1, true, 0)
    expect(seeks).toEqual([])
    expect(state.play).not.toHaveBeenCalled()
  })

  it('pauses immediately and allows scrubbing/export to replace pending seeks', () => {
    const { media, state, seeks } = createMedia()
    syncMediaPlayback(media, 3, true, 0)
    syncMediaPlayback(media, 7, false, 16)
    syncMediaPlayback(media, 8, false, 32)
    expect(state.pause).toHaveBeenCalledOnce()
    expect(seeks).toEqual([3, 7, 8])
  })

  it('seeks back on timeline restart and resumes at the requested trim offset', () => {
    const { media, state, seeks } = createMedia()
    syncMediaPlayback(media, 10, false, 0)
    state.seeking = false
    syncMediaPlayback(media, 2, true, 16)
    expect(seeks).toEqual([10, 2])
    expect(state.play).toHaveBeenCalledOnce()
  })

  it('seeks every paused frame and corrects a small offset when starting playback', () => {
    const { media, state, seeks } = createMedia()
    for (let frame = 0; frame < 5; frame++) {
      syncMediaPlayback(media, 5 + frame / 60, false, frame * 17)
      state.seeking = false
    }
    expect(seeks).toEqual(Array.from({length: 5}, (_, frame) => 5 + frame / 60))
    syncMediaPlayback(media, 5, true, 100)
    expect(seeks.at(-1)).toBe(5)
  })

  it('bounds seeks and ignores non-finite target times', () => {
    const { media, seeks } = createMedia()
    syncMediaPlayback(media, 100, false, 0)
    syncMediaPlayback(media, -1, false, 16)
    syncMediaPlayback(media, NaN, false, 32)
    expect(seeks).toEqual([30, 0])
  })
})
