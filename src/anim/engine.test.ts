// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { NodeId, Track } from '@/scene'
import { getAnimEngine } from '@/anim/engine'
import { normalizeLayerMotionPath } from '@/anim/layerMotionPath'
import { textAnimationDefaults } from '@/anim/textAnimations'

function textProgressTrack(
  id: string,
  nodeId: NodeId,
  start: number,
  end: number,
  options: {
    mode?: 'in' | 'out'
    effect?: 'slide-up' | 'blur'
    values?: readonly [number, number]
  } = {},
): Track {
  const mode = options.mode ?? 'in'
  const effect = options.effect ?? 'slide-up'
  const values = options.values ?? [0, 1]
  return {
    id,
    nodeId,
    propertyId: 'text.progress',
    defaultEasing: 'linear',
    textAnimation: {
      ...textAnimationDefaults(effect),
      mode,
      startTime: start,
      duration: end - start,
    },
    keyframes: [
      { id: `${id}-start`, time: start, value: values[0] },
      { id: `${id}-end`, time: end, value: values[1] },
    ],
  }
}

function installFakeAnimationFrames() {
  let nextHandle = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const request = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle++
    callbacks.set(handle, callback)
    return handle
  })
  const cancel = vi.fn((handle: number) => {
    callbacks.delete(handle)
  })
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)

  return {
    request,
    pendingCount: () => callbacks.size,
    runNext(timestamp: number) {
      const next = callbacks.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined
      if (!next) throw new Error('No animation frame is pending')
      const [handle, callback] = next
      callbacks.delete(handle)
      callback(timestamp)
    },
  }
}

afterEach(() => {
  const engine = getAnimEngine()
  engine.pause()
  engine.setPlaybackRange(null)
  engine.setTrackPreview(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('animation engine track preview', () => {
  it('publishes intermediate opacity for a 0 to 1 fade track', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    api.setTrack({
      id: 'opacity-track',
      nodeId,
      propertyId: 'appearance.opacity',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 1, value: 1 },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)

    engine.seek(0)
    expect(engine.getSnapshot()[nodeId]?.opacity).toBe(0)
    engine.seek(0.25)
    expect(engine.getSnapshot()[nodeId]?.opacity).toBeCloseTo(0.25)
    engine.seek(0.5)
    expect(engine.getSnapshot()[nodeId]?.opacity).toBeCloseTo(0.5)
    engine.seek(1)
    expect(engine.getSnapshot()[nodeId]?.opacity).toBe(1)
  })

  it('steps animated layer blend modes at their authored keyframes', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    api.setTrack({
      id: 'blend-mode-track',
      nodeId,
      propertyId: 'appearance.blendMode',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'normal', time: 0, value: 'normal' },
        { id: 'overlay', time: 1, value: 'overlay' },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)

    engine.seek(0)
    expect(engine.getSnapshot()[nodeId]?.blendMode).toBe('normal')
    engine.seek(0.999)
    expect(engine.getSnapshot()[nodeId]?.blendMode).toBe('normal')
    engine.seek(1)
    expect(engine.getSnapshot()[nodeId]?.blendMode).toBe('overlay')
  })

  it('evaluates transient keyframe timing without mutating the scene', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    const authored: Track = {
      id: 'position-track',
      nodeId,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 2, value: 100 },
      ],
    }
    api.setTrack(authored)

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(50)

    const preview: Track = {
      ...authored,
      keyframes: authored.keyframes.map((keyframe) =>
        keyframe.id === 'end' ? { ...keyframe, time: 4 } : keyframe,
      ),
    }
    const versionBeforePreview = api.getVersion()
    engine.setTrackPreview(new Map([[preview.id, preview]]))

    expect(api.getVersion()).toBe(versionBeforePreview)
    expect(api.getTrack(authored.id)?.keyframes[1]?.time).toBe(2)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(25)

    // A durable write made while the preview is active stays hidden until the
    // gesture clears its overlay, then becomes the new evaluated source.
    api.setTrack({
      ...authored,
      keyframes: authored.keyframes.map((keyframe) =>
        keyframe.id === 'end' ? { ...keyframe, time: 8 } : keyframe,
      ),
    })
    expect(engine.getSnapshot()[nodeId]?.x).toBe(25)

    engine.setTrackPreview(null)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(12.5)
  })
})

