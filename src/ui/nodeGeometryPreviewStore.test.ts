// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import {
  commitNodeGeometryPreviews,
  createNodeGeometryPreviewStore,
  sceneAPIWithNodeGeometryPreviews,
} from '@/ui/nodeGeometryPreviewStore'

describe('node geometry preview', () => {
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

  it('coalesces 250 raw packets into one latest display-frame preview', () => {
    const store = createNodeGeometryPreviewStore()
    const listener = vi.fn()
    store.subscribe(listener)

    for (let packet = 1; packet <= 250; packet += 1) {
      store.preview({ text: { fontSize: packet, size: { width: packet * 2 } } })
    }

    expect(store.getSnapshot()).toEqual({})
    expect(callbacks.size).toBe(1)
    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(16)

    expect(store.getSnapshot()).toEqual({
      text: { fontSize: 250, size: { width: 500 } },
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the active-node snapshot stable while only preview values change', () => {
    const store = createNodeGeometryPreviewStore()
    const emptyNodeIds = store.getActiveNodeIdsSnapshot()
    const flushFrame = (time: number) => {
      const [frameId, callback] = callbacks.entries().next().value!
      callbacks.delete(frameId)
      callback(time)
    }

    store.preview({
      text: { size: { width: 320 } },
      badge: { fontSize: 14 },
    })
    flushFrame(16)
    const activeNodeIds = store.getActiveNodeIdsSnapshot()
    expect(activeNodeIds).toEqual(['badge', 'text'])

    store.preview({
      badge: { fontSize: 18 },
      text: { size: { width: 480 } },
    })
    flushFrame(32)
    expect(store.getActiveNodeIdsSnapshot()).toBe(activeNodeIds)

    store.preview({ text: { size: { width: 640 } } })
    flushFrame(48)
    expect(store.getActiveNodeIdsSnapshot()).not.toBe(activeNodeIds)
    expect(store.getActiveNodeIdsSnapshot()).toEqual(['text'])

    store.clear()
    expect(store.getActiveNodeIdsSnapshot()).toBe(emptyNodeIds)
  })

  it('overlays getNode and getChildren without touching durable scene data', () => {
    const api = createSceneAPI()
    const parentId = api.createNode('frame', null)
    const textId = api.createNode('text', parentId)
    const authored = api.getNode(textId)!
    if (authored.kind !== 'text') throw new Error('expected text fixture')
    const previewApi = sceneAPIWithNodeGeometryPreviews(api, {
      [textId]: {
        size: { width: 480 },
        fontSize: 42,
        lineHeight: 1.35,
        letterSpacing: 0.5,
      },
    })

    expect(previewApi.getNode(textId)).toMatchObject({
      size: { width: 480, height: authored.size.height },
      fontSize: 42,
      lineHeight: 1.35,
      letterSpacing: 0.5,
    })
    expect(previewApi.getChildren(parentId)[0]).toMatchObject({
      id: textId,
      size: { width: 480, height: authored.size.height },
      fontSize: 42,
    })
    expect(api.getNode(textId)).toEqual(authored)
    expect(sceneAPIWithNodeGeometryPreviews(api, {})).toBe(api)
  })

  it('keeps durable state unchanged until one atomic release transaction', () => {
    const api = createSceneAPI()
    const textId = api.createNode('text', null)
    const rectId = api.createNode('rect', null)
    const start = api.getNode(textId)!
    const rectStart = api.getNode(rectId)!
    if (start.kind !== 'text') throw new Error('expected text fixture')
    if (rectStart.kind !== 'rect') throw new Error('expected rect fixture')
    const sceneListener = vi.fn()
    const onCommit = vi.fn()
    const origins: unknown[] = []
    api.subscribe(sceneListener)
    api.doc.on('afterTransaction', (transaction) => {
      origins.push(transaction.origin)
    })
    const store = createNodeGeometryPreviewStore()

    for (let packet = 1; packet <= 250; packet += 1) {
      store.preview({
        [textId]: {
          size: { width: packet * 2 },
          fontSize: packet,
        },
      })
    }

    expect(api.getNode(textId)).toEqual(start)
    expect(api.getNode(rectId)).toEqual(rectStart)
    expect(sceneListener).not.toHaveBeenCalled()
    expect(origins).toEqual([])

    const final = {
      [textId]: {
        size: { width: 500 },
        fontSize: 48,
        lineHeight: 1.25,
        letterSpacing: 0.75,
      },
      [rectId]: { size: { height: 360 } },
    }
    store.preview(final)
    commitNodeGeometryPreviews(api, final, onCommit)
    store.finish()

    expect(api.getNode(textId)).toMatchObject({
      size: { width: 500, height: start.size.height },
      fontSize: 48,
      lineHeight: 1.25,
      letterSpacing: 0.75,
    })
    expect(api.getNode(rectId)).toMatchObject({
      size: { width: rectStart.size.width, height: 360 },
    })
    expect(sceneListener).toHaveBeenCalledTimes(1)
    expect(origins).toEqual([UNDOABLE_GESTURE_ORIGIN])
    expect(onCommit).toHaveBeenCalledWith(textId, final[textId])
    expect(onCommit).toHaveBeenCalledWith(rectId, final[rectId])
    expect(store.getSnapshot()).toEqual(final)

    const [, clearPreview] = callbacks.entries().next().value!
    clearPreview(32)
    expect(store.getSnapshot()).toEqual({})
  })

  it('cancels a pending gesture without publishing or persisting it', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    const start = api.getNode(nodeId)!
    const sceneListener = vi.fn()
    api.subscribe(sceneListener)
    const store = createNodeGeometryPreviewStore()

    store.preview({ [nodeId]: { size: { width: 640, height: 360 } } })
    store.cancel()

    expect(callbacks.size).toBe(0)
    expect(store.getSnapshot()).toEqual({})
    expect(api.getNode(nodeId)).toEqual(start)
    expect(sceneListener).not.toHaveBeenCalled()
  })
})
