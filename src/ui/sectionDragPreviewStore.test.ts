// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Section } from '@/scene'
import { createSceneAPI } from '@/scene/doc'
import {
  createSectionDragPreviewStore,
  createSectionDragSession,
} from '@/ui/sectionDragPreviewStore'

const chapter = (id: string, start: number, end: number): Section => ({
  id,
  name: id,
  color: '#3388ff',
  start,
  end,
})

describe('chapter drag preview', () => {
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

  it('coalesces 250 resize packets and commits adjacent chapters once', () => {
    const api = createSceneAPI()
    const left = chapter('left', 0, 2)
    const right = chapter('right', 2, 4)
    api.doc.transact(() => {
      api.setSection(left)
      api.setSection(right)
    })
    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)
    const store = createSectionDragPreviewStore()
    const session = createSectionDragSession(api, store)

    for (let packet = 1; packet <= 250; packet += 1) {
      const boundary = 2 + packet / 250
      session.preview([
        { ...left, end: boundary },
        { ...right, start: boundary },
      ])
    }

    expect(listener).not.toHaveBeenCalled()
    expect(api.getSections()).toEqual([left, right])
    expect(callbacks.size).toBe(1)
    session.commit()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(api.getSections().map(({ id, start, end }) => ({ id, start, end }))).toEqual([
      { id: 'left', start: 0, end: 3 },
      { id: 'right', start: 3, end: 4 },
    ])
    unsubscribe()
  })

  it('publishes only the latest preview and cancels without scene writes', () => {
    const api = createSceneAPI()
    const section = chapter('chapter', 1, 2)
    api.setSection(section)
    const listener = vi.fn()
    api.subscribe(listener)
    const store = createSectionDragPreviewStore()
    const previewListener = vi.fn()
    store.subscribe(section.id, previewListener)
    const session = createSectionDragSession(api, store)

    session.preview([{ ...section, end: 2.5 }])
    session.preview([{ ...section, end: 3 }])
    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(16)

    expect(store.getSection(section.id, section).end).toBe(3)
    expect(previewListener).toHaveBeenCalledTimes(1)
    session.cancel()
    expect(store.getSection(section.id, section)).toBe(section)
    expect(listener).not.toHaveBeenCalled()
  })
})
