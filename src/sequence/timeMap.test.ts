// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  buildSequenceTimeMap,
  clampSceneLocalTime,
  framesToSeconds,
  localTimeForMasterTime,
  masterTimeForLocalTime,
  normalizeFrameRate,
  quantizeTimeToFrame,
  resolveMasterTime,
  secondsToFrames,
} from './timeMap'
import type {
  CompositionScene,
  SequenceItem,
} from './types'

function scene(
  id: string,
  duration: number,
  overrides: Partial<CompositionScene> = {},
): CompositionScene {
  const cameraId = `${id}-camera`
  return {
    id,
    name: id,
    rootNodeId: `${id}-root`,
    duration,
    cameraIds: [cameraId],
    defaultCameraId: cameraId,
    cameraCuts: {},
    ...overrides,
  }
}

function item(
  id: string,
  sceneId: string,
  overrides: Partial<SequenceItem> = {},
): SequenceItem {
  return { id, sceneId, ...overrides }
}

describe('sequence frame helpers', () => {
  it('uses explicit rounding and a safe fallback timebase', () => {
    expect(normalizeFrameRate(Number.NaN)).toBe(60)
    expect(normalizeFrameRate(23.976)).toBe(23.976)
    expect(secondsToFrames(1.51, 10, 'nearest')).toBe(15)
    expect(secondsToFrames(1.51, 10, 'floor')).toBe(15)
    expect(secondsToFrames(1.51, 10, 'ceil')).toBe(16)
    expect(framesToSeconds(15, 10)).toBe(1.5)
    expect(quantizeTimeToFrame(1.51, 10)).toBe(1.5)
  })

  it('clamps local time and optionally snaps it to the composition timebase', () => {
    const composition = scene('intro', 2)
    expect(clampSceneLocalTime(composition, -1)).toBe(0)
    expect(clampSceneLocalTime(composition, 9)).toBe(2)
    expect(clampSceneLocalTime(composition, 0.16, 10)).toBe(0.2)
  })
})

