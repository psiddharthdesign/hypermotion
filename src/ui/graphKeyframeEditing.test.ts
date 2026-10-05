// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import type { Track } from '@/scene/types'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { addKeyframe } from '@/anim/tracks'
import { toggleStaggerSetPropertyKeyframes } from '@/anim/staggerSets'
import {
  commitGraphEasing, commitGraphKeyframeDrag, graphEasingHandle,
  graphEditableBezierCoords, graphKeyframeDragTarget, graphSelectedKeyframeIds,
  isGraphEditableTrack, previewGraphEasing, previewGraphKeyframeDrag, selectedGraphSegments,
} from './graphKeyframeEditing'

function setup() {
  const api = createSceneAPI()
  api.setMeta({ duration: 6, frameRate: 60 })
  const nodeId = api.createNode('rect', null)
  const track: Track = { id: 'track', nodeId, propertyId: 'transform.x', defaultEasing: 'linear', keyframes: [
    { id: 'a', time: 0, value: 0, easingOut: 'ease-in', presetOrigin: 'in' },
    { id: 'b', time: 1, value: 10 },
    { id: 'c', time: 2, value: 20, easingOut: { bezier: [0.1, 1.5, 0.9, 1] } },
    { id: 'd', time: 3, value: 10 },
    { id: 'e', time: 4, value: 30 },
  ] }
  api.setTrack(track)
  return { api, track: api.getTrack(track.id)!, nodeId }
}
function staggerSetup() {
  const api = createSceneAPI()
  api.setMeta({ duration: 6, frameRate: 60 })
  const root = api.createNode('frame', null)
  const layers = [0, 1, 2].map(i => api.createNode('rect', root, { name: `Card ${i}` }))
  const targets = layers.map((nodeId, i) => ({ nodeId, currentValue: i * 10 }))
  for (const [setId, start] of [['entry', 1], ['exit', 4]] as const) {
    const options = { setId, layerIds: layers, delay: 0.1, order: 'forward' as const }
    toggleStaggerSetPropertyKeyframes(api, targets, 'transform.x', start, options)
    toggleStaggerSetPropertyKeyframes(api, targets.map(target => ({ ...target, currentValue: 100 })), 'transform.x', start + 1, options)
  }
  const member = (setId: string, index: number, ordinal = 0) => {
    const id = api.getUiState().staggerSets[setId]!.members[layers[index]!]!['transform.x']![ordinal]!
    const track = api.getTracksForNode(layers[index]!).find(item => item.keyframes.some(key => key.id === id))!
    return { track, key: track.keyframes.find(key => key.id === id)! }
  }
  return { api, layers, member }
}

describe('selected graph segments', () => {
  it('exposes only curves adjacent to exact selected keys, including incoming curves', () => {
    const { track } = setup()
    const selected = ['track:b', 'track:d', 'elsewhere:a', 'track:missing']
    expect([...graphSelectedKeyframeIds(track, selected)]).toEqual(['b', 'd'])
    expect(selectedGraphSegments(track, ['track:b']).map(segment => [segment.start.id, segment.end.id, segment.startSelected, segment.endSelected])).toEqual([
      ['a', 'b', false, true], ['b', 'c', true, false],
    ])
    expect(selectedGraphSegments(track, selected)).toHaveLength(4)
    expect(selectedGraphSegments(track, ['track:e']).map(segment => segment.start.id)).toEqual(['d'])
    expect(selectedGraphSegments(track, ['elsewhere:a', 'track:missing'])).toEqual([])
  })

  it('deduplicates adjacency and safely sorts without mutating authored order', () => {
    const { track } = setup()
    const shuffled = { ...track, keyframes: [...track.keyframes].reverse() }
    const before = [...shuffled.keyframes]
    expect(selectedGraphSegments(shuffled, ['track:b', 'track:c']).map(segment => segment.start.id)).toEqual(['a', 'b', 'c'])
    expect(shuffled.keyframes).toEqual(before)
  })

  it('rejects discrete numeric settings, strings, and nonfinite values', () => {
    const { track } = setup()
    expect(isGraphEditableTrack({ ...track, propertyId: 'appearance.fullRadius' })).toBe(false)
    expect(isGraphEditableTrack({ ...track, keyframes: [{ id: 'x', time: 0, value: 'x' }] })).toBe(false)
    expect(isGraphEditableTrack({ ...track, keyframes: [{ id: 'x', time: 0, value: Infinity }] })).toBe(false)
    expect(selectedGraphSegments({ ...track, propertyId: 'layout.direction' }, ['track:a'])).toEqual([])
  })
})

