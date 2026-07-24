// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  beatSyncSelectionKey,
  planKeyframeBeatSync,
  type BeatSyncPlanOptions,
} from './beatSyncPlan'

const grid = {
  version: 1 as const,
  bpm: 120,
  firstBeatTime: 0,
  beatsPerBar: 4,
  beatUnit: 4 as const,
  subdivisions: [],
}

function options(
  times: readonly number[],
  overrides: Partial<BeatSyncPlanOptions> = {},
): BeatSyncPlanOptions {
  return {
    grid,
    audio: {
      startTime: 0,
      trimStart: 0,
      trimEnd: 12,
      duration: 12,
      playbackRate: 1,
    },
    tracks: [{
      id: 'track',
      keyframes: times.map((time, index) => ({
        id: `kf${index + 1}`,
        time,
      })),
    }],
    selectedKeyframeKeys: times.map((_, index) =>
      beatSyncSelectionKey('track', `kf${index + 1}`),
    ),
    ...overrides,
  }
}

describe('planKeyframeBeatSync', () => {
  it('maps an explicit bar range through trim, clip start, and playback rate', () => {
    const result = planKeyframeBeatSync(options(
      [9.9, 10.4, 10.9],
      {
        audio: {
          startTime: 10,
          trimStart: 2,
          trimEnd: 6,
          duration: 8,
          playbackRate: 2,
        },
        selectedBars: { startBar: 2, endBar: 2 },
      },
    ))

    expect(result.ok).toBe(true)
    expect(result.preview).toMatchObject({
      rangeSource: 'bars',
      requestedSceneRange: { start: 10, end: 11 },
      effectiveSceneRange: { start: 10, end: 11 },
      clipSceneRange: { start: 10, end: 12 },
      barRange: { startBar: 2, endBar: 2 },
    })
    expect(result.markers.map((marker) => marker.time)).toEqual([
      10, 10.25, 10.5, 10.75, 11,
    ])
    expect(result.targetTimes).toEqual([10, 10.5, 11])
  })

  it('uses an isolated range ahead of a work area and clips markers to it', () => {
    const result = planKeyframeBeatSync(options(
      [5.27, 5.71],
      {
        audio: {
          startTime: 5,
          trimStart: 1,
          trimEnd: 7,
          duration: 7,
          playbackRate: 2,
        },
        isolatedRange: { start: 5.25, end: 5.75 },
        workAreaRange: { start: 6, end: 7 },
      },
    ))

    expect(result.ok).toBe(true)
    expect(result.preview.rangeSource).toBe('isolated')
    expect(result.markers.map((marker) => marker.time)).toEqual([
      5.25, 5.5, 5.75,
    ])
    expect(result.targetTimes).toEqual([5.25, 5.75])
  })

  it('uses the work area when no bar or isolated range is active', () => {
    const result = planKeyframeBeatSync(options(
      [2.1, 3.8],
      { workAreaRange: { start: 2, end: 4 } },
    ))

    expect(result.ok).toBe(true)
    expect(result.preview.rangeSource).toBe('work-area')
    expect(result.preview.barRange).toEqual({ startBar: 2, endBar: 2 })
    expect(result.targetTimes).toEqual([2, 4])
  })

  it('falls back to the selected-keyframe span, never silently to bar 1', () => {
    const result = planKeyframeBeatSync(options([4.1, 5.9]))

    expect(result.ok).toBe(true)
    expect(result.preview).toMatchObject({
      rangeSource: 'selection-span',
      requestedSceneRange: { start: 4.1, end: 5.9 },
      barRange: { startBar: 3, endBar: 3 },
    })
    expect(result.markers.map((marker) => marker.time)).toEqual([4.5, 5, 5.5])
    expect(result.targetTimes).toEqual([4.5, 5.5])
  })

  it('uses the visible clip to find the nearest note for one keyframe', () => {
    const result = planKeyframeBeatSync(options(
      [5.13],
      {
        audio: {
          startTime: 4,
          trimStart: 2,
          trimEnd: 4,
          duration: 8,
        },
      },
    ))

    expect(result.ok).toBe(true)
    expect(result.preview.rangeSource).toBe('selection-span')
    expect(result.targetTimes).toEqual([5])
    expect(result.markers.every(
      (marker) => marker.time >= 4 && marker.time <= 6,
    )).toBe(true)
  })

  it('rejects an explicit bar range that falls outside the trimmed clip', () => {
    const result = planKeyframeBeatSync(options(
      [0.2, 0.8],
      {
        audio: {
          startTime: 0,
          trimStart: 4,
          trimEnd: 8,
          duration: 8,
        },
        selectedBars: { startBar: 1, endBar: 1 },
      },
    ))

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('range-outside-clip')
    expect(result.targetTimes).toEqual([])
  })

  it('reports stale selections rather than enabling a no-op', () => {
    const result = planKeyframeBeatSync(options(
      [1],
      { selectedKeyframeKeys: ['missing:kf'] },
    ))

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-valid-keyframes')
    expect(result.preview).toMatchObject({
      selectedKeyframeCount: 1,
      validKeyframeCount: 0,
    })
  })

  it('reports no selection separately from stale selection', () => {
    const result = planKeyframeBeatSync(options(
      [1],
      { selectedKeyframeKeys: [] },
    ))

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-keyframes')
  })

  it('reports when the active note range has too few unique slots', () => {
    const result = planKeyframeBeatSync(options(
      [0, 0.1, 0.2, 0.3],
      {
        isolatedRange: { start: 0, end: 0.5 },
      },
    ))

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('insufficient-grid-slots')
    expect(result.preview.availableSlots).toBe(2)
  })

  it('keeps coincident property keyframes together in the plan', () => {
    const result = planKeyframeBeatSync(options(
      [2.1, 2.105, 3.8, 3.8],
      {
        workAreaRange: { start: 2, end: 4 },
        coincidentTolerance: 0.01,
      },
    ))

    expect(result.ok).toBe(true)
    expect(result.preview.eventCount).toBe(2)
    expect(result.targetTimes).toEqual([2, 2, 4, 4])
  })

  it('fails invalid active ranges instead of falling through precedence', () => {
    const result = planKeyframeBeatSync(options(
      [2, 3],
      {
        selectedBars: { startBar: 0, endBar: 1 },
        isolatedRange: { start: 2, end: 4 },
      },
    ))

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid-bar-range')
    expect(result.preview.rangeSource).toBe('bars')
  })
})