describe('buildSequenceTimeMap', () => {
  it('maps a complete composition as one frame-aligned sequence item', () => {
    const intro = scene('intro', 2.01)
    const map = buildSequenceTimeMap({
      scenes: [intro],
      items: [item('intro-use', intro.id)],
      frameRate: 30,
    })

    expect(map.durationFrames).toBe(60)
    expect(map.duration).toBe(2)
    expect(map.items).toHaveLength(1)
    expect(map.items[0]).toMatchObject({
      sourceStartFrame: 0,
      sourceEndFrame: 60,
      durationFrames: 60,
      masterStartFrame: 0,
      masterEndFrame: 60,
      transitionInFrames: 0,
      transitionOutFrames: 0,
    })
    expect(map.issues).toEqual([])
  })

  it('quantizes trim and clamps item duration to the available source', () => {
    const intro = scene('intro', 2)
    const map = buildSequenceTimeMap({
      scenes: [intro],
      items: [
        item('trimmed', intro.id, {
          trimStart: 0.04,
          duration: 99,
        }),
      ],
      frameRate: 30,
    })

    expect(map.items[0]).toMatchObject({
      sourceStartFrame: 1,
      sourceEndFrame: 60,
      durationFrames: 59,
      sourceStart: 1 / 30,
      sourceEnd: 2,
    })
    expect(map.issues.map((issue) => issue.code)).toEqual([
      'duration-clamped',
    ])
  })

  it('uses a composition work area as the default Master source window', () => {
    const intro = scene('intro', 6, {
      workArea: { start: 1.25, end: 4.75 },
    })
    const map = buildSequenceTimeMap({
      scenes: [intro],
      items: [
        item('implicit', intro.id),
        item('legacy-full', intro.id, { trimStart: 0, duration: 6 }),
      ],
      frameRate: 20,
    })

    expect(map.items.map((entry) => ({
      sourceStart: entry.sourceStart,
      sourceEnd: entry.sourceEnd,
      duration: entry.duration,
      masterStart: entry.masterStart,
    }))).toEqual([
      { sourceStart: 1.25, sourceEnd: 4.75, duration: 3.5, masterStart: 0 },
      { sourceStart: 1.25, sourceEnd: 4.75, duration: 3.5, masterStart: 3.5 },
    ])
    expect(map.duration).toBe(7)
    expect(map.issues).toEqual([])
  })

  it('intersects occurrence trims with the owning composition work area', () => {
    const intro = scene('intro', 8, {
      workArea: { start: 2, end: 6 },
    })
    const map = buildSequenceTimeMap({
      scenes: [intro],
      items: [
        item('narrow-start', intro.id, { trimStart: 3 }),
        item('narrow-end', intro.id, { trimStart: 0, duration: 4 }),
        item('inside', intro.id, { trimStart: 3, duration: 2 }),
        item('outside', intro.id, { trimStart: 6.5, duration: 1 }),
      ],
      frameRate: 10,
    })

    expect(map.items.map((entry) => ({
      id: entry.item.id,
      sourceStart: entry.sourceStart,
      sourceEnd: entry.sourceEnd,
      duration: entry.duration,
    }))).toEqual([
      { id: 'narrow-start', sourceStart: 3, sourceEnd: 6, duration: 3 },
      { id: 'narrow-end', sourceStart: 2, sourceEnd: 4, duration: 2 },
      { id: 'inside', sourceStart: 3, sourceEnd: 5, duration: 2 },
    ])
    expect(map.issues).toContainEqual(
      expect.objectContaining({
        code: 'empty-item',
        itemId: 'outside',
      }),
    )
  })

  it('falls back to the full composition for malformed collaborative work areas', () => {
    const intro = scene('intro', 3, {
      workArea: { start: 2.5, end: 1 },
    })
    const map = buildSequenceTimeMap({
      scenes: [intro],
      items: [item('intro-use', intro.id)],
      frameRate: 10,
    })

    expect(map.items[0]).toMatchObject({
      sourceStart: 0,
      sourceEnd: 3,
      duration: 3,
    })
    expect(map.issues).toContainEqual(
      expect.objectContaining({ code: 'work-area-clamped' }),
    )
  })

  it('keeps a requested non-positive item visible for one source frame', () => {
    const intro = scene('intro', 2)
    const map = buildSequenceTimeMap({
      scenes: [intro],
      items: [item('still', intro.id, { duration: 0 })],
      frameRate: 24,
    })

    expect(map.items[0]?.durationFrames).toBe(1)
    expect(map.duration).toBeCloseTo(1 / 24)
    expect(map.issues.map((issue) => issue.code)).toContain(
      'duration-clamped',
    )
  })

  it('builds adjacent crossfades with frame-exact master and local ranges', () => {
    const scenes = [
      scene('a', 4),
      scene('b', 3),
      scene('c', 2),
    ]
    const map = buildSequenceTimeMap({
      scenes,
      items: [
        item('a-use', 'a', {
          transitionOut: { kind: 'crossfade', duration: 1 },
        }),
        item('b-use', 'b', {
          transitionOut: { kind: 'crossfade', duration: 1.5 },
        }),
        item('c-use', 'c'),
      ],
      frameRate: 10,
    })

    expect(map.duration).toBe(6.5)
    expect(map.items.map((entry) => ({
      id: entry.item.id,
      start: entry.masterStart,
      end: entry.masterEnd,
      transitionIn: entry.transitionIn,
      transitionOut: entry.transitionOut,
    }))).toEqual([
      {
        id: 'a-use',
        start: 0,
        end: 4,
        transitionIn: 0,
        transitionOut: 1,
      },
      {
        id: 'b-use',
        start: 3,
        end: 6,
        transitionIn: 1,
        transitionOut: 1.5,
      },
      {
        id: 'c-use',
        start: 4.5,
        end: 6.5,
        transitionIn: 1.5,
        transitionOut: 0,
      },
    ])
    expect(map.transitions).toEqual([
      {
        kind: 'crossfade',
        fromItemId: 'a-use',
        toItemId: 'b-use',
        durationFrames: 10,
        startFrame: 30,
        endFrame: 40,
        duration: 1,
        start: 3,
        end: 4,
      },
      {
        kind: 'crossfade',
        fromItemId: 'b-use',
        toItemId: 'c-use',
        durationFrames: 15,
        startFrame: 45,
        endFrame: 60,
        duration: 1.5,
        start: 4.5,
        end: 6,
      },
    ])
  })

  it('clamps adjacent overlaps so three scenes are never active together', () => {
    const map = buildSequenceTimeMap({
      scenes: [
        scene('a', 2),
        scene('b', 1),
        scene('c', 2),
      ],
      items: [
        item('a-use', 'a', {
          transitionOut: { kind: 'crossfade', duration: 1 },
        }),
        item('b-use', 'b', {
          transitionOut: { kind: 'crossfade', duration: 1 },
        }),
        item('c-use', 'c'),
      ],
      frameRate: 10,
    })

    expect(map.items.map((entry) => entry.transitionOutFrames)).toEqual([
      10,
      0,
      0,
    ])
    expect(map.duration).toBe(4)
    expect(map.issues.map((issue) => issue.code)).toContain(
      'transition-clamped',
    )
    expect(resolveMasterTime(map, 1.5).layers.map(
      (layer) => layer.item.item.id,
    )).toEqual(['a-use', 'b-use'])
    expect(resolveMasterTime(map, 2).layers.map(
      (layer) => layer.item.item.id,
    )).toEqual(['c-use'])
  })

  it('omits invalid items deterministically and reports structural issues', () => {
    const first = scene('same', 1, {
      rootNodeId: 'shared-root',
      cameraIds: ['shared-camera', 'shared-camera'],
      defaultCameraId: 'not-owned',
      cameraCuts: {
        stale: { id: 'stale', time: 0, cameraId: 'also-not-owned' },
      },
    })
    const duplicate = scene('same', 1, {
      rootNodeId: 'other-root',
      cameraIds: ['other-camera'],
      defaultCameraId: 'other-camera',
    })
    const crossSceneDuplicate = scene('other', 1, {
      rootNodeId: 'shared-root',
      cameraIds: ['shared-camera'],
      defaultCameraId: 'shared-camera',
    })
    const map = buildSequenceTimeMap({
      scenes: [first, duplicate, crossSceneDuplicate],
      items: [
        item('valid', 'same'),
        item('valid', 'other'),
        item('missing', 'absent'),
      ],
      frameRate: 30,
    })

    expect(map.items.map((entry) => entry.item.id)).toEqual(['valid'])
    expect(new Set(map.issues.map((issue) => issue.code))).toEqual(new Set([
      'duplicate-scene-id',
      'duplicate-camera-id',
      'default-camera-not-owned',
      'camera-cut-target-not-owned',
      'duplicate-global-node-id',
      'duplicate-sequence-item-id',
      'missing-scene',
    ]))
  })

  it('reports an invalid timebase and non-renderable scenes without throwing', () => {
    const map = buildSequenceTimeMap({
      scenes: [scene('empty', Number.NaN)],
      items: [item('empty-use', 'empty')],
      frameRate: 0,
    })

    expect(map.frameRate).toBe(60)
    expect(map.items).toEqual([])
    expect(map.duration).toBe(0)
    expect(map.issues.map((issue) => issue.code)).toEqual([
      'invalid-frame-rate',
      'invalid-scene-duration',
      'empty-item',
    ])
  })
})

