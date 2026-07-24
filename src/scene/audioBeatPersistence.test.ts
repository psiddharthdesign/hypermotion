// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI, snapshotScene } from './doc'

describe('audio beat persistence', () => {
  it('round-trips analysis, musical grid, subdivisions, and volume', () => {
    const api = createSceneAPI()
    const audioId = api.createNode('audio', null, {
      src: 'data:audio/wav;base64,AA==',
      duration: 4,
      trimEnd: 4,
      volume: 0.42,
      beatAnalysis: {
        bpm: 120,
        confidence: 0.9,
        firstBeatTime: 0.1,
        transients: [{ time: 0.1, strength: 1 }],
        beatTransients: [{ time: 0.1, strength: 1 }],
        candidates: [{ bpm: 120, confidence: 0.9 }],
      },
      beatGrid: {
        version: 1,
        bpm: 120,
        firstBeatTime: 0.1,
        beatsPerBar: 4,
        beatUnit: 4,
        subdivisions: [
          { id: 'bars-2-3', startBar: 2, endBar: 3, division: 16 },
        ],
      },
    })

    const node = api.getNode(audioId)
    expect(node?.kind).toBe('audio')
    if (!node || node.kind !== 'audio') return
    expect(node.volume).toBe(0.42)
    expect(node.beatAnalysis?.bpm).toBe(120)
    expect(node.beatGrid?.subdivisions[0]).toMatchObject({
      startBar: 2,
      endBar: 3,
      division: 16,
    })
    expect(snapshotScene(api).nodes[audioId]).toEqual(node)
  })
})
