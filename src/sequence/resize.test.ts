// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  compositionSourceWindow,
  resizeSequenceOccurrenceOut,
  resizeSequenceTailToMasterDuration,
  sequenceMasterDurationBounds,
} from './resize'
import { buildSequenceTimeMap } from './timeMap'
import type {
  CompositionScene,
  ResolvedSequenceItem,
  SequenceItem,
} from './types'

function scene(
  overrides: Partial<CompositionScene> = {},
): CompositionScene {
  return {
    id: 'scene',
    name: 'Scene',
    rootNodeId: 'root',
    duration: 8,
    cameraIds: [],
    defaultCameraId: null,
    cameraCuts: {},
    ...overrides,
  }
}

function occurrence(
  composition: CompositionScene,
  sourceStart: number,
  frameRate: number,
): ResolvedSequenceItem {
  const map = buildSequenceTimeMap({
    scenes: [composition],
    items: [
      {
        id: 'occurrence',
        sceneId: composition.id,
        trimStart: sourceStart,
      },
    ],
    frameRate,
  })
  return map.items[0]!
}

function item(
  id: string,
  sceneId: string,
  overrides: Partial<SequenceItem> = {},
): SequenceItem {
  return { id, sceneId, ...overrides }
}

describe('Master occurrence resize', () => {
  it('uses full composition bounds when no work area is authored', () => {
    expect(compositionSourceWindow(scene())).toEqual({ start: 0, end: 8 })
    expect(
      resizeSequenceOccurrenceOut(occurrence(scene(), 1, 10), 6.26, 10),
    ).toEqual({
      trimStart: 1,
      duration: 5.3,
    })
  })

  it('cannot expand an occurrence beyond the composition work area', () => {
    const composition = scene({ workArea: { start: 2, end: 6 } })
    expect(
      resizeSequenceOccurrenceOut(
        occurrence(composition, 2.5, 20),
        99,
        20,
      ),
    ).toEqual({
      trimStart: 2.5,
      duration: 3.5,
    })
  })

  it('keeps at least one frame when the trailing edge crosses the in-point', () => {
    const composition = scene({ workArea: { start: 2, end: 6 } })
    const resized = resizeSequenceOccurrenceOut(
      occurrence(composition, 3, 25),
      1,
      25,
    )
    expect(resized.trimStart).toBe(3)
    expect(resized.duration).toBeCloseTo(0.04)
  })
})

