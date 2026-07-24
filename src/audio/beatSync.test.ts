// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  alignKeyframesToNoteMarkers,
  analyzeBeatPcm,
  createNoteMarkers,
} from './beatSync'

describe('analyzeBeatPcm', () => {
  it('detects a synthetic 120 BPM click track and beat-aligned transients', () => {
    const sampleRate = 8_000
    const duration = 8
    const samples = new Float32Array(sampleRate * duration)
    for (let time = 0.25; time < duration; time += 0.5) {
      const start = Math.round(time * sampleRate)
      for (let i = 0; i < 80; i++) {
        samples[start + i] = Math.exp(-i / 14) * (i % 2 === 0 ? 1 : -1)
      }
    }

    const result = analyzeBeatPcm(
      { sampleRate, channels: [samples] },
      { minBpm: 90, maxBpm: 150 },
    )

    expect(result.bpm).toBeCloseTo(120, 0)
    expect(result.firstBeatTime).toBeCloseTo(0.25, 1)
    expect(result.transients.length).toBeGreaterThanOrEqual(14)
    expect(result.beatTransients.length).toBe(result.transients.length)
  })

  it('keeps strong off-grid transients out of beat markers', () => {
    const sampleRate = 8_000
    const samples = new Float32Array(sampleRate * 6)
    for (let time = 0.2; time < 6; time += 0.5) {
      samples[Math.round(time * sampleRate)] = 1
    }
    samples[Math.round(2.45 * sampleRate)] = 1

    const result = analyzeBeatPcm(
      { sampleRate, channels: [samples] },
      { minBpm: 110, maxBpm: 130, beatToleranceMs: 70 },
    )

    expect(result.transients.some((item) => Math.abs(item.time - 2.45) < 0.03))
      .toBe(true)
    expect(result.beatTransients.some((item) => Math.abs(item.time - 2.45) < 0.03))
      .toBe(false)
  })
})

describe('createNoteMarkers', () => {
  it('creates eighth-note slots across one four-four bar', () => {
    const markers = createNoteMarkers(
      { bpm: 120, firstBeatTime: 0, beatsPerBar: 4, beatUnit: 4 },
      { startBar: 1, endBar: 1, division: 8 },
    )

    expect(markers).toHaveLength(9)
    expect(markers.map((marker) => marker.time)).toEqual([
      0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
    ])
    expect(markers[0]).toMatchObject({ bar: 1, beat: 1, subdivision: 1 })
    expect(markers[8]).toMatchObject({ bar: 2, beat: 1, isBarStart: true })
  })

  it('supports a sixteenth-note override spanning arbitrary bars', () => {
    const markers = createNoteMarkers(
      { bpm: 120, firstBeatTime: 0.1, beatsPerBar: 4, beatUnit: 4 },
      { startBar: 2, endBar: 3, division: 16 },
    )

    expect(markers).toHaveLength(33)
    expect(markers[0]!.time).toBeCloseTo(2.1)
    expect(markers.at(-1)!.time).toBeCloseTo(6.1)
  })

  it('supports coarser half-note divisions', () => {
    const markers = createNoteMarkers(
      { bpm: 120, firstBeatTime: 0, beatsPerBar: 4, beatUnit: 4 },
      { startBar: 1, endBar: 1, division: 2 },
    )

    expect(markers.map((marker) => marker.time)).toEqual([0, 1, 2])
    expect(markers.map((marker) => marker.beat)).toEqual([1, 3, 1])
  })
})

describe('alignKeyframesToNoteMarkers', () => {
  const markers = createNoteMarkers(
    { bpm: 120, firstBeatTime: 0, beatsPerBar: 4, beatUnit: 4 },
    { startBar: 1, endBar: 1, division: 8 },
  )

  it('spreads keyframes evenly over the available note boundaries', () => {
    const result = alignKeyframesToNoteMarkers([0.1, 0.4, 1.1, 1.8, 1.95], markers)
    expect(result.ok).toBe(true)
    expect(result.times).toEqual([0, 0.5, 1, 1.5, 2])
  })

  it('snaps one keyframe to its nearest note boundary', () => {
    expect(alignKeyframesToNoteMarkers([0.63], markers).times).toEqual([0.75])
  })

  it('asks for a finer grid instead of stacking too many keyframes', () => {
    const result = alignKeyframesToNoteMarkers(
      Array.from({ length: 10 }, (_, index) => index / 10),
      markers,
    )
    expect(result).toMatchObject({
      ok: false,
      availableSlots: 9,
      reason: 'insufficient-grid-slots',
    })
  })
})
