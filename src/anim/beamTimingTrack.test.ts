// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { applyBytesToScene, sceneToBytes } from '@/scene/file'
import { effectBeamRangePropertyId, propertyDescriptor } from '@/scene/props'
import { beamTiming } from '@/scene/borderBeam'
import { rebaseSceneNodes } from '@/project/splitScene'
import { getAnimEngine } from './engine'
import { findTrack, removeTrack } from './tracks'
import { readBeamRange, resolveBeamRanges, setBeamRange, stampBeamEndpoint } from './beamTimingTrack'

function setup() {
  const api = createSceneAPI()
  const id = api.createNode('rect', null)
  const node = api.getNode(id)!
  api.setNodeProperty(id, 'appearance', { ...node.appearance, effects: [
    { id: 'first', kind: 'border-beam', fadeIn: 0, fadeOut: 0 },
    { id: 'second', kind: 'border-beam', duration: 10 },
  ] })
  return { api, id }
}

describe('Beam endpoint keyframes', () => {
  it('stamps two stable keys and makes the interval control the beam cycle', () => {
    const { api, id } = setup()
    stampBeamEndpoint(api, id, 'first', 'start', 1)
    stampBeamEndpoint(api, id, 'first', 'end', 3)
    const track = findTrack(api, id, effectBeamRangePropertyId('first'))!
    expect(propertyDescriptor(track.propertyId)?.label).toBe('Beam')
    expect(readBeamRange(api, id, 'first')).toEqual({ start: 1, end: 3 })
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    const restored = createSceneAPI(doc)
    const engine = getAnimEngine()
    engine.attach(restored)
    const at = (time: number) => {
      engine.seek(time)
      const effects = resolveBeamRanges(restored.getNode(id)!.appearance.effects, engine.getSnapshot()[id]?.effectBeamRange)
      expect(effects[1]).toEqual(restored.getNode(id)!.appearance.effects[1])
      const beam = effects[0]!
      if (beam.kind !== 'border-beam') throw new Error('Missing Beam')
      return beamTiming(beam, time)
    }
    expect(at(.9).opacity).toBe(0)
    expect(at(2)).toMatchObject({ phase: .5, opacity: 1 })
    expect(at(3).opacity).toBe(0)
    const stretched = { ...track, keyframes: track.keyframes.map((k, i) => ({ ...k, time: i ? 5 : 1 })) }
    engine.setTrackPreview(new Map([[track.id, stretched]]))
    expect(at(3)).toMatchObject({ phase: .5, opacity: 1 })
    engine.setTrackPreview(null)
    expect(at(3).opacity).toBe(0)
    stampBeamEndpoint(restored, id, 'first', 'end', 4)
    expect(findTrack(restored, id, track.propertyId)!.keyframes.map(k => k.id)).toEqual(track.keyframes.map(k => k.id))
    removeTrack(restored, track.id)
    expect(restored.getNode(id)!.appearance.effects[0]).toMatchObject({ active: false })
    engine.pause()
  })

  it('preserves phase and fades across scene splits and respects locked nodes', () => {
    const { api, id } = setup()
    setBeamRange(api, id, 'first', 1, 5)
    const engine = getAnimEngine()
    engine.attach(api)
    const at = (time: number) => {
      engine.seek(time)
      const node = api.getNode(id)!
      const e = resolveBeamRanges(node.appearance.effects, engine.getSnapshot()[id]?.effectBeamRange, node.proceduralTimeOffset)[0]!
      if (e.kind !== 'border-beam') throw new Error('Missing Beam')
      return beamTiming(e, time + (node.proceduralTimeOffset ?? 0))
    }
    const before = at(3)
    rebaseSceneNodes(api, new Set([id]), 2)
    expect(at(1)).toEqual(before)
    const tracks = api.getTracksForNode(id)
    api.setNodeProperty(id, 'locked', true)
    stampBeamEndpoint(api, id, 'first', 'end', 6)
    expect(api.getTracksForNode(id)).toEqual(tracks)
    engine.pause()
  })
})
