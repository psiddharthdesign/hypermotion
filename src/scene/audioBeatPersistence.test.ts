// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { AudioBeatGrid, BeatAnalysis } from '@/audio/beatSync'
import { createSceneAPI, snapshotScene } from './doc'

describe('audio beat persistence', () => {
  it('round-trips analysis, swing, subdivisions, and volume', () => {
    const api = createSceneAPI()
    const beatAnalysis: BeatAnalysis = {
      algorithmVersion: 3,
      status: 'ambiguous',
      bpm: 135,
      confidence: 0.74,
      firstBeatTime: 0.1,
      transients: [{ time: 0.1, strength: 1 }],
      beatTransients: [{ time: 0.1, strength: 1 }],
      candidates: [
        {
          bpm: 135,
          confidence: 0.74,
          relationship: '3:2',
          firstBeatTime: 0.1,
        },
        {
          bpm: 90,
          confidence: 0.68,
          relationship: 'direct',
          firstBeatTime: 0.12,
        },
      ],
    }
    const beatGrid: AudioBeatGrid = {
      version: 1,
      bpm: 135,
      firstBeatTime: 0.1,
      beatsPerBar: 4,
      beatUnit: 4,
      swingPercent: 66.7,
      subdivisions: [
        { id: 'bars-2-3', startBar: 2, endBar: 3, division: 16 },
      ],
    }
    const audioId = api.createNode('audio', null, {
      src: 'data:audio/wav;base64,AA==',
      duration: 4,
      trimEnd: 4,
      volume: 0.42,
      beatAnalysis,
      beatGrid,
    })

    const node = api.getNode(audioId)
    expect(node?.kind).toBe('audio')
    if (!node || node.kind !== 'audio') return
    expect(node.volume).toBe(0.42)
    expect(node.beatAnalysis).toEqual(beatAnalysis)
    expect(node.beatAnalysis?.algorithmVersion).toBe(3)
    expect(node.beatAnalysis?.candidates[0]?.relationship).toBe('3:2')
    expect(node.beatGrid).toEqual(beatGrid)
    expect(node.beatGrid?.swingPercent).toBe(66.7)
    expect(node.beatGrid?.subdivisions[0]).toMatchObject({
      startBar: 2,
      endBar: 3,
      division: 16,
    })
    expect(snapshotScene(api).nodes[audioId]).toEqual(node)
  })
})
