// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  alignKeyframesToNoteMarkers,
  analyzeBeatPcm,
  beatAnchorAfterTrimChange,
  createNoteMarkers,
  createNoteMarkersForBars,
  divisionForBar,
  inferBeatPhaseAtBpm,
  musicalBarSegmentsForRange,
  recurringBeatAtOrAfter,
  spreadKeyframesAcrossNoteMarkers,
} from './beatSync'

function addSyntheticClick(
  samples: Float32Array,
  sampleRate: number,
  time: number,
  amplitude: number,
): void {
  const start = Math.round(time * sampleRate)
  for (let i = 0; i < 72 && start + i < samples.length; i++) {
    samples[start + i] +=
      amplitude * Math.exp(-i / 14) * (i % 2 === 0 ? 1 : -1)
  }
}

function compoundAccentTrack(
  bpm: number,
  duration = 18,
  startTime = 0.2,
): { sampleRate: number; samples: Float32Array } {
  const sampleRate = 8_000
  const samples = new Float32Array(sampleRate * duration)
  const beatSeconds = 60 / bpm
  for (let time = startTime; time < duration; time += beatSeconds) {
    addSyntheticClick(samples, sampleRate, time, 0.55)
  }
  for (let time = startTime; time < duration; time += beatSeconds * 1.5) {
    addSyntheticClick(samples, sampleRate, time, 1)
  }
  return { sampleRate, samples }
}

