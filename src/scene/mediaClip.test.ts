// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import { videoVisibleAtTime } from './mediaClip'

const clip = { clipToRange: true, startTime: 10, trimStart: 24, trimEnd: 32, duration: 131, playbackRate: 2 }

describe('split video visibility', () => {
  it('shows only the active clip, including while scrubbing backwards', () => {
    const clips = [0, 4, 8].map(startTime => ({ ...clip, startTime }))
    for (const [time, active] of [[0, 0], [4, 1], [8, 2], [11.9, 2], [5, 1], [1, 0]]) {
      expect(clips.map(n => videoVisibleAtTime(n, time))).toEqual(clips.map((_, i) => i === active))
    }
    expect(clips.some(n => videoVisibleAtTime(n, 12))).toBe(false)
  })
  it('honors trim, speed, and a negative start after a scene split', () => {
    expect(videoVisibleAtTime(clip, 9.99)).toBe(false)
    expect(videoVisibleAtTime(clip, 10)).toBe(true)
    expect(videoVisibleAtTime(clip, 13.99)).toBe(true)
    expect(videoVisibleAtTime(clip, 14)).toBe(false)
    expect(videoVisibleAtTime({ ...clip, startTime: -2 }, 0)).toBe(true)
    expect(videoVisibleAtTime({ ...clip, startTime: -2 }, 2)).toBe(false)
  })
  it('preserves frame holds for videos without the opt-in setting', () => {
    for (const time of [-10, 0, 100]) {
      expect(videoVisibleAtTime({ ...clip, clipToRange: undefined }, time)).toBe(true)
      expect(videoVisibleAtTime({ ...clip, clipToRange: false }, time)).toBe(true)
    }
  })
  it('reads legacy stored flags and preserves them through save and copy', () => {
    const doc = new Y.Doc()
    const api = createSceneAPI(doc)
    const id = api.createNode('video', null, { ...clip, src: 'hm-media://asset/original.mp4' })
    // This is the field present in older project files.
    const nodes = doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    nodes.get(id)!.set('clipToRange', true)
    const reopened = readScene(sceneToBytes(doc))
    const video = reopened.api.getNode(id)
    expect(video?.kind).toBe('video')
    if (video?.kind !== 'video') throw new Error('missing video')
    expect(video.clipToRange).toBe(true)
    expect(videoVisibleAtTime(video, 0)).toBe(false)
    const copy = reopened.api.createNode('video', null, { ...video, id: undefined })
    expect(reopened.api.getNode(copy)).toHaveProperty('clipToRange', true)
    doc.destroy()
    reopened.doc.destroy()
  })
})