describe('animation engine layer motion paths', () => {
  it('resolves static path progress into the node transform and auto-orientation', () => {
    const api = createSceneAPI()
    const motionPath = normalizeLayerMotionPath({
      version: 1,
      progress: 0.5,
      autoOrient: true,
      rotationOffset: 5,
      parameterization: 'parametric',
      points: [
        { id: 'start', t: 0, x: 0, y: 0, z: 0 },
        { id: 'end', t: 1, x: 100, y: 100, z: 20 },
      ],
    })!
    const nodeId = api.createNode('rect', null, {
      transform: {
        x: 100,
        y: 40,
        z: 10,
        rotation: 10,
        rotationX: 0,
        rotationY: 0,
        scaleX: 1,
        scaleY: 1,
      },
      motionPath,
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)

    const value = engine.getSnapshot()[nodeId]
    expect(value).toMatchObject({
      motionPathProgress: 0.5,
      x: 150,
      y: 90,
      z: 20,
    })
    expect(value?.rotation).toBeCloseTo(60)
  })

  it('adds the sampled rail after explicit transform tracks', () => {
    const api = createSceneAPI()
    const motionPath = normalizeLayerMotionPath({
      version: 1,
      progress: 0,
      autoOrient: true,
      rotationOffset: 15,
      parameterization: 'parametric',
      points: [
        { id: 'start', t: 0, x: 0, y: 0, z: 0 },
        { id: 'end', t: 1, x: 0, y: 100, z: 0 },
      ],
    })!
    const nodeId = api.createNode('image', null, { motionPath })
    const tracks: Track[] = [
      {
        id: 'path-progress',
        nodeId,
        propertyId: 'motionPath.progress',
        defaultEasing: 'linear',
        keyframes: [
          { id: 'path-start', time: 0, value: 0 },
          { id: 'path-end', time: 1, value: 1 },
        ],
      },
      {
        id: 'base-x',
        nodeId,
        propertyId: 'transform.x',
        defaultEasing: 'linear',
        keyframes: [
          { id: 'x-start', time: 0, value: 200 },
          { id: 'x-end', time: 1, value: 300 },
        ],
      },
      {
        id: 'base-rotation',
        nodeId,
        propertyId: 'transform.rotation',
        defaultEasing: 'linear',
        keyframes: [
          { id: 'rotation-start', time: 0, value: 10 },
          { id: 'rotation-end', time: 1, value: 30 },
        ],
      },
    ]
    for (const track of tracks) api.setTrack(track)

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.5)

    const value = engine.getSnapshot()[nodeId]
    expect(value).toMatchObject({
      motionPathProgress: 0.5,
      x: 250,
      rotation: 125,
    })
    expect(value?.y).toBeCloseTo(50)
  })

  it('keeps authored rotation unchanged when auto-orient is disabled', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null, {
      transform: {
        x: 0,
        y: 0,
        z: 0,
        rotation: 24,
        rotationX: 0,
        rotationY: 0,
        scaleX: 1,
        scaleY: 1,
      },
      motionPath: normalizeLayerMotionPath({
        version: 1,
        progress: 1,
        autoOrient: false,
        rotationOffset: 90,
        points: [
          { id: 'start', t: 0, x: 0, y: 0 },
          { id: 'end', t: 1, x: 80, y: 0 },
        ],
      }),
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)

    expect(engine.getSnapshot()[nodeId]).toMatchObject({
      x: 80,
      y: 0,
      motionPathProgress: 1,
    })
    expect(engine.getSnapshot()[nodeId]?.rotation).toBeUndefined()
  })
})

