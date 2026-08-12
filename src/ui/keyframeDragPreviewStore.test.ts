// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import type { Track } from '@/scene'
import { getAnimEngine } from '@/anim'
import {
  DEFAULT_TEXT_ANIMATION,
  textAnimationDefaults,
} from '@/anim/textAnimations'
import {
  setStaggerSetDelayMetadata,
  toggleStaggerSetPropertyKeyframes,
  type StaggerPropertyTarget,
} from '@/anim/staggerSets'
import {
  createKeyframeDragPreviewStore,
  createKeyframeDragSession,
} from '@/ui/keyframeDragPreviewStore'

describe('keyframe drag preview', () => {
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
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      callbacks.delete(id)
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('coalesces pointer packets without scene writes and commits once on release', () => {
    const api = createSceneAPI()
    const trackA: Track = {
      id: 'track-a',
      nodeId: 'node-a',
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'a-1', time: 1, value: 0 },
        { id: 'a-2', time: 2, value: 100 },
      ],
    }
    const trackB: Track = {
      id: 'track-b',
      nodeId: 'node-b',
      propertyId: 'transform.y',
      defaultEasing: 'ease-out',
      keyframes: [{ id: 'b-1', time: 3, value: 50 }],
    }
    api.setTrack(trackA)
    api.setTrack(trackB)

    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)
    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(
      api,
      [
        { trackId: 'track-a', kfId: 'a-1', startTime: 1 },
        { trackId: 'track-b', kfId: 'b-1', startTime: 3 },
      ],
      store,
    )

    for (let packet = 1; packet <= 250; packet++) {
      session.preview(packet / 100)
    }

    expect(listener).not.toHaveBeenCalled()
    expect(api.getTrack('track-a')?.keyframes[0]?.time).toBe(1)
    expect(callbacks.size).toBe(1)

    session.commit()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(
      api.getTrack('track-a')?.keyframes.find((keyframe) => keyframe.id === 'a-1')
        ?.time,
    ).toBe(3.5)
    expect(api.getTrack('track-b')?.keyframes[0]?.time).toBe(5.5)
    unsubscribe()
  })

  it('moves the linked bundle when a drag begins from a follower layer', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const layers = ['A', 'B', 'C'].map((name) =>
      api.createNode('frame', root, { name }),
    )
    const targets: StaggerPropertyTarget[] = layers.map((nodeId, index) => ({
      nodeId,
      currentValue: index * 10,
    }))
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      1,
      {
        setId: 'drag-set',
        layerIds: layers,
        delay: 0.1,
        order: 'forward',
      },
    )
    const followerTrack = api
      .getTracksForNode(layers[1]!)
      .find((track) => track.propertyId === 'transform.x')!
    const followerKeyframe = followerTrack.keyframes[0]!
    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(
      api,
      [
        {
          trackId: followerTrack.id,
          kfId: followerKeyframe.id,
          startTime: followerKeyframe.time,
        },
      ],
      store,
    )

    session.preview(0.5)
    session.commit()

    expect(
      layers.map(
        (nodeId) =>
          api
            .getTracksForNode(nodeId)
            .find((track) => track.propertyId === 'transform.x')!.keyframes[0]!
            .time,
      ),
    ).toEqual([1.5, 1.6, 1.7])
  })

  it('undoes one stagger group-edge scale as one complete gesture', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const layers = ['A', 'B', 'C'].map((name) =>
      api.createNode('frame', root, { name }),
    )
    const targets: StaggerPropertyTarget[] = layers.map((nodeId) => ({
      nodeId,
      currentValue: 0,
    }))
    const options = {
      setId: 'scale-set',
      layerIds: layers,
      delay: 0.1,
      order: 'forward' as const,
    }
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      1,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      2,
      options,
    )
    const members = layers.flatMap((nodeId) => {
      const track = api
        .getTracksForNode(nodeId)
        .find((candidate) => candidate.propertyId === 'transform.x')!
      return track.keyframes.map((keyframe) => ({
        trackId: track.id,
        kfId: keyframe.id,
        startTime: keyframe.time,
      }))
    })
    const before = members.map((member) => member.startTime)
    const scene = api.doc.getMap('scene')
    const undo = new Y.UndoManager(
      [
        scene,
        scene.get('tracks') as Y.Map<unknown>,
        scene.get('uiState') as Y.Map<unknown>,
      ],
      { trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]) },
    )
    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(api, members, store)
    session.previewTimes(
      members.map((member) => ({
        trackId: member.trackId,
        kfId: member.kfId,
        time: 1 + (member.startTime - 1) * 2,
      })),
    )

    api.doc.transact(() => {
      session.commit()
      setStaggerSetDelayMetadata(api, 'scale-set', 0.2)
    }, UNDOABLE_GESTURE_ORIGIN)
    expect(api.getUiState().staggerSets['scale-set']?.delay).toBe(0.2)

    undo.undo()
    const restored = layers.flatMap((nodeId) =>
      api
        .getTracksForNode(nodeId)
        .find((candidate) => candidate.propertyId === 'transform.x')!
        .keyframes.map((keyframe) => keyframe.time),
    )
    expect(restored).toEqual(before)
    expect(api.getUiState().staggerSets['scale-set']?.delay).toBe(0.1)
    undo.destroy()
  })

  it('writes a same-track batch once while preserving ids, metadata, and order', () => {
    const api = createSceneAPI()
    const track: Track = {
      id: 'track',
      nodeId: 'node',
      propertyId: 'appearance.opacity',
      defaultEasing: 'ease-in-out',
      keyframes: [
        { id: 'first', time: 0.5, value: 0, easingOut: 'ease-in' },
        { id: 'middle', time: 1.5, value: 0.5, presetOrigin: 'in' },
        { id: 'last', time: 2.5, value: 1, easingOut: 'ease-out' },
      ],
    }
    api.setTrack(track)

    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)
    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(
      api,
      track.keyframes.map((keyframe) => ({
        trackId: track.id,
        kfId: keyframe.id,
        startTime: keyframe.time,
      })),
      store,
    )

    session.preview(1.25)
    session.preview(2)
    expect(listener).not.toHaveBeenCalled()
    session.commit()

    const committed = api.getTrack(track.id)!
    expect(listener).toHaveBeenCalledTimes(1)
    expect(committed.keyframes.map((keyframe) => keyframe.id)).toEqual([
      'first',
      'middle',
      'last',
    ])
    expect(committed.keyframes.map((keyframe) => keyframe.time)).toEqual([
      2.5,
      3.5,
      4.5,
    ])
    expect(committed.keyframes[0]?.easingOut).toBe('ease-in')
    expect(committed.keyframes[1]?.presetOrigin).toBe('in')
    unsubscribe()
  })

  it('previews proportional target times and commits them in one update', () => {
    const api = createSceneAPI()
    const track: Track = {
      id: 'scale-track',
      nodeId: 'scale-node',
      propertyId: 'transform.scaleX',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'left', time: 1, value: 1 },
        { id: 'middle', time: 2, value: 1.5 },
        { id: 'right', time: 3, value: 2 },
      ],
    }
    api.setTrack(track)
    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)
    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(
      api,
      track.keyframes.map((keyframe) => ({
        trackId: track.id,
        kfId: keyframe.id,
        startTime: keyframe.time,
      })),
      store,
    )

    for (let packet = 1; packet <= 100; packet++) {
      const edge = 3 + packet / 100
      session.previewTimes([
        { trackId: track.id, kfId: 'left', time: 1 },
        { trackId: track.id, kfId: 'middle', time: (1 + edge) / 2 },
        { trackId: track.id, kfId: 'right', time: edge },
      ])
    }

    expect(listener).not.toHaveBeenCalled()
    expect(callbacks.size).toBe(1)
    session.commit()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(
      api.getTrack(track.id)?.keyframes.map(({ id, time }) => ({ id, time })),
    ).toEqual([
      { id: 'left', time: 1 },
      { id: 'middle', time: 2.5 },
      { id: 'right', time: 4 },
    ])
    unsubscribe()
  })

  it('publishes only the latest packet once per display frame', () => {
    const store = createKeyframeDragPreviewStore()
    const listener = vi.fn()
    store.subscribe('track', 'keyframe', listener)
    const members = [
      { trackId: 'track', kfId: 'keyframe', startTime: 1 },
    ] as const

    store.preview(members, 0.1)
    store.preview(members, 0.5)
    store.preview(members, 1)

    expect(listener).not.toHaveBeenCalled()
    expect(callbacks.size).toBe(1)
    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(16)

    expect(store.getTime('track', 'keyframe', 1)).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('drops a cancelled preview without writing the scene', () => {
    const api = createSceneAPI()
    const track: Track = {
      id: 'cancel-track',
      nodeId: 'cancel-node',
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [{ id: 'cancel-keyframe', time: 1, value: 10 }],
    }
    api.setTrack(track)
    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)
    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(
      api,
      [{ trackId: track.id, kfId: 'cancel-keyframe', startTime: 1 }],
      store,
    )

    session.preview(2)
    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(16)
    expect(store.getTime(track.id, 'cancel-keyframe', 1)).toBe(3)

    session.cancel()

    expect(listener).not.toHaveBeenCalled()
    expect(api.getTrack(track.id)?.keyframes[0]?.time).toBe(1)
    expect(store.getTime(track.id, 'cancel-keyframe', 1)).toBe(1)
    unsubscribe()
  })

  it('previews canvas interpolation without changing the authored track', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    const track: Track = {
      id: 'canvas-track',
      nodeId,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 2, value: 100 },
      ],
    }
    api.setTrack(track)
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(50)

    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(
      api,
      [{ trackId: track.id, kfId: 'end', startTime: 2 }],
      store,
    )
    session.preview(2)

    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(16)

    expect(api.getTrack(track.id)?.keyframes[1]?.time).toBe(2)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(25)

    session.commit()
    expect(api.getTrack(track.id)?.keyframes[1]?.time).toBe(4)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(25)
  })

  it('keeps text animation timing attached when its keyframes move', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null)
    const textAnimation = {
      ...DEFAULT_TEXT_ANIMATION,
      startTime: 1,
      // Four default glyphs with 0.12s stagger occupy the remaining 0.36s
      // of this authored one-second keyframe span.
      duration: 0.64,
    }
    api.setNodeProperty(nodeId, 'textAnimation', textAnimation)
    const track: Track = {
      id: 'text-progress',
      nodeId,
      propertyId: 'text.progress',
      defaultEasing: 'ease-out',
      textAnimation,
      keyframes: [
        { id: 'text-start', time: 1, value: 0 },
        { id: 'text-end', time: 2, value: 1 },
      ],
    }
    api.setTrack(track)
    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(
      api,
      [
        { trackId: track.id, kfId: 'text-start', startTime: 1 },
        { trackId: track.id, kfId: 'text-end', startTime: 2 },
      ],
      store,
    )

    session.preview(1.5)
    session.commit()

    expect(api.getTrack(track.id)?.textAnimation?.startTime).toBe(2.5)
    const node = api.getNode(nodeId)
    expect(node?.kind === 'text' ? node.textAnimation?.startTime : null).toBe(
      2.5,
    )
    expect(api.getTrack(track.id)?.textAnimation?.duration).toBe(
      textAnimation.duration,
    )
  })

  it('updates text animation duration while its end key is retimed', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: '100' })
    const textAnimation = {
      ...textAnimationDefaults('number-flow'),
      startTime: 0,
      duration: 1,
    }
    api.setNodeProperty(nodeId, 'textAnimation', textAnimation)
    const track: Track = {
      id: 'number-flow-progress',
      nodeId,
      propertyId: 'text.progress',
      defaultEasing: 'linear',
      textAnimation,
      keyframes: [
        { id: 'text-start', time: 0, value: 0 },
        { id: 'text-end', time: 1, value: 1 },
      ],
    }
    api.setTrack(track)
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(2)

    const store = createKeyframeDragPreviewStore()
    const session = createKeyframeDragSession(
      api,
      [{ trackId: track.id, kfId: 'text-end', startTime: 1 }],
      store,
    )
    session.preview(7.425)
    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(16)

    expect(engine.getSnapshot()[nodeId]?.textAnimation?.duration).toBeCloseTo(
      8.425,
    )
    expect(engine.getSnapshot()[nodeId]?.textTimelineProgress).toBeCloseTo(
      2 / 8.425,
    )

    session.commit()
    expect(api.getTrack(track.id)?.textAnimation?.duration).toBeCloseTo(8.425)
    const node = api.getNode(nodeId)
    expect(
      node?.kind === 'text' ? node.textAnimation?.duration : null,
    ).toBeCloseTo(8.425)
  })
})