describe('graph keyframe dragging', () => {
  it('snaps to frames and stops one frame short of neighboring keys', () => {
    const { api } = setup()
    expect(graphKeyframeDragTarget(api, 'track', 'b', { time: 1.234, value: 17 })).toEqual({ time: 74 / 60, value: 17 })
    expect(graphKeyframeDragTarget(api, 'track', 'b', { time: 10, value: 17 })?.time).toBe(119 / 60)
    expect(graphKeyframeDragTarget(api, 'track', 'b', { time: -10, value: -4 })?.time).toBe(1 / 60)
    expect(graphKeyframeDragTarget(api, 'track', 'a', { time: -10, value: -4 })?.time).toBe(0)
    expect(graphKeyframeDragTarget(api, 'track', 'e', { time: 10, value: 44 })?.time).toBe(6)
    expect(graphKeyframeDragTarget(api, 'track', 'e', { time: 10, value: 44, duration: 4.5, frameRate: 24 })?.time).toBe(4.5)
  })

  it('keeps crowded and off-grid authored times intact for value-only editing', () => {
    const { api, track } = setup()
    api.setTrack({ ...track, keyframes: [{ id: 'a', time: 0.12, value: 0 }, { id: 'b', time: 0.125, value: 10 }, { id: 'c', time: 0.13, value: 20 }] })
    expect(graphKeyframeDragTarget(api, 'track', 'b', { time: 10, value: 33 })).toEqual({ time: 0.125, value: 33 })
    expect(graphKeyframeDragTarget(api, 'track', 'b', { time: 0.125, value: 34 })).toEqual({ time: 0.125, value: 34 })
  })

  it('previews without writing and commits one undo step while retaining unrelated metadata', () => {
    const { api, track } = setup()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    let updates = 0
    api.doc.on('update', () => updates++)
    const preview = previewGraphKeyframeDrag(api, 'track', 'b', { time: 1.5, value: 45 })
    expect(preview.get('track')!.keyframes[1]).toMatchObject({ id: 'b', time: 1.5, value: 45 })
    expect(api.getTrack('track')).toEqual(track)
    expect(updates).toBe(0)
    expect(commitGraphKeyframeDrag(api, 'track', 'b', { time: 1.5, value: 45 })).toBe(true)
    expect(updates).toBe(1)
    expect(api.getTrack('track')!.keyframes[0]).toEqual(track.keyframes[0])
    expect(api.getTrack('track')!.keyframes[2]).toEqual(track.keyframes[2])
    undo.undo()
    expect(api.getTrack('track')).toEqual(track)
    undo.destroy()
  })

  it('rejects stale keys, nonfinite pointers, locked layers and no-op commits', () => {
    const { api, nodeId } = setup()
    expect(graphKeyframeDragTarget(api, 'track', 'missing', { time: 1, value: 3 })).toBeNull()
    expect(graphKeyframeDragTarget(api, 'track', 'b', { time: NaN, value: 3 })).toBeNull()
    expect(graphKeyframeDragTarget(api, 'track', 'b', { time: 1, value: Infinity })).toBeNull()
    expect(commitGraphKeyframeDrag(api, 'track', 'b', { time: 1, value: 10 })).toBe(false)
    api.setNodeProperty(nodeId, 'locked', true)
    expect(previewGraphKeyframeDrag(api, 'track', 'b', { time: 1.5, value: 99 }).size).toBe(0)
    expect(commitGraphKeyframeDrag(api, 'track', 'b', { time: 1.5, value: 99 })).toBe(false)
  })

  it('moves only the corresponding entry bundle and respects a follower’s independent neighboring key', () => {
    const { api, layers, member } = staggerSetup()
    addKeyframe(api, layers[2]!, 'transform.x', 1.6, 999)
    const edited = member('entry', 1)
    const exits = layers.map((_, index) => [member('exit', index).key, member('exit', index, 1).key])
    const target = graphKeyframeDragTarget(api, edited.track.id, edited.key.id, { time: 9, value: 55 })!
    expect(target.time).toBeCloseTo(89 / 60)
    const preview = previewGraphKeyframeDrag(api, edited.track.id, edited.key.id, target)
    expect(preview.size).toBe(3)
    expect(member('entry', 1).key.time).toBeCloseTo(1.1)
    expect(commitGraphKeyframeDrag(api, edited.track.id, edited.key.id, target)).toBe(true)
    for (let i = 0; i < 3; i++) {
      expect(member('entry', i).key.time).toBeCloseTo(target.time + (i - 1) * 0.1)
      expect(member('entry', i).key.value).toBe(55)
      expect(member('entry', i, 1).key.time).toBeCloseTo(2 + i * 0.1)
      expect([member('exit', i).key, member('exit', i, 1).key]).toEqual(exits[i])
    }
    expect(api.getTracksForNode(layers[2]!).flatMap(track => track.keyframes).find(key => key.value === 999)?.time).toBe(1.6)
  })

  it('rechecks neighbor bounds at commit if another key was inserted during the preview', () => {
    const { api, track } = setup()
    const target = graphKeyframeDragTarget(api, 'track', 'b', { time: 1.8, value: 50 })!
    api.setTrack({ ...track, keyframes: [...track.keyframes, { id: 'new', time: 1.4, value: 22 }].sort((a, b) => a.time - b.time) })
    commitGraphKeyframeDrag(api, 'track', 'b', target)
    expect(api.getTrack('track')!.keyframes.find(key => key.id === 'b')?.time).toBeCloseTo(83 / 60)
    expect(api.getTrack('track')!.keyframes.find(key => key.id === 'new')).toMatchObject({ time: 1.4, value: 22 })
  })
})

