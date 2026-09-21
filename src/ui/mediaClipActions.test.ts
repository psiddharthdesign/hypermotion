// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { mediaClipRange, videoVisibleAtTime } from '@/scene/mediaClip'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { canSplitMediaClip, splitMediaClip, trimMediaClipAtPlayhead } from './mediaClipActions'
import { setLastSolvedLayout } from './hooks/lastSolvedLayout'

afterEach(() => setLastSolvedLayout(null))

function fixture() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null)
  const id = api.createNode('video', root, {
    name: 'Interview', src: 'file:///original.mp4', duration: 20,
    trimStart: 2, trimEnd: 14, startTime: 1, playbackRate: 2,
    position: 'absolute', size: { width: 640, height: 360 },
    fit: 'contain', crop: { x: 0.2, y: 0.7, zoom: 1.4 },
  })
  api.setTrack({ id: 'motion', nodeId: id, propertyId: 'transform.y',
    defaultEasing: 'ease-in-out', keyframes: [
      { id: 'a', time: 0, value: 10 }, { id: 'b', time: 8, value: 100 },
    ] })
  return { api, root, id }
}

describe('non-destructive media editing', () => {
  it('splits at source time accounting for trim, scene start and speed', () => {
    const { api, id } = fixture()
    const rightId = splitMediaClip(api, id, 4)!
    const left = api.getNode(id)!
    const right = api.getNode(rightId)!
    expect(left).toMatchObject({ trimStart: 2, trimEnd: 8, startTime: 1 })
    expect(right).toMatchObject({ trimStart: 8, trimEnd: 14, startTime: 4,
      src: 'file:///original.mp4', playbackRate: 2, fit: 'contain',
      size: { width: 640, height: 360 }, crop: { x: 0.2, y: 0.7, zoom: 1.4 } })
    if (left.kind !== 'video' || right.kind !== 'video') throw new Error('Expected videos')
    expect(mediaClipRange(left).duration + mediaClipRange(right).duration).toBe(6)
    expect(videoVisibleAtTime(left, 3.999)).toBe(true)
    expect(videoVisibleAtTime(left, 4)).toBe(false)
    expect(videoVisibleAtTime(right, 3.999)).toBe(false)
    expect(videoVisibleAtTime(right, 4)).toBe(true)
    expect(videoVisibleAtTime(right, 7)).toBe(false)
    const track = api.getTracksForNode(rightId)[0]!
    expect(track.id).not.toBe('motion')
    expect(track.keyframes.map(k => [k.time, k.value])).toEqual([[0, 10], [8, 100]])
    expect(track.keyframes[0]!.id).not.toBe('a')
  })

  it('preserves the cut endpoint for media carried over from a scene split', () => {
    const { api, id } = fixture()
    api.setNodeProperty(id, 'startTime', -5.5)
    api.setNodeProperty(id, 'playbackRate', 1)
    const rightId = splitMediaClip(api, id, 3.4)!
    const left = api.getNode(id)!
    const right = api.getNode(rightId)!
    if (left.kind !== 'video' || right.kind !== 'video') throw new Error('Expected videos')
    expect(mediaClipRange(left).start).toBe(-5.5)
    expect(mediaClipRange(left).end).toBeCloseTo(3.4)
    expect(mediaClipRange(right).start).toBe(3.4)
    expect(left.trimEnd).toBe(right.trimStart)
    expect(videoVisibleAtTime(left, 3.41)).toBe(false)
    expect(videoVisibleAtTime(right, 3.41)).toBe(true)
  })

  it('isolates and deletes a middle section without changing remaining media', () => {
    const { api, id } = fixture()
    const middle = splitMediaClip(api, id, 3)!
    const right = splitMediaClip(api, middle, 5)!
    api.deleteNode(middle)
    expect(api.getNode(middle)).toBeNull()
    expect(api.getTracksForNode(middle)).toHaveLength(0)
    expect(api.getNode(id)).toMatchObject({ trimEnd: 6, startTime: 1 })
    expect(api.getNode(right)).toMatchObject({ trimStart: 10, trimEnd: 14, startTime: 5 })
  })

  it('trims either side without moving the opposite timeline endpoint', () => {
    const { api, id } = fixture()
    trimMediaClipAtPlayhead(api, id, 3, 'start')
    expect(api.getNode(id)).toMatchObject({ startTime: 3, trimStart: 6, trimEnd: 14 })
    trimMediaClipAtPlayhead(api, id, 5, 'end')
    expect(api.getNode(id)).toMatchObject({ startTime: 3, trimStart: 6, trimEnd: 10 })
  })

  it('rejects boundaries, locked and looping clips rather than making empty pieces', () => {
    const { api, id } = fixture()
    for (const time of [0, 1, 7, 10, NaN]) expect(splitMediaClip(api, id, time)).toBeNull()
    api.setNodeProperty(id, 'locked', true)
    expect(canSplitMediaClip(api, id, 3)).toBe(false)
    api.setNodeProperty(id, 'locked', false)
    api.setNodeProperty(id, 'loop', true)
    expect(canSplitMediaClip(api, id, 3)).toBe(false)
  })

  it('undoes and redoes a split as one operation', () => {
    const { api, id } = fixture()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), {
      trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]),
    })
    const right = splitMediaClip(api, id, 4)!
    undo.undo()
    expect(api.getNode(right)).toBeNull()
    expect(api.getNode(id)).toMatchObject({ trimEnd: 14 })
    undo.redo()
    expect(api.getNode(right)).toMatchObject({ trimStart: 8 })
  })

  it('keeps the split copy on the original auto-layout slot', () => {
    const { api, root, id } = fixture()
    api.setNodeProperty(id, 'position', 'flow')
    setLastSolvedLayout({
      [root]: { x: 10, y: 20, width: 1000, height: 700 },
      [id]: { x: 70, y: 100, width: 640, height: 360 },
    })
    const right = splitMediaClip(api, id, 4)!
    expect(api.getNode(right)?.position).toBe('absolute')
    expect(api.getNode(right)?.transform.y).toBe(api.getNode(id)!.transform.y + 80)
    expect(api.getTracksForNode(right)[0]!.keyframes[0]!.value).toBe(90)
  })
})