describe('animation engine stacked text clips', () => {
  it('hands ownership from In to Out by authored start time', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Motion' })
    api.setTrack(textProgressTrack('in', nodeId, 1, 2))
    api.setTrack(
      textProgressTrack('out', nodeId, 4, 5, {
        mode: 'out',
        effect: 'blur',
      }),
    )

    const engine = getAnimEngine()
    engine.attach(api)

    engine.seek(0)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBe(0)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.mode).toBe('in')

    engine.seek(1.5)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.5)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.mode).toBe('in')

    engine.seek(3)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBe(1)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.mode).toBe('in')

    engine.seek(4.5)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.5)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.mode).toBe('out')

    engine.seek(6)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBe(1)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.mode).toBe('out')
  })

  it('keeps a future duplicate from shadowing its source clip', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Again' })
    api.setTrack(textProgressTrack('source', nodeId, 1, 2))
    api.setTrack(textProgressTrack('duplicate', nodeId, 4, 5))

    const engine = getAnimEngine()
    engine.attach(api)

    engine.seek(1.5)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.5)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.startTime).toBe(1)

    engine.seek(3)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBe(1)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.startTime).toBe(1)

    engine.seek(4.5)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.5)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.startTime).toBe(4)
  })

  it('holds the settled source until a descending return begins', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Return' })
    api.setTrack(textProgressTrack('source', nodeId, 1, 2))
    api.setTrack(
      textProgressTrack('return', nodeId, 4, 5, {
        values: [1, 0],
      }),
    )

    const engine = getAnimEngine()
    engine.attach(api)

    engine.seek(3)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBe(1)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.startTime).toBe(1)

    engine.seek(4.5)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.5)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.startTime).toBe(4)

    engine.seek(6)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBe(0)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.mode).toBe('in')
  })

  it('does not resurrect an older overlapping clip after a later Out ends', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Overlap' })
    api.setTrack(textProgressTrack('long-in', nodeId, 1, 6))
    api.setTrack(
      textProgressTrack('short-out', nodeId, 3, 4, {
        mode: 'out',
        effect: 'blur',
      }),
    )

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(5)

    expect(engine.getSnapshot()[nodeId]?.textProgress).toBe(1)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.mode).toBe('out')
  })

  it('uses preview timing when deciding which text clip owns the node', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Preview' })
    const source = textProgressTrack('source', nodeId, 1, 2)
    const duplicate = textProgressTrack('duplicate', nodeId, 4, 5)
    api.setTrack(source)
    api.setTrack(duplicate)

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1.5)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.5)

    const preview: Track = {
      ...duplicate,
      textAnimation: {
        ...duplicate.textAnimation!,
        startTime: 1.25,
      },
      keyframes: [
        { ...duplicate.keyframes[0]!, time: 1.25 },
        { ...duplicate.keyframes[1]!, time: 2.25 },
      ],
    }
    engine.setTrackPreview(new Map([[preview.id, preview]]))

    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.25)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.startTime).toBe(1.25)

    engine.setTrackPreview(null)
    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.5)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.startTime).toBe(1)
  })

  it('breaks equal-start ties by track id instead of document order', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Tie' })
    api.setTrack(
      textProgressTrack('zzz-track', nodeId, 1, 2, {
        values: [0, 0.8],
      }),
    )
    api.setTrack(
      textProgressTrack('aaa-track', nodeId, 1, 2, {
        values: [0, 0.2],
      }),
    )

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1.5)

    expect(engine.getSnapshot()[nodeId]?.textProgress).toBeCloseTo(0.4)
  })
})

describe('animation engine playback clock', () => {
  it('advances by elapsed time on the first animation frame', () => {
    const frames = installFakeAnimationFrames()
    vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const api = createSceneAPI()
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)

    engine.play()
    expect(frames.pendingCount()).toBe(1)

    frames.runNext(1_000 + 1_000 / 60)

    expect(engine.getPlayhead()).toBeCloseTo(1 / 60, 5)
    expect(frames.pendingCount()).toBe(1)
  })

  it('does not schedule another frame after a stop range ends', () => {
    const frames = installFakeAnimationFrames()
    vi.spyOn(performance, 'now').mockReturnValue(2_000)
    const api = createSceneAPI()
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)
    engine.setPlaybackRange({ start: 0, end: 0.01, mode: 'stop' })

    engine.play()
    frames.runNext(2_020)

    expect(engine.getPlayhead()).toBe(0.01)
    expect(engine.isPlaying()).toBe(false)
    expect(frames.request).toHaveBeenCalledTimes(1)
    expect(frames.pendingCount()).toBe(0)
  })

  it('keeps the playhead display-rate while publishing at scene frame rate', () => {
    const frames = installFakeAnimationFrames()
    vi.spyOn(performance, 'now').mockReturnValue(3_000)
    const api = createSceneAPI()
    api.setMeta({ frameRate: 60 })
    const nodeId = api.createNode('rect', null)
    api.setTrack({
      id: 'position-track',
      nodeId,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 1, value: 120 },
      ],
    })
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)
    const listener = vi.fn()
    const unsubscribe = engine.subscribe(listener)

    engine.play()
    frames.runNext(3_000 + 1_000 / 120)

    expect(engine.getPlayhead()).toBeCloseTo(1 / 120, 5)
    expect(listener).not.toHaveBeenCalled()
    expect(engine.getSnapshot()[nodeId]?.x).toBe(0)

    frames.runNext(3_000 + 2_000 / 120)

    expect(engine.getPlayhead()).toBeCloseTo(1 / 60, 5)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(engine.getSnapshot()[nodeId]?.x).toBeCloseTo(2)

    unsubscribe()
  })

  it('flushes the exact display-rate playhead into the snapshot when paused', () => {
    const frames = installFakeAnimationFrames()
    vi.spyOn(performance, 'now').mockReturnValue(4_000)
    const api = createSceneAPI()
    api.setMeta({ frameRate: 60 })
    const nodeId = api.createNode('rect', null)
    api.setTrack({
      id: 'position-track',
      nodeId,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 1, value: 120 },
      ],
    })
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0)

    engine.play()
    frames.runNext(4_000 + 1_000 / 120)

    expect(engine.getPlayhead()).toBeCloseTo(1 / 120, 5)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(0)

    engine.pause()

    expect(frames.pendingCount()).toBe(0)
    expect(engine.getSnapshot()[nodeId]?.x).toBeCloseTo(1)
  })
})