describe('graph easing handles', () => {
  it('provides useful linear handles and preserves downward overshoot values', () => {
    const { track } = setup()
    expect(graphEditableBezierCoords('linear')).toEqual([1 / 3, 1 / 3, 2 / 3, 2 / 3])
    const next = graphEasingHandle(track, 'c', 'd', 1, 2.25, -10)!
    expect(next).toEqual([0.25, 3, 0.9, 1])
    expect(graphEasingHandle(track, 'c', 'd', 2, 5, 25)).toEqual([0.1, 1.5, 1, -0.5])
    expect(track.keyframes[2]!.easingOut).toEqual({ bezier: [0.1, 1.5, 0.9, 1] })
  })

  it('keeps flat segments flat while allowing timing handle changes', () => {
    const { track } = setup()
    const flat = { ...track, keyframes: [{ id: 'a', time: 0, value: 10 }, { id: 'b', time: 1, value: 10 }] }
    expect(graphEasingHandle(flat, 'a', 'b', 1, 0.2, 80)).toEqual([0.2, 1 / 3, 2 / 3, 2 / 3])
  })

  it('commits by stable endpoint IDs and rejects changed adjacency instead of editing the wrong curve', () => {
    const { api, track } = setup()
    api.setTrack({ ...track, keyframes: [{ id: 'earlier', time: -1, value: 5 }, ...track.keyframes] })
    expect(commitGraphEasing(api, 'track', 'b', 'c', [0.2, 0.8, 0.7, 1.1])).toBe(true)
    expect(api.getTrack('track')!.keyframes.find(key => key.id === 'b')?.easingOut).toEqual({ bezier: [0.2, 0.8, 0.7, 1.1] })
    expect(api.getTrack('track')!.keyframes.find(key => key.id === 'a')).toEqual(track.keyframes[0])
    const live = api.getTrack('track')!
    api.setTrack({ ...live, keyframes: [...live.keyframes, { id: 'between', time: 1.5, value: 15 }].sort((a, b) => a.time - b.time) })
    const before = api.getTrack('track')
    expect(commitGraphEasing(api, 'track', 'b', 'c', [0, 2, 1, 1])).toBe(false)
    expect(api.getTrack('track')).toEqual(before)
  })

  it('previews and commits easing only to the same stagger bundle with one undo', () => {
    const { api, layers, member } = staggerSetup()
    const edited = member('entry', 1), end = member('entry', 1, 1)
    const before = api.getAllTracks()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    const curve: [number, number, number, number] = [-0.5, 1.8, 2, -0.5]
    const preview = previewGraphEasing(api, edited.track.id, edited.key.id, end.key.id, curve)
    expect(preview.size).toBe(3)
    expect(api.getAllTracks()).toEqual(before)
    expect(commitGraphEasing(api, edited.track.id, edited.key.id, end.key.id, curve)).toBe(true)
    for (let i = 0; i < layers.length; i++) {
      expect(member('entry', i).key.easingOut).toEqual({ bezier: [0, 1.8, 1, -0.5] })
      expect(member('entry', i).key.easingPreset).toEqual({ presetId: 'custom', strength: 100 })
      expect(member('exit', i).key.easingOut).toBeUndefined()
    }
    undo.undo()
    expect(api.getAllTracks()).toEqual(before)
    undo.destroy()
  })

  it('rejects nonfinite handles and locked linked members without any scene mutation', () => {
    const { api, layers, member } = staggerSetup()
    const edited = member('entry', 0), end = member('entry', 0, 1)
    expect(previewGraphEasing(api, edited.track.id, edited.key.id, end.key.id, [0, NaN, 1, 1]).size).toBe(0)
    api.setNodeProperty(layers[2]!, 'locked', true)
    const before = api.getAllTracks()
    expect(commitGraphEasing(api, edited.track.id, edited.key.id, end.key.id, [0, 2, 1, 1])).toBe(false)
    expect(api.getAllTracks()).toEqual(before)
  })
})
