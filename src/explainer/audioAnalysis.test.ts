// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { BeatAnalysis } from '@/audio/beatSync'
import { toExplainerAudioAnalysis } from './audioAnalysis'

function analysis(
  patch: Partial<BeatAnalysis> = {},
): BeatAnalysis {
  return {
    bpm: 120,
    confidence: 0.82,
    status: 'ok',
    algorithmVersion: 3,
    firstBeatTime: 0.25,
    transients: [],
    beatTransients: [],
    candidates: [],
    ...patch,
  }
}

describe('toExplainerAudioAnalysis', () => {
  it('creates a stable beat and downbeat grid across the source', () => {
    const result = toExplainerAudioAnalysis(analysis(), 2.3, {
      sourceRefId: 'audio-theme',
    })

    expect(result).toMatchObject({
      sourceRefId: 'audio-theme',
      durationSeconds: 2.3,
      bpm: 120,
      firstBeatTime: 0.25,
      confidence: 0.82,
      beats: [0.25, 0.75, 1.25, 1.75, 2.25],
      downbeats: [0.25, 2.25],
    })
  })

  it('keeps only the strongest in-range energy peaks in time order', () => {
    const transients = Array.from({ length: 15 }, (_, index) => ({
      time: index * 0.1,
      strength: index / 15,
    }))
    const result = toExplainerAudioAnalysis(
      analysis({ transients }),
      1.4,
    )

    expect(result.energyPeaks).toHaveLength(12)
    expect(result.energyPeaks).toEqual(
      [...result.energyPeaks!].sort((a, b) => a - b),
    )
    expect(result.energyPeaks).not.toContain(0)
  })

  it('does not invent a tempo grid when analysis found no pulse', () => {
    const result = toExplainerAudioAnalysis(
      analysis({
        status: 'no-pulse',
        bpm: 120,
        confidence: 0,
        firstBeatTime: 0,
      }),
      12,
    )

    expect(result).toEqual({
      durationSeconds: 12,
      confidence: 0,
    })
  })
})
