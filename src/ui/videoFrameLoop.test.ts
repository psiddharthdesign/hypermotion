// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startVideoFrameLoop } from './videoFrameLoop'

afterEach(() => vi.unstubAllGlobals())

function fixture(decodedFrames = false) {
  const pending = new Map<number, () => void>()
  let id = 0
  const request = vi.fn((cb: () => void) => {
    pending.set(++id, cb)
    return id
  })
  const cancel = vi.fn((handle: number) => pending.delete(handle))
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  const video = Object.assign(new EventTarget(), {
    paused: false, ended: false, currentTime: 0,
    ...(decodedFrames ? {
      requestVideoFrameCallback: request, cancelVideoFrameCallback: cancel,
    } : {}),
  }) as unknown as HTMLVideoElement
  const frame = () => {
    const entry = pending.entries().next().value!
    pending.delete(entry[0])
    entry[1]()
  }
  return { video, pending, frame }
}

describe('video preview scheduling', () => {
  it('owns exactly one loop and cancels it completely', () => {
    const { video, pending, frame } = fixture()
    const stop = startVideoFrameLoop(video, vi.fn(), true)
    expect(pending.size).toBe(1)
    frame()
    expect(pending.size).toBe(1)
    stop()
    expect(pending.size).toBe(0)
  })

  it('draws once when paused without scheduling a loop', () => {
    const { video, pending } = fixture()
    const draw = vi.fn()
    const stop = startVideoFrameLoop(video, draw, false)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(pending.size).toBe(0)
    stop()
  })

  it('uses decoded frames and cancels callbacks after repeated starts', () => {
    const { video, pending, frame } = fixture(true)
    const draw = vi.fn()
    for (let i = 0; i < 20; i++) {
      const stop = startVideoFrameLoop(video, draw, true)
      expect(pending.size).toBe(1)
      frame()
      expect(pending.size).toBe(1)
      stop()
      expect(pending.size).toBe(0)
    }
    expect(draw).toHaveBeenCalledTimes(40)
  })

  it('waits for asynchronous playback to start and skips duplicate fallback frames', () => {
    const { video, pending, frame } = fixture()
    Object.assign(video, { paused: true })
    const draw = vi.fn()
    const stop = startVideoFrameLoop(video, draw, true)
    expect(pending.size).toBe(0)
    Object.assign(video, { paused: false })
    video.dispatchEvent(new Event('playing'))
    video.dispatchEvent(new Event('playing'))
    expect(pending.size).toBe(1)
    frame()
    expect(draw).toHaveBeenCalledTimes(1)
    video.currentTime = 0.04
    frame()
    expect(draw).toHaveBeenCalledTimes(2)
    stop()
    video.dispatchEvent(new Event('playing'))
    expect(pending.size).toBe(0)
  })
})
