// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  beatSyncSelectionKey,
  planKeyframeBeatSync,
  proposeKeyframeBeatRespace,
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

  it('keeps the chosen division and cascades overflow into following bars', () => {
    const result = planKeyframeBeatSync(options(
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      {
        selectedBars: { startBar: 1, endBar: 1 },
      },
    ))

    expect(result.ok).toBe(true)
    expect(result.preview).toMatchObject({
      eventCount: 7,
      barRange: { startBar: 1, endBar: 1 },
      targetBarRange: { startBar: 1, endBar: 2 },
    })
    expect(result.targetTimes).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3])
  })

  it('uses following-bar subdivision overrides while cascading', () => {
    const result = planKeyframeBeatSync(options(
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      {
        grid: {
          ...grid,
          subdivisions: [
            { id: 'bar-2-eighths', startBar: 2, endBar: 2, division: 8 },
          ],
        },
        selectedBars: { startBar: 1, endBar: 1 },
      },
    ))

    expect(result.ok).toBe(true)
    expect(result.targetTimes).toEqual([0, 0.5, 1, 1.5, 2, 2.25, 2.5])
  })

  it('keeps coincident cross-property keyframes together in the plan', () => {
    const result = planKeyframeBeatSync(options(
      [],
      {
        tracks: [
          {
            id: 'x',
            keyframes: [
              { id: 'x1', time: 2.1 },
              { id: 'x2', time: 3.8 },
            ],
          },
          {
            id: 'y',
            keyframes: [
              { id: 'y1', time: 2.105 },
              { id: 'y2', time: 3.8 },
            ],
          },
        ],
        selectedKeyframeKeys: [
          beatSyncSelectionKey('x', 'x1'),
          beatSyncSelectionKey('x', 'x2'),
          beatSyncSelectionKey('y', 'y1'),
          beatSyncSelectionKey('y', 'y2'),
        ],
        workAreaRange: { start: 2, end: 4 },
        coincidentTolerance: 0.01,
      },
    ))

    expect(result.ok).toBe(true)
    expect(result.preview.eventCount).toBe(2)
    expect(result.targetTimes).toEqual([2, 2, 4, 4])
  })

  it('reserves unselected keyframes on the same track', () => {
    const result = planKeyframeBeatSync(options(
      [],
      {
        tracks: [{
          id: 'track',
          keyframes: [
            { id: 'selected', time: 0.1 },
            { id: 'reserved', time: 0 },
          ],
        }],
        selectedKeyframeKeys: [
          beatSyncSelectionKey('track', 'selected'),
        ],
        selectedBars: { startBar: 1, endBar: 1 },
      },
    ))

    expect(result.ok).toBe(true)
    expect(result.targetTimes).toEqual([0.5])
  })

  it('fails only when no later point exists before the hard boundary', () => {
    const result = planKeyframeBeatSync(options(
      [1.9, 1.91],
      {
        audio: {
          startTime: 0,
          trimStart: 0,
          trimEnd: 2,
          duration: 2,
        },
        sceneEndTime: 2,
        selectedBars: { startBar: 1, endBar: 1 },
      },
    ))

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('insufficient-grid-slots')
    expect(result.preview.availableSlots).toBe(5)
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

  it('proposes increased spacing when aligned events gain another bar', () => {
    const proposal = proposeKeyframeBeatRespace(options(
      [0, 0.5, 1, 1.5, 2, 2.5, 3],
      { selectedBars: { startBar: 1, endBar: 2 } },
    ))

    expect(proposal).toMatchObject({
      change: 'increase',
      currentSpacing: 0.5,
      targetSpacing: 4 / 6,
    })
    expect(proposal?.plan.targetTimes).toEqual([
      0, 0.5, 1.5, 2, 2.5, 3.5, 4,
    ])
  })

  it('proposes decreased spacing and safely overflows a smaller bar range', () => {
    const proposal = proposeKeyframeBeatRespace(options(
      [0, 0.5, 1.5, 2, 2.5, 3.5, 4],
      { selectedBars: { startBar: 1, endBar: 1 } },
    ))

    expect(proposal).toMatchObject({
      change: 'decrease',
      currentSpacing: 4 / 6,
      targetSpacing: 0.5,
    })
    expect(proposal?.plan.preview.targetBarRange).toEqual({
      startBar: 1,
      endBar: 2,
    })
    expect(proposal?.plan.targetTimes).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3,
    ])
  })

  it('does not propose re-spacing when the aligned targets are unchanged', () => {
    const proposal = proposeKeyframeBeatRespace(options(
      [0, 0.5, 1, 1.5, 2],
      { selectedBars: { startBar: 1, endBar: 1 } },
    ))

    expect(proposal).toBeNull()
  })

  it('does not treat unsnapped or one-event selections as re-spacing', () => {
    expect(proposeKeyframeBeatRespace(options(
      [0.1, 0.6, 1.1],
      { selectedBars: { startBar: 1, endBar: 2 } },
    ))).toBeNull()
    expect(proposeKeyframeBeatRespace(options(
      [1],
      { selectedBars: { startBar: 1, endBar: 2 } },
    ))).toBeNull()
  })

  it('spaces by note-slot ordinal across mixed bar subdivisions', () => {
    const proposal = proposeKeyframeBeatRespace(options(
      [0, 0.5, 1, 1.5, 2],
      {
        grid: {
          ...grid,
          subdivisions: [
            { id: 'bar-2-eighths', startBar: 2, endBar: 2, division: 8 },
          ],
        },
        selectedBars: { startBar: 1, endBar: 2 },
      },
    ))

    expect(proposal?.change).toBe('increase')
    expect(proposal?.plan.targetTimes).toEqual([0, 1.5, 2.5, 3.25, 4])
  })

  it('re-spaces later bars through trim, clip start, and playback rate', () => {
    const proposal = proposeKeyframeBeatRespace(options(
      [10, 10.5, 11],
      {
        audio: {
          startTime: 10,
          trimStart: 2,
          trimEnd: 6,
          duration: 8,
          playbackRate: 2,
        },
        sceneEndTime: 12,
        selectedBars: { startBar: 2, endBar: 3 },
      },
    ))

    expect(proposal).toMatchObject({
      change: 'increase',
      plan: {
        preview: {
          barRange: { startBar: 2, endBar: 3 },
        },
        targetTimes: [10, 11, 12],
      },
    })
  })
})
