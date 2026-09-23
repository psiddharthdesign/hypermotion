// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { sceneToBytes, applyBytesToScene } from '@/scene/file'
import { DEFAULT_BEND_DEFORMATION, normalizeLayerDeformation } from '@/scene/deformation'
import { propertyDescriptor } from '@/scene/props'
import { keyframeValuesForPatch } from './recordKeyframes'
import { getAnimEngine } from './engine'
import { resolveBendDeformation } from '@/render3d/bendDeformation'

describe('Wave animation persistence', () => {
  it('saves wave settings and interpolates every wave control on the timeline', () => {
    const api = createSceneAPI()
    const id = api.createNode('rect', null, { deformation: { ...DEFAULT_BEND_DEFORMATION, mode: 'wave' } })
    const patch = { waveAmplitude: 80, waveFrequency: 8, wavePhase: 720, waveStart: .2, waveEnd: .8, waveFalloff: .4 }
    const entries = keyframeValuesForPatch('deformation', patch)
    expect(entries).toHaveLength(6)
    for (const { propertyId, value } of entries) {
      expect(propertyDescriptor(propertyId)?.layoutAffecting).toBe(false)
      api.setTrack({ id: propertyId, nodeId: id, propertyId, defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 2, value }] })
    }
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    const restored = createSceneAPI(doc)
    expect(restored.getNode(id)?.deformation).toMatchObject({ mode: 'wave', waveAmplitude: 40, waveFrequency: 2 })
    const engine = getAnimEngine()
    engine.attach(restored)
    engine.seek(1)
    const first = engine.getSnapshot()[id]
    expect(resolveBendDeformation(restored.getNode(id)?.deformation, first, 400, 200)).toMatchObject({ waveAmplitude: 40, waveFrequency: 4, wavePhase: 360, waveStart: .1, waveEnd: .4, waveFalloff: .2 })
    engine.seek(2); engine.seek(1)
    expect(engine.getSnapshot()[id]).toEqual(first)
    engine.pause(); api.doc.destroy(); doc.destroy()
  })
  it('keeps legacy bends circular and bounds malformed wave controls', () => {
    expect(normalizeLayerDeformation({ kind: 'bend', angle: 45 })).toMatchObject({ mode: 'arc', angle: 45 })
    expect(normalizeLayerDeformation({ kind: 'bend', mode: 'wave', waveAmplitude: Infinity, waveFrequency: -1, wavePhase: NaN, waveStart: -5, waveEnd: 4, waveFalloff: 9 })).toMatchObject({ mode: 'wave', waveAmplitude: 40, waveFrequency: 0, wavePhase: 0, waveStart: 0, waveEnd: 1, waveFalloff: .5 })
  })
})
