// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest'
import type { Node, SceneAPI } from '@/scene'
import { buildSequenceTimeMap, type CompositionScene } from '@/sequence'
import { createVideoPrewarmPool, upcomingVideoWarmups } from './videoPrewarm'

function decoder() {
  const listeners = new Map<string, () => void>()
  const video = {
    readyState: 0, currentTime: 0,
    pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(),
    addEventListener: vi.fn((name: string, callback: () => void) => listeners.set(name, callback)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  } as unknown as HTMLVideoElement
  return { video, metadata: () => { listeners.get('loadedmetadata')?.() } }
}

describe('Master cut video preparation', () => {
  it('does zero decoder creation/loading at a prepared scene cut', () => {
    const decoded = decoder()
    const create = vi.fn(() => decoded.video)
    const pool = createVideoPrewarmPool(create)
    const target = { id: 'incoming', src: 'clip', time: 2.5 }
    pool.prepare([target])
    decoded.metadata()
    expect(decoded.video.currentTime).toBe(2.5)
    create.mockClear()
    expect(pool.take(target)).toBe(decoded.video)
    expect(create).not.toHaveBeenCalled()
    expect(decoded.video.load).not.toHaveBeenCalled()
    // Preparing again following the composition's React rerender must not
    // start another decoder or release the one now owned by the renderer.
    pool.prepare([target])
    pool.clear()
    expect(create).not.toHaveBeenCalled()
    expect(decoded.video.removeAttribute).not.toHaveBeenCalled()
  })

  it('keeps the incoming decoder alive when the clock crosses the cut before React commits', () => {
    const create = vi.fn(() => decoder().video)
    const pool = createVideoPrewarmPool(create)
    const b = { id: 'b', src: 'b.mp4', time: 0 }
    const c = { id: 'c', src: 'c.mp4', time: 0 }
    pool.prepare([b])
    const incoming = create.mock.results[0].value
    pool.prepare([c])
    expect(pool.take(b)).toBe(incoming)
    expect(incoming.removeAttribute).not.toHaveBeenCalled()
    pool.clear()
  })

  it('retains the last incoming scene until its viewport can take it', () => {
    const { video } = decoder()
    const pool = createVideoPrewarmPool(() => video)
    const target = { id: 'last', src: 'last.mp4', time: 0 }
    pool.prepare([target])
    pool.prepare([])
    expect(pool.take(target)).toBe(video)
    pool.clear()
  })

  it('evicts skipped batches and cancels pending seeks on cleanup', () => {
    const created: ReturnType<typeof decoder>[] = []
    const pool = createVideoPrewarmPool(() => {
      const item = decoder(); created.push(item); return item.video
    })
    for (const id of ['b', 'c', 'd']) pool.prepare([{ id, src: id, time: 2 }])
    expect(created[0].video.removeAttribute).toHaveBeenCalledWith('src')
    created[0].metadata()
    expect(created[0].video.currentTime).toBe(0)
    pool.clear()
    for (const item of created) expect(item.video.load).toHaveBeenCalledOnce()
  })

  it('does not hand a replaced source to the renderer', () => {
    const pool = createVideoPrewarmPool(() => decoder().video)
    pool.prepare([{ id: 'v', src: 'old', time: 0 }])
    expect(pool.take({ id: 'v', src: 'new' })).toBeNull()
    pool.clear()
  })

  it('caps each batch at four decoders', () => {
    const create = vi.fn(() => decoder().video)
    const pool = createVideoPrewarmPool(create)
    pool.prepare(Array.from({ length: 20 }, (_, i) => ({ id: String(i), src: String(i), time: 0 })))
    expect(create).toHaveBeenCalledTimes(4)
    pool.clear()
  })
})

describe('next-scene source preparation', () => {
  const scenes: CompositionScene[] = ['a', 'b', 'c'].map((id) => ({
    id, name: id, rootNodeId: id, duration: 8, cameraIds: [], defaultCameraId: null, cameraCuts: {},
  }))
  const map = buildSequenceTimeMap({ scenes, frameRate: 60, items: [
    { id: 'one', sceneId: 'a', duration: 3 },
    { id: 'two', sceneId: 'b', trimStart: 2, duration: 3 },
    { id: 'three', sceneId: 'c' },
  ] })
  function api(videoPatch = {}) {
    const nodes = {
      b: { id: 'b', kind: 'frame', visible: true, children: ['video'] },
      video: { id: 'video', kind: 'video', visible: true, src: 'movie', startTime: 1, trimStart: 4, trimEnd: 12, duration: 15, playbackRate: 2, ...videoPatch },
    }
    return { getNode: (id: string) => nodes[id as keyof typeof nodes] as unknown as Node } as Pick<SceneAPI, 'getNode'>
  }
  it('prepares only the next occurrence at its trimmed, speed-adjusted media time', () => {
    expect(upcomingVideoWarmups(api(), map, 1)).toEqual([{ id: 'video', src: 'movie', time: 6 }])
    expect(upcomingVideoWarmups(api(), map, map.duration)).toEqual([])
  })
  it('wraps looping sources and ignores hidden or later clips', () => {
    expect(upcomingVideoWarmups(api({ loop: true, trimEnd: 5 }), map, 1)[0].time).toBe(4)
    expect(upcomingVideoWarmups(api({ visible: false }), map, 1)).toEqual([])
    expect(upcomingVideoWarmups(api({ startTime: 6 }), map, 1)).toEqual([])
    expect(upcomingVideoWarmups(api({ startTime: 3 }), map, 1)).toEqual([])
    expect(upcomingVideoWarmups(api({ startTime: -5, trimStart: 0, trimEnd: 1, clipToRange: true }), map, 1)).toEqual([])
    expect(upcomingVideoWarmups(api({ startTime: 2, clipToRange: true }), map, 1)).toEqual([{id: 'video', src: 'movie', time: 4}])
  })
})