function subdividedAccentTrack(
  bpm: number,
  subdivisions: number,
  duration = 18,
  startTime = 0.2,
): { sampleRate: number; samples: Float32Array } {
  const sampleRate = 8_000
  const samples = new Float32Array(sampleRate * duration)
  const stepSeconds = 60 / bpm / subdivisions
  let step = 0
  for (let time = startTime; time < duration; time += stepSeconds) {
    addSyntheticClick(
      samples,
      sampleRate,
      time,
      step % subdivisions === 0 ? 1 : 0.35,
    )
    step++
  }
  return { sampleRate, samples }
}

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
    for (const candidate of result.candidates) {
      const period = 60 / candidate.bpm
      const phase = candidate.firstBeatTime
      expect(phase).toBeTypeOf('number')
      if (phase === undefined) throw new Error('candidate phase was not inferred')
      expect(phase).toBeGreaterThanOrEqual(0)
      expect(phase).toBeLessThan(period)
    }
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

  it('reports the half/double-time alternatives for an ambiguous alternating accent', () => {
    const sampleRate = 8_000
    const duration = 10
    const beatSeconds = 60 / 148
    const samples = new Float32Array(sampleRate * duration)
    let beat = 0
    for (let time = 0.2; time < duration; time += beatSeconds) {
      const start = Math.round(time * sampleRate)
      const amplitude = beat % 2 === 0 ? 1 : 0.36
      for (let i = 0; i < 64; i++) {
        samples[start + i] =
          amplitude * Math.exp(-i / 12) * (i % 2 === 0 ? 1 : -1)
      }
      beat++
    }

    const result = analyzeBeatPcm({ sampleRate, channels: [samples] })

    expect(result.status).toBe('ambiguous')
    expect(result.candidates.some((candidate) => Math.abs(candidate.bpm - 148) < 1))
      .toBe(true)
    expect(result.candidates.some((candidate) => candidate.bpm < 80)).toBe(true)
  })

  it('promotes a persistent 114 BPM quarter pulse over its 76 BPM dotted accent', () => {
    const { sampleRate, samples } = compoundAccentTrack(114)

    const result = analyzeBeatPcm({ sampleRate, channels: [samples] })

    expect(result.bpm, JSON.stringify(result.candidates)).toBeCloseTo(114, 0)
    expect(result.status).toBe('ambiguous')
    expect(result.candidates[0]).toMatchObject({ relationship: '3:2' })
    expect(result.candidates.some(
      (candidate) =>
        Math.abs(candidate.bpm - 76) < 1 &&
        candidate.relationship === 'direct',
    )).toBe(true)
  })

  it('promotes a persistent 135 BPM quarter pulse over its 90 BPM dotted accent', () => {
    const startTime = 0.23
    const { sampleRate, samples } = compoundAccentTrack(135, 18, startTime)

    const result = analyzeBeatPcm({ sampleRate, channels: [samples] })

    expect(result.bpm, JSON.stringify(result.candidates)).toBeCloseTo(135, 0)
    expect(result.status).toBe('ambiguous')
    expect(result.candidates[0]).toMatchObject({ relationship: '3:2' })
    expect(result.candidates[0]!.firstBeatTime).toBeCloseTo(startTime, 1)
    expect(result.candidates.slice(0, 2).some(
      (candidate) =>
        Math.abs(candidate.bpm - 90) < 1 &&
        candidate.relationship === 'direct',
    )).toBe(true)
  })

  it('keeps a straight 90 BPM pulse selected while surfacing 135 BPM as 3:2', () => {
    const sampleRate = 8_000
    const duration = 18
    const samples = new Float32Array(sampleRate * duration)
    for (let time = 0.2; time < duration; time += 60 / 90) {
      addSyntheticClick(samples, sampleRate, time, 1)
    }

    const result = analyzeBeatPcm({ sampleRate, channels: [samples] })

    expect(result.bpm, JSON.stringify(result.candidates)).toBeCloseTo(90, 0)
    expect(result.candidates.slice(0, 4).some(
      (candidate) =>
        Math.abs(candidate.bpm - 135) < 2 &&
        candidate.relationship === '3:2',
    )).toBe(true)
  })

  it('does not reinterpret a 90 BPM track because of one short triplet fill', () => {
    const sampleRate = 8_000
    const duration = 18
    const samples = new Float32Array(sampleRate * duration)
    for (let time = 0.2; time < duration; time += 60 / 90) {
      addSyntheticClick(samples, sampleRate, time, 1)
    }
    for (let time = 6.2; time < 7.6; time += 60 / 135) {
      addSyntheticClick(samples, sampleRate, time, 0.7)
    }

    const result = analyzeBeatPcm({ sampleRate, channels: [samples] })

    expect(result.bpm, JSON.stringify(result.candidates)).toBeCloseTo(90, 0)
  })

  it.each([
    { bpm: 120, subdivisions: 2, label: '120 BPM eighth notes' },
    { bpm: 114, subdivisions: 2, label: '114 BPM eighth notes' },
    { bpm: 135, subdivisions: 2, label: '135 BPM eighth notes' },
    { bpm: 90, subdivisions: 3, label: '90 BPM triplets' },
  ])(
    'keeps the direct pulse for persistent $label',
    ({ bpm, subdivisions }) => {
      const { sampleRate, samples } = subdividedAccentTrack(
        bpm,
        subdivisions,
      )

      const result = analyzeBeatPcm({ sampleRate, channels: [samples] })

      expect(result.bpm, JSON.stringify(result.candidates)).toBeCloseTo(bpm, 0)
      expect(result.candidates[0]).toMatchObject({ relationship: 'direct' })
    },
  )

  it('infers a fresh phase for a manually supplied compound tempo', () => {
    const startTime = 0.27
    const transients = Array.from({ length: 24 }, (_, index) => ({
      time: startTime + index * 60 / 135,
      strength: 1,
    }))

    const phase = inferBeatPhaseAtBpm(transients, 135)

    expect(phase).toBeCloseTo(startTime, 1)
    expect(inferBeatPhaseAtBpm(transients, 0)).toBe(0)
    expect(inferBeatPhaseAtBpm([], 135)).toBe(0)
  })

  it('keeps the true low pulse available when a five-over-four figure dominates', () => {
    const sampleRate = 8_000
    const duration = 24
    const beatSeconds = 60 / 75
    const barSeconds = beatSeconds * 4
    const samples = new Float32Array(sampleRate * duration)
    const addTone = (
      time: number,
      amplitude: number,
      frequency: number,
      length: number,
    ) => {
      const start = Math.round(time * sampleRate)
      for (let i = 0; i < length; i++) {
        samples[start + i] +=
          amplitude *
          Math.exp(-i / (length / 3)) *
          Math.sin(2 * Math.PI * frequency * i / sampleRate)
      }
    }
    for (let time = 0.2; time < duration; time += beatSeconds) {
      addTone(time, 0.22, 80, 560)
    }
    for (let bar = 0.2; bar < duration; bar += barSeconds) {
      for (let accent = 0; accent < 5; accent++) {
        addTone(bar + accent * barSeconds / 5, 1.2, 2_400, 128)
      }
    }

    const result = analyzeBeatPcm({ sampleRate, channels: [samples] })

    expect(result.status).toBe('ambiguous')
    expect(result.candidates.some((candidate) => Math.abs(candidate.bpm - 75) < 1))
      .toBe(true)
  })

  it.each([75, 114])('detects a stable %i BPM pulse without ratio-specific rules', (bpm) => {
    const sampleRate = 8_000
    const duration = 18
    const beatSeconds = 60 / bpm
    const samples = new Float32Array(sampleRate * duration)
    const addClick = (time: number, amplitude: number) => {
      const start = Math.round(time * sampleRate)
      for (let i = 0; i < 72; i++) {
        samples[start + i] +=
          amplitude * Math.exp(-i / 14) * (i % 2 === 0 ? 1 : -1)
      }
    }
    for (let time = 0.17; time < duration; time += beatSeconds) {
      addClick(time, 1)
      // A weak syncopated hit prevents this from being a sterile metronome.
      if (time + beatSeconds * 0.37 < duration) {
        addClick(time + beatSeconds * 0.37, 0.12)
      }
    }

    const result = analyzeBeatPcm({ sampleRate, channels: [samples] })

    expect(result.bpm, JSON.stringify(result.candidates)).toBeCloseTo(bpm, 0)
    expect(result.status).not.toBe('no-pulse')
  })

  it('returns no-pulse instead of a fabricated 60 or 120 BPM for silence', () => {
    const result = analyzeBeatPcm({
      sampleRate: 8_000,
      channels: [new Float32Array(8_000 * 8)],
    })

    expect(result).toMatchObject({
      status: 'no-pulse',
      confidence: 0,
      firstBeatTime: 0,
      candidates: [],
      beatTransients: [],
    })
  })

  it('returns no-pulse for deterministic broadband noise', () => {
    const samples = new Float32Array(8_000 * 8)
    let seed = 0x1234_5678
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      samples[i] = ((seed / 0xffff_ffff) * 2 - 1) * 0.2
    }

    const result = analyzeBeatPcm({ sampleRate: 8_000, channels: [samples] })

    expect(result.status, JSON.stringify(result)).toBe('no-pulse')
    expect(result.confidence).toBe(0)
    expect(result.candidates).toEqual([])
  })

  it('preserves pulse evidence in antiphase stereo', () => {
    const sampleRate = 8_000
    const left = new Float32Array(sampleRate * 8)
    const right = new Float32Array(sampleRate * 8)
    for (let time = 0.2; time < 8; time += 0.5) {
      const start = Math.round(time * sampleRate)
      for (let i = 0; i < 64; i++) {
        const sample = Math.exp(-i / 12) * (i % 2 === 0 ? 1 : -1)
        left[start + i] = sample
        right[start + i] = -sample
      }
    }

    const result = analyzeBeatPcm(
      { sampleRate, channels: [left, right] },
      { minBpm: 90, maxBpm: 150 },
    )

    expect(result.bpm).toBeCloseTo(120, 0)
    expect(result.status).not.toBe('no-pulse')
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

  it('keeps 50 percent swing exactly straight', () => {
    const markers = createNoteMarkers(
      {
        bpm: 120,
        firstBeatTime: 0,
        beatsPerBar: 4,
        beatUnit: 4,
        swingPercent: 50,
      },
      { startBar: 1, endBar: 1, division: 8 },
    )

    expect(markers.map((marker) => marker.time)).toEqual([
      0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
    ])
  })

  it('moves alternating eighth notes to a triplet feel without moving beats', () => {
    const markers = createNoteMarkers(
      {
        bpm: 120,
        firstBeatTime: 0,
        beatsPerBar: 4,
        beatUnit: 4,
        swingPercent: 200 / 3,
      },
      { startBar: 1, endBar: 1, division: 8 },
    )

    expect(markers[0]!.time).toBe(0)
    expect(markers[1]!.time).toBeCloseTo(1 / 3, 7)
    expect(markers[2]!.time).toBe(0.5)
    expect(markers[3]!.time).toBeCloseTo(5 / 6, 7)
    expect(markers.at(-1)!.time).toBe(2)
  })

  it('swings alternating sixteenths while preserving pair and bar boundaries', () => {
    const markers = createNoteMarkers(
      {
        bpm: 120,
        firstBeatTime: 0,
        beatsPerBar: 4,
        beatUnit: 4,
        swingPercent: 200 / 3,
      },
      { startBar: 1, endBar: 1, division: 16 },
    )

    expect(markers.slice(0, 5).map((marker) => marker.time)).toEqual([
      0,
      expect.closeTo(1 / 6, 7),
      0.25,
      expect.closeTo(5 / 12, 7),
      0.5,
    ])
    expect(markers.at(-1)!.time).toBe(2)
  })

  it('does not move quarter-note grids when swing is enabled', () => {
    const markers = createNoteMarkers(
      {
        bpm: 120,
        firstBeatTime: 0.1,
        beatsPerBar: 4,
        beatUnit: 4,
        swingPercent: 75,
      },
      { startBar: 1, endBar: 1, division: 4 },
    )

    expect(markers.map((marker) => marker.time)).toEqual([
      0.1, 0.6, 1.1, 1.6, 2.1,
    ])
  })
})

