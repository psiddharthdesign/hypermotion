// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCameraPreviewStore } from '@/ui/cameraPreviewStore'

describe('camera preview store', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextFrameId: number
  const runNextFrame = (timestamp = 16) => {
    const next = callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined
    if (!next) return
    callbacks.delete(next[0])
    next[1](timestamp)
  }

  beforeEach(() => {
    callbacks = new Map()
    nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++
      callbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      callbacks.delete(id)
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('coalesces pointer packets to the latest display-frame value', () => {
    const store = createCameraPreviewStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set('camera', { x: 10 })
    store.set('camera', { x: 25 })

    expect(store.getSnapshot()).toBeUndefined()
    expect(callbacks.size).toBe(1)
    runNextFrame()

    expect(store.getSnapshot()).toEqual({
      cameraId: 'camera',
      value: { x: 25 },
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending preview without publishing it', () => {
    const store = createCameraPreviewStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set('camera', { z: 100 })
    store.clear('camera')

    expect(callbacks.size).toBe(0)
    expect(store.getSnapshot()).toBeUndefined()
    expect(listener).not.toHaveBeenCalled()
  })

  it('flushes the final packet and holds it for one paint after commit', () => {
    const store = createCameraPreviewStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set('camera', { z: 180 })
    store.finish('camera')

    expect(store.getSnapshot()).toEqual({
      cameraId: 'camera',
      value: { z: 180 },
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(callbacks.size).toBe(1)

    runNextFrame()
    expect(store.getSnapshot()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('lets a new preview cancel the preceding deferred clear', () => {
    const store = createCameraPreviewStore()

    store.set('camera', { z: 100 })
    runNextFrame()
    store.finish('camera')
    expect(callbacks.size).toBe(1)

    store.set('camera', { z: 140 })
    expect(callbacks.size).toBe(1)
    runNextFrame(32)

    expect(store.getSnapshot()).toEqual({
      cameraId: 'camera',
      value: { z: 140 },
    })
    expect(callbacks.size).toBe(0)
  })
})
