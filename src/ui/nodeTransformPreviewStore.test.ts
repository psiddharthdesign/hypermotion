// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import {
  commitNodeTransformPreviews,
  createNodeTransformPreviewStore,
  nodeTransformDragOrigin,
} from '@/ui/nodeTransformPreviewStore'

describe('node transform drag preview', () => {
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

  it('coalesces raw pointer packets to one latest display-frame preview', () => {
    const store = createNodeTransformPreviewStore()
    const listener = vi.fn()
    store.subscribe(listener)

    for (let packet = 1; packet <= 250; packet += 1) {
      store.preview({ layer: { x: packet, y: packet * 2 } })
    }

    expect(store.getSnapshot()).toEqual({})
    expect(callbacks.size).toBe(1)
    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(16)

    expect(store.getSnapshot()).toEqual({ layer: { x: 250, y: 500 } })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not touch durable scene state until one release transaction', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    const start = api.getNode(nodeId)!.transform
    const sceneListener = vi.fn()
    api.subscribe(sceneListener)
    const store = createNodeTransformPreviewStore()

    for (let packet = 1; packet <= 250; packet += 1) {
      store.preview({ [nodeId]: { x: packet, y: packet * 2 } })
    }

    expect(api.getNode(nodeId)!.transform).toEqual(start)
    expect(sceneListener).not.toHaveBeenCalled()

    const final = { [nodeId]: { x: 250, y: 500 } }
    commitNodeTransformPreviews(api, final)
    store.finish()

    expect(api.getNode(nodeId)!.transform).toMatchObject(final[nodeId])
    expect(sceneListener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual(final)

    const [, clearPreview] = callbacks.entries().next().value!
    clearPreview(16)
    expect(store.getSnapshot()).toEqual({})
  })

  it('commits multiple selected layers atomically and preserves other axes', () => {
    const api = createSceneAPI()
    const first = api.createNode('rect', null)
    const second = api.createNode('rect', null)
    api.setNodeProperty(first, 'transform', {
      ...api.getNode(first)!.transform,
      z: 24,
      rotation: 18,
    })
    const listener = vi.fn()
    api.subscribe(listener)
    const origins: unknown[] = []
    api.doc.on('afterTransaction', (transaction) => {
      origins.push(transaction.origin)
    })

    commitNodeTransformPreviews(api, {
      [first]: { x: 32, y: 48 },
      [second]: { x: 64, y: 96 },
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(origins).toEqual([UNDOABLE_GESTURE_ORIGIN])
    expect(api.getNode(first)!.transform).toMatchObject({
      x: 32,
      y: 48,
      z: 24,
      rotation: 18,
    })
    expect(api.getNode(second)!.transform).toMatchObject({ x: 64, y: 96 })
  })

  it('clears a pending gesture without publishing or persisting it', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    const start = api.getNode(nodeId)!.transform
    const listener = vi.fn()
    api.subscribe(listener)
    const store = createNodeTransformPreviewStore()

    store.preview({ [nodeId]: { x: 80, y: 120 } })
    store.clear()

    expect(callbacks.size).toBe(0)
    expect(store.getSnapshot()).toEqual({})
    expect(api.getNode(nodeId)!.transform).toEqual(start)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps static and active-track drag origins distinct', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    api.setNodeProperty(nodeId, 'transform', {
      ...api.getNode(nodeId)!.transform,
      x: 40,
      y: 60,
    })

    expect(
      nodeTransformDragOrigin(api.getNode(nodeId)!, { x: 140, y: 180 }),
    ).toEqual({
      display: { x: 140, y: 180 },
      static: { x: 40, y: 60 },
      author: { x: 140, y: 180 },
    })
  })

  it('separates displayed motion-path offset from static and track values', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null, {
      transform: {
        x: 40,
        y: 60,
        z: 0,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
        scaleX: 1,
        scaleY: 1,
      },
      motionPath: {
        version: 1,
        progress: 0.5,
        autoOrient: false,
        rotationOffset: 0,
        parameterization: 'parametric',
        points: [
          {
            id: 'start',
            t: 0,
            x: 0,
            y: 0,
            z: 0,
            inX: 0,
            inY: 0,
            inZ: 0,
            outX: 0,
            outY: 0,
            outZ: 0,
          },
          {
            id: 'end',
            t: 1,
            x: 100,
            y: 0,
            z: 0,
            inX: 100,
            inY: 0,
            inZ: 0,
            outX: 100,
            outY: 0,
            outZ: 0,
          },
        ],
      },
    })
    const node = api.getNode(nodeId)!

    expect(
      nodeTransformDragOrigin(node, {
        x: 170,
        y: 80,
        motionPathProgress: 0.5,
      }),
    ).toEqual({
      display: { x: 170, y: 80 },
      static: { x: 40, y: 60 },
      author: { x: 120, y: 80 },
    })
  })
})
