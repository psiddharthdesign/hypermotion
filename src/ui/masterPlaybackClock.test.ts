// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest'
import { createMasterFrameGate, createMasterPlaybackClock } from './masterPlaybackClock'

describe('Master playback clock', () => {
  it('does not evaluate a 60 fps scene 120 times per second', () => {
    const shouldEvaluate = createMasterFrameGate(60)
    const frames = Array.from({ length: 120 }, (_, i) => i * 1000 / 120)
    expect(frames.filter(shouldEvaluate)).toHaveLength(60)
    const filmGate = createMasterFrameGate(24)
    expect(frames.filter(filmGate)).toHaveLength(24)
  })
  it('publishes every display frame independently of the 20 Hz UI mirror', () => {
    const clock = createMasterPlaybackClock()
    const display = vi.fn()
    const unsubscribe = clock.subscribe(display)
    let uiUpdates = 0
    for (let frame = 1; frame <= 60; frame++) {
      clock.publish(frame / 60)
      if (frame % 3 === 0) uiUpdates++
    }
    expect(uiUpdates).toBe(20)
    expect(display).toHaveBeenCalledTimes(60)
    expect(clock.getSnapshot()).toBe(1)
    unsubscribe()
    clock.publish(2)
    expect(display).toHaveBeenCalledTimes(60)
  })

  it('keeps exact between-sample pause time and supports backward seeks', () => {
    const clock = createMasterPlaybackClock()
    clock.publish(12.183)
    expect(clock.getSnapshot()).toBe(12.183)
    clock.publish(0)
    expect(clock.getSnapshot()).toBe(0)
    clock.publish(Number.NaN)
    expect(clock.getSnapshot()).toBe(0)
  })
})