describe('alignKeyframesToNoteMarkers', () => {
  const markers = createNoteMarkers(
    { bpm: 120, firstBeatTime: 0, beatsPerBar: 4, beatUnit: 4 },
    { startBar: 1, endBar: 1, division: 8 },
  )

  it('snaps events to their nearest available note boundaries', () => {
    const result = alignKeyframesToNoteMarkers([0.1, 0.4, 1.1, 1.8, 1.95], markers)
    expect(result.ok).toBe(true)
    expect(result.times).toEqual([0, 0.5, 1, 1.75, 2])
  })

  it('snaps one keyframe to its nearest note boundary', () => {
    expect(alignKeyframesToNoteMarkers([0.63], markers).times).toEqual([0.75])
  })

  it('reports fixed-marker exhaustion instead of stacking keyframes', () => {
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

  it('pushes later events forward when their nearest point is occupied', () => {
    const result = alignKeyframesToNoteMarkers([0.24, 0.26, 0.27], markers)

    expect(result.ok).toBe(true)
    expect(result.times).toEqual([0.25, 0.5, 0.75])
  })

  it('maps one event per note without stretching onto the next bar', () => {
    const result = alignKeyframesToNoteMarkers(
      Array.from({ length: 8 }, (_, index) => index / 10),
      markers,
    )

    expect(result.ok).toBe(true)
    expect(result.times).toEqual([
      0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75,
    ])
  })

  it('keeps coincident property keyframes on the same beat', () => {
    const result = alignKeyframesToNoteMarkers(
      [0.1, 0.1, 0.9, 0.905, 1.8, 1.8],
      markers,
      { coincidentTolerance: 0.01 },
    )

    expect(result.ok).toBe(true)
    expect(result.times).toEqual([0, 0, 1, 1, 1.75, 1.75])
  })

  it('never overlaps coincident keyframes owned by the same track', () => {
    const result = alignKeyframesToNoteMarkers(
      [0.1, 0.1],
      markers,
      { coincidenceKeys: ['track', 'track'] },
    )

    expect(result.ok).toBe(true)
    expect(result.times).toEqual([0, 0.25])
  })

  it('keeps the following bar boundary available as a nearest point', () => {
    const result = alignKeyframesToNoteMarkers(
      [0.02, 0.52, 1.02, 1.98],
      markers,
    )

    expect(result.ok).toBe(true)
    expect(result.times).toEqual([0, 0.5, 1, 2])
  })
})

describe('spreadKeyframesAcrossNoteMarkers', () => {
  const markers = createNoteMarkers(
    { bpm: 120, firstBeatTime: 0, beatsPerBar: 4, beatUnit: 4 },
    { startBar: 1, endBar: 3, division: 4 },
  )

  it('increases spacing by note-slot ordinal across the preferred range', () => {
    const result = spreadKeyframesAcrossNoteMarkers(
      [0, 0.5, 1, 1.5, 2, 2.5, 3],
      markers,
      { preferredEndTime: 4 },
    )

    expect(result.ok).toBe(true)
    expect(result.times).toEqual([0, 0.5, 1.5, 2, 2.5, 3.5, 4])
  })

  it('cascades beyond the preferred range instead of overlapping events', () => {
    const result = spreadKeyframesAcrossNoteMarkers(
      [0, 0.5, 1.5, 2, 2.5, 3.5, 4],
      markers,
      { preferredEndTime: 2 },
    )

    expect(result.ok).toBe(true)
    expect(result.times).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3])
  })
})

