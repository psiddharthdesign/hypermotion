// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { sceneToBytes, applyBytesToScene } from '@/scene/file'
import { rebaseSceneNodes } from '@/project/splitScene'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { hasNodeDrivenTextAnimation } from '@/ui/hooks/useAnimatedValues'
import { applyTextAnimation, textAnimationDefaults, TEXT_ANIMATION_PRESETS } from './textAnimations'
import { migrateTextShimmer, readTextShimmer, resolveTextShimmer, setTextShimmer } from './textShimmerEffect'
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