describe('Master sequence duration resize', () => {
  it('resizes a single final occurrence without changing its scene duration', () => {
    const composition = scene()
    const map = buildSequenceTimeMap({
      scenes: [composition],
      items: [item('only-use', composition.id)],
      frameRate: 10,
    })

    const edit = resizeSequenceTailToMasterDuration(map, 5.25)
    expect(edit).toEqual({
      itemId: 'only-use',
      patch: { trimStart: 0, duration: 5.3, holdDuration: 0 },
      duration: 5.3,
      bounds: { min: 0.1 },
    })
    expect(composition.duration).toBe(8)
  })

  it('changes only the final occurrence in a cut sequence', () => {
    const first = scene({ id: 'first', duration: 4 })
    const last = scene({ id: 'last', duration: 8 })
    const items = [item('first-use', first.id), item('last-use', last.id)]
    const map = buildSequenceTimeMap({
      scenes: [first, last],
      items,
      frameRate: 10,
    })

    const edit = resizeSequenceTailToMasterDuration(map, 7)
    expect(edit).toMatchObject({
      itemId: 'last-use',
      patch: { trimStart: 0, duration: 3 },
      duration: 7,
      bounds: { min: 4.1 },
    })
    expect(items[0]).toEqual({ id: 'first-use', sceneId: 'first' })
  })

  it('accounts for crossfade overlap when targeting the trailing edge', () => {
    const first = scene({ id: 'first', duration: 4 })
    const last = scene({ id: 'last', duration: 8 })
    const map = buildSequenceTimeMap({
      scenes: [first, last],
      items: [
        item('first-use', first.id, {
          transitionOut: { kind: 'crossfade', duration: 1 },
        }),
        item('last-use', last.id),
      ],
      frameRate: 10,
    })

    const edit = resizeSequenceTailToMasterDuration(map, 6)
    expect(edit).toMatchObject({
      itemId: 'last-use',
      patch: { trimStart: 0, duration: 3 },
      duration: 6,
      bounds: { min: 4 },
    })
  })

  it('preserves crossfade timing when extension becomes a hold', () => {
    const first = scene({ id: 'first', duration: 4 })
    const last = scene({ id: 'last', duration: 0.5 })
    const map = buildSequenceTimeMap({
      scenes: [first, last],
      items: [
        item('first-use', first.id, {
          transitionOut: { kind: 'crossfade', duration: 1 },
        }),
        item('last-use', last.id),
      ],
      frameRate: 10,
    })

    const edit = resizeSequenceTailToMasterDuration(map, 6)
    expect(edit).toMatchObject({
      itemId: 'last-use',
      patch: { trimStart: 0, duration: 0.5, holdDuration: 2.5 },
      duration: 6,
      bounds: { min: 4 },
    })
    const extended = buildSequenceTimeMap({
      scenes: [first, last],
      items: [map.items[0]!.item, { ...map.items[1]!.item, ...edit!.patch }],
      frameRate: 10,
    })
    expect(extended.transitions[0]).toMatchObject({
      start: 3,
      end: 4,
      duration: 1,
    })
    expect(extended.duration).toBe(6)
  })

  it('does not collapse a short tail on an unchanged crossfade plateau', () => {
    const first = scene({ id: 'first', duration: 4 })
    const last = scene({ id: 'last', duration: 0.5 })
    const map = buildSequenceTimeMap({
      scenes: [first, last],
      items: [
        item('first-use', first.id, {
          transitionOut: { kind: 'crossfade', duration: 1 },
        }),
        item('last-use', last.id, { duration: 0.5 }),
      ],
      frameRate: 10,
    })

    expect(map.duration).toBe(4)
    expect(resizeSequenceTailToMasterDuration(map, 4)).toMatchObject({
      itemId: 'last-use',
      patch: { trimStart: 0, duration: 0.5 },
      duration: 4,
      bounds: { min: 4 },
    })
  })

  it('extends past the final scene work area with a freeze-frame hold', () => {
    const composition = scene({
      duration: 10,
      workArea: { start: 2, end: 6 },
    })
    const map = buildSequenceTimeMap({
      scenes: [composition],
      items: [item('trimmed-use', composition.id, { trimStart: 3 })],
      frameRate: 20,
    })

    expect(sequenceMasterDurationBounds(map)).toEqual({ min: 0.05 })
    expect(resizeSequenceTailToMasterDuration(map, 99)).toMatchObject({
      itemId: 'trimmed-use',
      patch: { trimStart: 3, duration: 3, holdDuration: 96 },
      duration: 99,
    })
  })

  it('uses canonical fractional work-area frames without rewriting the in-point', () => {
    const composition = scene({
      duration: 10,
      workArea: { start: 2.04, end: 6.04 },
    })
    const sourceItem = item('fractional-use', composition.id, {
      trimStart: 0,
    })
    const map = buildSequenceTimeMap({
      scenes: [composition],
      items: [sourceItem],
      frameRate: 10,
    })

    expect(map.items[0]).toMatchObject({
      sourceStartFrame: 20,
      sourceEndFrame: 61,
      durationFrames: 41,
    })
    expect(sequenceMasterDurationBounds(map)).toEqual({ min: 0.1 })

    const edit = resizeSequenceTailToMasterDuration(map, 99)
    expect(edit).toMatchObject({
      itemId: 'fractional-use',
      patch: { trimStart: 0, duration: 6.1, holdDuration: 94.9 },
      duration: 99,
    })

    const withoutWorkArea = buildSequenceTimeMap({
      scenes: [{ ...composition, workArea: undefined }],
      items: [{ ...sourceItem, ...edit!.patch }],
      frameRate: 10,
    })
    expect(withoutWorkArea.items[0]).toMatchObject({
      sourceStartFrame: 0,
      sourceEndFrame: 61,
    })
  })

  it('shrinks an existing hold before trimming source frames', () => {
    const composition = scene()
    const heldMap = buildSequenceTimeMap({
      scenes: [composition],
      items: [item('held-use', composition.id, { holdDuration: 4 })],
      frameRate: 10,
    })

    const shorterHold = resizeSequenceTailToMasterDuration(heldMap, 10)
    expect(shorterHold).toMatchObject({
      itemId: 'held-use',
      patch: { trimStart: 0, duration: 8, holdDuration: 2 },
      duration: 10,
    })

    const shorterMap = buildSequenceTimeMap({
      scenes: [composition],
      items: [{ ...heldMap.items[0]!.item, ...shorterHold!.patch }],
      frameRate: 10,
    })
    expect(resizeSequenceTailToMasterDuration(shorterMap, 6)).toMatchObject({
      patch: { trimStart: 0, duration: 6, holdDuration: 0 },
      duration: 6,
    })
  })

  it('returns null for an empty sequence', () => {
    expect(
      resizeSequenceTailToMasterDuration(
        { duration: 0, frameRate: 60, items: [] },
        5,
      ),
    ).toBeNull()
    expect(
      sequenceMasterDurationBounds({ duration: 0, frameRate: 60, items: [] }),
    ).toBeNull()
  })
})
