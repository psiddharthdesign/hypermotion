// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FrameReadyBarrier,
  FrameReadyCancelledError,
  FrameReadyDisposedError,
  FrameReadyTimeoutError,
} from './frameReady'

afterEach(() => {
  vi.useRealTimers()
})

describe('FrameReadyBarrier', () => {
  it('allocates monotonic token and pass identities', async () => {
    const barrier = new FrameReadyBarrier()
    const first = barrier.begin()
    const second = barrier.begin({ pass: 7 })
    const third = barrier.begin()

    expect(first.identity).toEqual({ token: 1, pass: 1 })
    expect(second.identity).toEqual({ token: 2, pass: 7 })
    expect(third.identity).toEqual({ token: 3, pass: 8 })
    expect(() => barrier.begin({ pass: 7 })).toThrow(/stale/)

    barrier.acknowledge(first.identity)
    barrier.acknowledge(second.identity)
    barrier.acknowledge(third.identity)
    await Promise.all([first.promise, second.promise, third.promise])
  })

  it('resolves only an exact token and pass acknowledgement', async () => {
    const barrier = new FrameReadyBarrier()
    const request = barrier.begin()
    let settled = false
    void request.promise.then(() => {
      settled = true
    })

    expect(
      barrier.acknowledge({
        token: request.identity.token - 1,
        pass: request.identity.pass,
      }),
    ).toBe(false)
    expect(
      barrier.acknowledge({
        token: request.identity.token,
        pass: request.identity.pass + 1,
      }),
    ).toBe(false)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(barrier.pendingCount).toBe(1)

    expect(barrier.acknowledge(request.identity)).toBe(true)
    await expect(request.promise).resolves.toEqual(request.identity)
    expect(settled).toBe(true)
    expect(barrier.pendingCount).toBe(0)
    expect(barrier.acknowledge(request.identity)).toBe(false)
  })

  it('rejects and removes a request when its timeout expires', async () => {
    vi.useFakeTimers()
    const barrier = new FrameReadyBarrier({ timeoutMs: 25 })
    const request = barrier.begin()
    const rejection = expect(request.promise).rejects.toMatchObject({
      name: 'FrameReadyTimeoutError',
      identity: request.identity,
      timeoutMs: 25,
    })

    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(barrier.pendingCount).toBe(0)
    expect(barrier.acknowledge(request.identity)).toBe(false)
    expect(new FrameReadyTimeoutError(request.identity, 25)).toBeInstanceOf(
      Error,
    )
  })

  it('supports targeted cancellation without disturbing other requests', async () => {
    const barrier = new FrameReadyBarrier()
    const cancelled = barrier.begin()
    const ready = barrier.begin()
    const rejection = expect(cancelled.promise).rejects.toBeInstanceOf(
      FrameReadyCancelledError,
    )

    expect(cancelled.cancel('superseded')).toBe(true)
    await rejection
    expect(cancelled.cancel()).toBe(false)
    expect(barrier.pendingCount).toBe(1)

    barrier.acknowledge(ready.identity)
    await expect(ready.promise).resolves.toEqual(ready.identity)
  })

  it('cancels every outstanding request on cancellation or disposal', async () => {
    const barrier = new FrameReadyBarrier()
    const first = barrier.begin()
    const second = barrier.begin()
    const firstRejection = expect(first.promise).rejects.toBeInstanceOf(
      FrameReadyCancelledError,
    )
    const secondRejection = expect(second.promise).rejects.toBeInstanceOf(
      FrameReadyCancelledError,
    )

    expect(barrier.cancelAll('new export')).toBe(2)
    await Promise.all([firstRejection, secondRejection])
    expect(barrier.pendingCount).toBe(0)

    const outstanding = barrier.begin()
    const disposed = expect(outstanding.promise).rejects.toBeInstanceOf(
      FrameReadyDisposedError,
    )
    expect(barrier.dispose('worker closed')).toBe(1)
    await disposed
    expect(barrier.isDisposed).toBe(true)
    expect(barrier.dispose()).toBe(0)
    expect(() => barrier.begin()).toThrow(FrameReadyDisposedError)
  })
})
