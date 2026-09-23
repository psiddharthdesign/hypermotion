// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { sceneToBytes, applyBytesToScene } from '@/scene/file'
import { rebaseSceneNodes } from '@/project/splitScene'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { hasNodeDrivenTextAnimation } from '@/ui/hooks/useAnimatedValues'
import { applyTextAnimation, textAnimationDefaults, TEXT_ANIMATION_PRESETS } from './textAnimations'
import { migrateTextShimmer, readTextShimmer, resolveTextShimmer, setTextShimmer, setTextShimmerAnimatedValue, readTextShimmerRange, setTextShimmerRange, setTextShimmerEndpoint } from './textShimmerEffect'
import { getAnimEngine } from './engine'
import { findTrack, removeTrack } from './tracks'
import { textShimmerFill } from './textShimmer'

function setup() {
  const api = createSceneAPI()
  const id = api.createNode('text', null, { text: '100' })
  return { api, id }
}
function textNode(api: ReturnType<typeof createSceneAPI>, id: string) {
  const node = api.getNode(id)
  if (node?.kind !== 'text') throw new Error('Expected text')
  return node
}

describe('independent Shimmer effect', () => {
  it('stamps Start and End at the playhead and moves the same two timeline keys', () => {
    const { api, id } = setup()
    setTextShimmer(api, id, {}, 0)
    setTextShimmerEndpoint(api, id, 'start', 1)
    setTextShimmerEndpoint(api, id, 'end', 3)
    expect(readTextShimmerRange(api, id)).toEqual({ start: 1, end: 3 })
    const keys = findTrack(api, id, 'textShimmer.range')!.keyframes.map(key => key.id)
    setTextShimmerEndpoint(api, id, 'start', 2)
    setTextShimmerEndpoint(api, id, 'end', 4)
    expect(readTextShimmerRange(api, id)).toEqual({ start: 2, end: 4 })
    expect(findTrack(api, id, 'textShimmer.range')!.keyframes.map(key => key.id)).toEqual(keys)
    setTextShimmerEndpoint(api, id, 'end', 1)
    expect(readTextShimmerRange(api, id)!.end).toBe(1)
    expect(readTextShimmerRange(api, id)!.start).toBeLessThan(1)
  })

  it('stretches one complete sweep between its endpoints and restores ordinary text outside it', () => {
    const { api, id } = setup()
    setTextShimmer(api, id, { duration: 0.5, shimmerLoop: true }, 0)
    setTextShimmerRange(api, id, 1, 3)
    expect(readTextShimmerRange(api, id)).toEqual({ start: 1, end: 3 })
    const restoredDoc = new Y.Doc()
    applyBytesToScene(restoredDoc, sceneToBytes(api.doc))
    const restored = createSceneAPI(restoredDoc)
    const engine = getAnimEngine()
    engine.attach(restored)
    const config = textNode(restored, id).textShimmer!
    const paintAt = (time: number) => {
      engine.seek(time)
      return textShimmerFill(config, time, '#123456', engine.getSnapshot()[id])
    }
    expect(paintAt(0.9)).toEqual({ kind: 'solid', color: '#123456' })
    expect(paintAt(1).kind).toBe('linear')
    const during = paintAt(1.25)
    expect(during.kind).toBe('linear')
    expect(paintAt(2.25)).not.toEqual(during)
    expect(paintAt(2)).toEqual(textShimmerFill({ ...config, startTime: 1, duration: 2, shimmerLoop: false }, 2, '#123456'))
    expect(paintAt(3)).toEqual({ kind: 'solid', color: '#123456' })
    const track = findTrack(restored, id, 'textShimmer.range')!
    const stretched = { ...track, keyframes: track.keyframes.map((key, i) => ({ ...key, time: i === 0 ? 1 : 5 })) }
    engine.setTrackPreview(new Map([[track.id, stretched]]))
    expect(paintAt(1.5)).toEqual(during)
    engine.setTrackPreview(null)
    const moved = { ...track, keyframes: track.keyframes.map(key => ({ ...key, time: key.time + 1 })) }
    engine.setTrackPreview(new Map([[track.id, moved]]))
    expect(paintAt(1.25)).toEqual({ kind: 'solid', color: '#123456' })
    expect(paintAt(2.25)).toEqual(during)
    expect(paintAt(3.5).kind).toBe('linear')
    engine.setTrackPreview(null)
    restored.setTrack(moved)
    engine.seek(2.25)
    expect(engine.getSnapshot()[id]).toMatchObject({ shimmerStartTime: 2, shimmerEndTime: 4 })
    removeTrack(restored, track.id)
    expect(resolveTextShimmer(textNode(restored, id))).toBeNull()
    engine.pause()
  })

  it('ignores obsolete duration and loop settings when a range exists, including one-frame sweeps', () => {
    const { api, id } = setup()
    setTextShimmer(api, id, { duration: 8, shimmerLoop: true })
    setTextShimmerAnimatedValue(api, id, 'duration', 8, 0, true)
    setTextShimmerRange(api, id, 1, 2)
    expect(findTrack(api, id, 'textShimmer.duration')).toBeNull()
    expect(textNode(api, id).textShimmer).toMatchObject({ duration: 1, shimmerLoop: false })
    const config = { ...textNode(api, id).textShimmer!, duration: 10, shimmerLoop: true }
    const rangePaint = textShimmerFill(config, 1.5, '#111111', { shimmerStartTime: 1, shimmerEndTime: 2, shimmerDuration: 99 })
    expect(rangePaint).toEqual(textShimmerFill({ ...config, duration: 1, shimmerLoop: false }, 1.5))
    expect(textShimmerFill(config, 1 / 120, '#111111', { shimmerStartTime: 0, shimmerEndTime: 1 / 60 })).toEqual(rangePaint)
  })

  it('keeps timing endpoints valid and does not alter locked layers', () => {
    const { api, id } = setup()
    setTextShimmer(api, id, {})
    setTextShimmerRange(api, id, -2, 1000)
    expect(readTextShimmerRange(api, id)).toEqual({ start: 0, end: api.getMeta().duration })
    setTextShimmerRange(api, id, 2, 1)
    expect(readTextShimmerRange(api, id)!.end).toBeCloseTo(2 + 1 / api.getMeta().frameRate)
    api.setNodeProperty(id, 'locked', true)
    const tracks = api.getTracksForNode(id)
    expect(setTextShimmerRange(api, id, 0, 1)).toBeNull()
    expect(api.getTracksForNode(id)).toEqual(tracks)
  })

  it('records duration and length, interpolates their paint, and survives save/load', () => {
    const { api, id } = setup()
    setTextShimmer(api, id, {}, 0)
    applyTextAnimation(api, id, 'typewriter', 0)
    const textTracks = api.getTracksForNode(id)
    setTextShimmerAnimatedValue(api, id, 'duration', 1, 0, true)
    setTextShimmerAnimatedValue(api, id, 'duration', 3, 2, false)
    setTextShimmerAnimatedValue(api, id, 'shimmerWidth', 0.2, 0, true)
    setTextShimmerAnimatedValue(api, id, 'shimmerWidth', 0.8, 2, false)
    for (const track of textTracks) expect(api.getTrack(track.id)).toEqual(track)
    for (const property of ['textShimmer.duration', 'textShimmer.shimmerWidth'] as const) {
      const track = findTrack(api, id, property)!
      api.setTrack({ ...track, defaultEasing: 'linear', keyframes: track.keyframes.map(k => ({ ...k, easingOut: 'linear' })) })
    }
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    const restored = createSceneAPI(doc)
    const engine = getAnimEngine()
    engine.attach(restored)
    engine.seek(1)
    const animated = engine.getSnapshot()[id]!
    expect(animated.shimmerDuration).toBeCloseTo(2)
    expect(animated.shimmerWidth).toBeCloseTo(0.5)
    const config = textNode(restored, id).textShimmer!
    expect(textShimmerFill(config, 1, '#111111', animated)).toEqual(
      textShimmerFill({ ...config, duration: 2, shimmerWidth: 0.5 }, 1, '#111111'),
    )
    engine.seek(0)
    expect(engine.getSnapshot()[id]).toMatchObject({ shimmerDuration: 1, shimmerWidth: 0.2 })
    engine.seek(2)
    expect(engine.getSnapshot()[id]).toMatchObject({ shimmerDuration: 3, shimmerWidth: 0.8 })
    setTextShimmer(restored, id, null)
    expect(resolveTextShimmer(textNode(restored, id))).toBeNull()
    engine.pause()
  })

  it('leaves static edits unkeyed and ignores locked layers', () => {
    const { api, id } = setup()
    setTextShimmer(api, id, {})
    setTextShimmerAnimatedValue(api, id, 'duration', 4, 1, false)
    expect(textNode(api, id).textShimmer?.duration).toBe(4)
    expect(api.getTracksForNode(id)).toHaveLength(0)
    api.setNodeProperty(id, 'locked', true)
    setTextShimmerAnimatedValue(api, id, 'duration', 8, 1, true)
    expect(textNode(api, id).textShimmer?.duration).toBe(4)
    expect(api.getTracksForNode(id)).toHaveLength(0)
  })

  it('stacks with every text animation without modifying its tracks', () => {
    for (const preset of TEXT_ANIMATION_PRESETS.filter(p => p.id !== 'shimmer')) {
      const { api, id } = setup()
      applyTextAnimation(api, id, preset.id, 0)
      const tracks = api.getTracksForNode(id)
      applyTextAnimation(api, id, 'shimmer', 0.5)
      expect(api.getTracksForNode(id)).toEqual(tracks)
      expect(textNode(api, id).textAnimation?.id).toBe(preset.id)
      expect(resolveTextShimmer(textNode(api, id))?.startTime).toBe(0.5)
      setTextShimmer(api, id, { shimmerWidth: 0.6 })
      expect(api.getTracksForNode(id)).toEqual(tracks)
      setTextShimmer(api, id, null)
      expect(api.getTracksForNode(id)).toEqual(tracks)
      expect(resolveTextShimmer(textNode(api, id))).toBeNull()
    }
  })
  it('keeps Shimmer running when another animation is applied or replaced', () => {
    const { api, id } = setup()
    setTextShimmer(api, id, { shimmerColor: '#abcdef', duration: 3 }, 0.5)
    const shimmer = textNode(api, id).textShimmer
    applyTextAnimation(api, id, 'typewriter', 1)
    applyTextAnimation(api, id, 'fade', 1)
    expect(textNode(api, id).textShimmer).toEqual(shimmer)
    expect(hasNodeDrivenTextAnimation(api, [id])).toBe(true)
  })
  it('preserves legacy sweep timing and makes migration undoable', () => {
    const { api, id } = setup()
    const legacy = { ...textAnimationDefaults('shimmer'), shimmerColor: '#abcdef' }
    api.setNodeProperty(id, 'textAnimation', legacy)
    api.setTrack({ id: 'legacy', nodeId: id, propertyId: 'text.progress', defaultEasing: 'linear', textAnimation: legacy,
      keyframes: [{ id: 'a', time: 1, value: 0 }, { id: 'b', time: 5, value: 1 }] })
    const expected = readTextShimmer(api, textNode(api, id))
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    migrateTextShimmer(api, id)
    expect(textNode(api, id).textShimmer).toEqual(expected)
    expect(textNode(api, id).textShimmer).toMatchObject({ startTime: 1, duration: 4, shimmerColor: '#abcdef' })
    expect(api.getTracksForNode(id)).toHaveLength(0)
    expect(textNode(api, id).textAnimation).toBeNull()
    undo.undo()
    expect(api.getTrack('legacy')).not.toBeNull()
    expect(textNode(api, id).textShimmer).toBeUndefined()
    applyTextAnimation(api, id, 'fade', 0)
    expect(textNode(api, id).textShimmer).toEqual(expected)
    expect(api.getTracksForNode(id).every(t => t.textAnimation?.id !== 'shimmer')).toBe(true)
  })
  it('survives save/load, duplication and scene splitting without changing phase', () => {
    const { api, id } = setup()
    setTextShimmer(api, id, { duration: 3, shimmerWidth: 0.6 }, 1)
    applyTextAnimation(api, id, 'typewriter', 0)
    const copyDoc = new Y.Doc()
    applyBytesToScene(copyDoc, sceneToBytes(api.doc))
    const copy = createSceneAPI(copyDoc)
    expect(textNode(copy, id).textShimmer).toEqual(textNode(api, id).textShimmer)
    const duplicate = copy.createNode('text', null, textNode(copy, id))
    expect(textNode(copy, duplicate).textShimmer).toEqual(textNode(api, id).textShimmer)
    const before = textShimmerFill(textNode(copy, id).textShimmer!, 2)
    rebaseSceneNodes(copy, new Set([id]), 1.5)
    expect(textShimmerFill(textNode(copy, id).textShimmer!, 0.5)).toEqual(before)
  })
  it('does not change locked text', () => {
    const { api, id } = setup()
    api.setNodeProperty(id, 'locked', true)
    setTextShimmer(api, id, {})
    expect(textNode(api, id).textShimmer).toBeUndefined()
  })
})
