// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultTextMotionPath, textStaggerCurveForPreset } from '@/anim'
import { createTextStaggerCurvePreviewStore } from './textStaggerCurvePreviewStore'

describe('text stagger curve preview store', () => {
  let callbacks: Map<number, FrameRequestCallback>
  let nextFrameId: number

  beforeEach(() => {
    callbacks = new Map()
    nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++
      callbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  })

  afterEach(() => vi.unstubAllGlobals())

  const runNextFrame = () => {
    const next = callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined
    if (!next) return
    callbacks.delete(next[0])
    next[1](16)
  }

  it('coalesces pointer packets and previews only targeted text nodes', () => {
    const store = createTextStaggerCurvePreviewStore()
    const first = textStaggerCurveForPreset('soft')
    const latest = textStaggerCurveForPreset('smooth')
    const nodeListener = vi.fn()
    const allListener = vi.fn()
    store.subscribe('title', nodeListener)
    store.subscribeAll(allListener)

    store.preview(['title', 'subtitle'], { curve: first })
    store.preview(['title', 'subtitle'], { curve: latest })

    expect(store.getPreview('title')).toBeUndefined()
    expect(callbacks.size).toBe(1)
    runNextFrame()

    expect(store.getPreview('title')?.curve).toBe(latest)
    expect(store.getPreview('subtitle')?.curve).toBe(latest)
    expect(store.getPreview('other')).toBeUndefined()
    expect(nodeListener).toHaveBeenCalledTimes(1)
    expect(allListener).toHaveBeenCalledTimes(1)
  })

  it('cancels without persistence and releases a finished preview next paint', () => {
    const store = createTextStaggerCurvePreviewStore()
    const curve = textStaggerCurveForPreset('smooth')

    store.preview(['title'], { curve })
    store.cancel()
    expect(callbacks.size).toBe(0)
    expect(store.getPreview('title')).toBeUndefined()

    store.preview(['title'], { curve, duration: 1.2 })
    store.finish()
    expect(store.getPreview('title')).toEqual({ curve, duration: 1.2 })
    expect(callbacks.size).toBe(1)
    runNextFrame()
    expect(store.getPreview('title')).toBeUndefined()
  })

  it('coalesces editable spatial-path previews through the same render lane', () => {
    const store = createTextStaggerCurvePreviewStore()
    const path = defaultTextMotionPath()

    store.preview(['title'], { motionPath: path })
    store.flush()

    expect(store.getPreview('title')?.motionPath).toBe(path)
    expect(callbacks.size).toBe(0)
    store.cancel()
    expect(store.getPreview('title')).toBeUndefined()
  })
})