describe('resolveMasterTime', () => {
  const map = buildSequenceTimeMap({
    scenes: [scene('a', 4), scene('b', 3)],
    items: [
      item('a-use', 'a', {
        trimStart: 1,
        duration: 3,
        transitionOut: { kind: 'crossfade', duration: 1 },
      }),
      item('b-use', 'b'),
    ],
    frameRate: 10,
  })

  it('returns weighted outgoing and incoming layers during overlap', () => {
    const resolution = resolveMasterTime(map, 2.5)

    expect(resolution.transition).toMatchObject({
      fromItemId: 'a-use',
      toItemId: 'b-use',
    })
    expect(resolution.layers.map((layer) => ({
      id: layer.item.item.id,
      role: layer.role,
      localTime: layer.localTime,
      weight: layer.weight,
      progress: layer.transitionProgress,
    }))).toEqual([
      {
        id: 'a-use',
        role: 'outgoing',
        localTime: 3.5,
        weight: 0.5,
        progress: 0.5,
      },
      {
        id: 'b-use',
        role: 'incoming',
        localTime: 0.5,
        weight: 0.5,
        progress: 0.5,
      },
    ])
  })

  it('uses half-open transition bounds and a stable final endpoint', () => {
    const atTransitionStart = resolveMasterTime(map, 2)
    expect(atTransitionStart.layers.map((layer) => layer.weight)).toEqual([
      1,
      0,
    ])

    const afterTransition = resolveMasterTime(map, 3)
    expect(afterTransition.transition).toBeNull()
    expect(afterTransition.layers[0]).toMatchObject({
      role: 'single',
      localTime: 1,
    })

    const atEnd = resolveMasterTime(map, map.duration)
    expect(atEnd.layers).toHaveLength(1)
    expect(atEnd.layers[0]).toMatchObject({
      role: 'single',
      localTime: 3,
    })
  })

  it('can clamp and quantize or deliberately resolve outside the sequence', () => {
    expect(resolveMasterTime(map, -2).masterTime).toBe(0)
    expect(resolveMasterTime(map, 0.16, {
      quantize: 'nearest',
    }).masterTime).toBe(0.2)

    const outside = resolveMasterTime(map, -2, { clamp: false })
    expect(outside.masterTime).toBe(-2)
    expect(outside.layers).toEqual([])
  })

  it('maps between repeated-item local and master time without ambiguity', () => {
    expect(masterTimeForLocalTime(map, 'a-use', 2.5)).toBe(1.5)
    expect(masterTimeForLocalTime(map, 'a-use', 99)).toBe(3)
    expect(localTimeForMasterTime(map, 'b-use', 2.5)).toBe(0.5)
    expect(localTimeForMasterTime(map, 'b-use', 0)).toBeNull()
    expect(localTimeForMasterTime(map, 'b-use', 0, true)).toBe(0)
    expect(masterTimeForLocalTime(map, 'absent', 1)).toBeNull()
  })
})
