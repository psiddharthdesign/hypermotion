// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { solveLayout, yogaReady } from '@/layout'
import { createSceneAPI } from '@/scene/doc'
import type { Layout } from '@/scene/types'
import {
  createNodeLayoutPreviewStore,
  sceneAPIWithNodeLayoutPreviews,
} from '@/ui/nodeLayoutPreviewStore'

const rowLayout: Layout = {
  mode: 'flex',
  direction: 'row',
  justify: 'start',
  align: 'start',
  gap: 10,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  wrap: false,
  columns: 1,
  rowGap: 0,
  columnGap: 0,
}

describe('node layout preview', () => {
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

  const flushFrame = (time = 16) => {
    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(time)
  }

  it('solves the latest gap preview before commit without mutating the scene', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 100 },
      layout: rowLayout,
    })
    api.createNode('rect', root, { size: { width: 50, height: 20 } })
    const second = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })
    const store = createNodeLayoutPreviewStore()

    for (let packet = 11; packet <= 40; packet += 1) {
      store.preview({ [root]: { gap: packet } })
    }

    expect(store.getSnapshot()).toEqual({})
    expect(callbacks.size).toBe(1)
    flushFrame()

    const previewApi = sceneAPIWithNodeLayoutPreviews(api, store.getSnapshot())
    const solved = solveLayout(await yogaReady, previewApi, root, {
      width: 300,
      height: 100,
    })

    expect(solved[second]).toMatchObject({ x: 90, y: 0 })
    expect(api.getNode(root)).toMatchObject({ layout: { gap: 10 } })
  })

  it('previews partial padding and clearing restores the authored solve', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, {
      size: { width: 300, height: 100 },
      layout: rowLayout,
    })
    const child = api.createNode('rect', root, {
      size: { width: 50, height: 20 },
    })
    const store = createNodeLayoutPreviewStore()

    store.preview({ [root]: { padding: { top: 16, left: 24 } } })
    flushFrame()

    const previewSolved = solveLayout(
      await yogaReady,
      sceneAPIWithNodeLayoutPreviews(api, store.getSnapshot()),
      root,
      { width: 300, height: 100 },
    )
    expect(previewSolved[child]).toMatchObject({ x: 24, y: 16 })
    expect(api.getNode(root)).toMatchObject({
      layout: { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    })

    store.clear()
    const restoredSolved = solveLayout(
      await yogaReady,
      sceneAPIWithNodeLayoutPreviews(api, store.getSnapshot()),
      root,
      { width: 300, height: 100 },
    )
    expect(restoredSolved[child]).toMatchObject({ x: 0, y: 0 })
  })
})