describe('bar subdivision overrides', () => {
  const grid = {
    version: 1 as const,
    bpm: 120,
    firstBeatTime: 0,
    beatsPerBar: 4,
    beatUnit: 4 as const,
    subdivisions: [
      { id: 'eighths', startBar: 2, endBar: 3, division: 8 as const },
      { id: 'sixteenths', startBar: 3, endBar: 3, division: 16 as const },
    ],
  }

  it('uses the last matching override for a bar', () => {
    expect(divisionForBar(grid, 1)).toBe(4)
    expect(divisionForBar(grid, 2)).toBe(8)
    expect(divisionForBar(grid, 3)).toBe(16)
  })

  it('joins differently subdivided bars without duplicate boundaries', () => {
    const markers = createNoteMarkersForBars(grid, 1, 3)
    expect(markers.filter((marker) => marker.bar === 1)).toHaveLength(4)
    expect(markers.filter((marker) => marker.bar === 2)).toHaveLength(8)
    expect(markers.filter((marker) => marker.bar === 3)).toHaveLength(16)
    expect(markers.at(-1)).toMatchObject({ bar: 4, isBarStart: true })
  })
})

describe('musicalBarSegmentsForRange', () => {
  const grid = {
    bpm: 120,
    firstBeatTime: 0,
    beatsPerBar: 4,
    beatUnit: 4 as const,
  }

  it('keeps a late detected downbeat as a separate lead-in', () => {
    expect(
      musicalBarSegmentsForRange(
        { ...grid, firstBeatTime: 0.25 },
        0,
        4.25,
      ),
    ).toEqual([
      { bar: 1, startTime: 0, endTime: 0.25, isLeadIn: true },
      { bar: 1, startTime: 0.25, endTime: 2.25, isLeadIn: false },
      { bar: 2, startTime: 2.25, endTime: 4.25, isLeadIn: false },
    ])
  })

  it('labels a partial bar correctly when the clip starts mid-bar', () => {
    expect(musicalBarSegmentsForRange(grid, 2.5, 5)).toEqual([
      { bar: 2, startTime: 2.5, endTime: 4, isLeadIn: false },
      { bar: 3, startTime: 4, endTime: 5, isLeadIn: false },
    ])
  })

  it('starts Bar 1 at the clip in-point for a manually anchored tempo', () => {
    const secondsPerBar = 60 / 135 * 4
    const segments = musicalBarSegmentsForRange(
      { ...grid, bpm: 135 },
      0,
      secondsPerBar * 2,
    )

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({
      bar: 1,
      startTime: 0,
      isLeadIn: false,
    })
    expect(segments[0]!.endTime).toBeCloseTo(secondsPerBar, 9)
    expect(segments[1]!.startTime).toBeCloseTo(secondsPerBar, 9)
  })

  it('returns only the neutral lead-in when Bar 1 begins after the clip ends', () => {
    expect(
      musicalBarSegmentsForRange(
        { ...grid, firstBeatTime: 3 },
        0,
        2,
      ),
    ).toEqual([
      { bar: 1, startTime: 0, endTime: 2, isLeadIn: true },
    ])
  })
})

describe('recurringBeatAtOrAfter', () => {
  it('advances an analyzed phase to the first beat after a trimmed in-point', () => {
    expect(recurringBeatAtOrAfter(0.2, 120, 1.1)).toBeCloseTo(1.2, 9)
  })

  it('keeps a detected beat that already follows the in-point', () => {
    expect(recurringBeatAtOrAfter(0.35, 120, 0.2)).toBeCloseTo(0.35, 9)
  })

  it('does not skip a beat exactly on the in-point', () => {
    expect(recurringBeatAtOrAfter(0.2, 120, 1.2)).toBeCloseTo(1.2, 9)
  })
})

describe('beatAnchorAfterTrimChange', () => {
  it('keeps a zero-length lead anchored to the audible clip start', () => {
    expect(beatAnchorAfterTrimChange(1, 1, 0.25)).toBe(0.25)
  })

  it('preserves an explicitly authored lead duration', () => {
    expect(beatAnchorAfterTrimChange(1.4, 1, 2)).toBeCloseTo(2.4, 9)
  })

  it('repairs a stale anchor that was already before the in-point', () => {
    expect(beatAnchorAfterTrimChange(0.5, 1, 1.5)).toBe(1.5)
  })
})
