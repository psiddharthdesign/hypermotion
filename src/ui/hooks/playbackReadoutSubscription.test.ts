// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribePlaybackReadout } from './playbackReadoutSubscription'

afterEach(() => vi.useRealTimers())

describe('inspector playback budget', () => {
  it('halves 60 fps readout work while delivering the latest paused value immediately', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    let tick = () => {}
    let playing = true
    const unsubscribe = vi.fn()
    const source = {
      subscribe: (cb: () => void) => { tick = cb; return unsubscribe },
      isPlaying: () => playing,
    }
    let frame = 0
    const values: number[] = []
    const stop = subscribePlaybackReadout(source, () => values.push(frame))
    for (frame = 1; frame <= 60; frame++) {
      vi.advanceTimersByTime(1000 / 60)
      tick()
    }
    expect(values.length).toBeGreaterThanOrEqual(29)
    expect(values.length).toBeLessThanOrEqual(31)
    playing = false
    frame = 60
    tick()
    expect(values.at(-1)).toBe(60)
    const calls = values.length
    stop()
    vi.advanceTimersByTime(100)
    expect(values).toHaveLength(calls)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not throttle paused scrubbing or leave pending work on unmount', () => {
    vi.useFakeTimers()
    let tick = () => {}
    let playing = false
    const listener = vi.fn()
    const stop = subscribePlaybackReadout({
      subscribe: (cb) => { tick = cb; return () => {} },
      isPlaying: () => playing,
    }, listener)
    tick(); tick(); tick()
    expect(listener).toHaveBeenCalledTimes(3)
    playing = true
    tick()
    stop()
    vi.runAllTimers()
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
