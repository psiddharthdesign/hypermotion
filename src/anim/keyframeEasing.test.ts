// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { EasingKind, Track } from '@/scene/types'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { registerStaggerSetKeyframes } from './staggerSets'
import {
  applyEasingToSelection,
  inspectEasingSelection,
} from './keyframeEasing'

const natural: EasingKind = { bezier: [0.05, 0.7, 0.1, 1] }
const smooth: EasingKind = { bezier: [0.85, 0, 0.15, 1] }

function track(
  id: string,
  nodeId: string,
  values: Array<number | string> = [0, 50, 100],
): Track {
  return {
    id,
    nodeId,
    propertyId:
      typeof values[0] === 'number' ? 'transform.x' : 'layout.direction',
    defaultEasing: 'linear',
    keyframes: values.map((value, index) => ({
      id: `${id}-k${index}`,
      time: index,
      value,
      easingOut: 'ease-in' as const,
    })),
  }
}

function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { name: 'Root' })
  const a = api.createNode('frame', root, { name: 'A' })
  const b = api.createNode('frame', root, { name: 'B' })
  api.setTrack(track('track-a', a))
  api.setTrack(track('track-b', b))
  return { api, a, b }
}

describe('selected keyframe timing', () => {
  it('changes only exact outgoing segments and saves their preset state', () => {
    const { api, a } = setup()
    const before = api.getTrack('track-a')!
    const untouched = api.getTrack('track-b')!

    const result = applyEasingToSelection(
      api,
      {
        keyframeKeys: ['track-a:track-a-k1'],
        trackIds: ['track-b'],
        nodeIds: [a],
      },
      natural,
      { presetId: 'natural', strength: 100 },
    )

    const after = api.getTrack('track-a')!
    expect(result.scope).toBe('keyframes')
    expect(result.updatedSegmentCount).toBe(1)
    expect(after.defaultEasing).toBe('linear')
    expect(after.keyframes[0]).toEqual(before.keyframes[0])
    expect(after.keyframes[1]).toEqual({
      ...before.keyframes[1],
      easingOut: natural,
      easingPreset: { presetId: 'natural', strength: 100 },
    })
    expect(after.keyframes[2]).toEqual(before.keyframes[2])
    expect(api.getTrack('track-b')).toEqual(untouched)
    expect(after.keyframes.map(({ time, value, id }) => ({ time, value, id }))).toEqual(
      before.keyframes.map(({ time, value, id }) => ({ time, value, id })),
    )
  })

  it('restores the saved preset when the same segment is inspected again', () => {
    const { api } = setup()
    applyEasingToSelection(
      api,
      { keyframeKeys: ['track-a:track-a-k0', 'track-a:track-a-k1'] },
      smooth,
      { presetId: 'smooth', strength: 100 },
    )

    expect(
      inspectEasingSelection(api, {
        keyframeKeys: ['track-a:track-a-k0', 'track-a:track-a-k1'],
      }),
    ).toMatchObject({
      eligibleSegmentCount: 2,
      mixed: false,
      commonEasing: smooth,
      commonPreset: { presetId: 'smooth', strength: 100 },
    })
  })

  it('clears stale preset provenance when applying a raw curve', () => {
    const { api } = setup()
    const selection = { keyframeKeys: ['track-a:track-a-k0'] }
    applyEasingToSelection(
      api,
      selection,
      smooth,
      { presetId: 'smooth', strength: 80 },
    )

    applyEasingToSelection(api, selection, natural)

    expect(api.getTrack('track-a')?.keyframes[0]).toMatchObject({
      easingOut: natural,
    })
    expect(
      api.getTrack('track-a')?.keyframes[0]?.easingPreset,
    ).toBeUndefined()
  })

  it('persists a custom curve and picker state through a saved scene', () => {
    const { api } = setup()
    const custom: EasingKind = { bezier: [0.18, -0.35, 0.72, 1.4] }
    applyEasingToSelection(
      api,
      { keyframeKeys: ['track-a:track-a-k0'] },
      custom,
      { presetId: 'custom', strength: 100 },
    )

    const reopened = readScene(sceneToBytes(api.doc))
    expect(
      inspectEasingSelection(reopened.api, {
        keyframeKeys: ['track-a:track-a-k0'],
      }),
    ).toMatchObject({
      commonEasing: custom,
      commonPreset: { presetId: 'custom', strength: 100 },
      mixed: false,
    })
    reopened.doc.destroy()
  })

  it('reports mixed presets without modifying the selection', () => {
    const { api } = setup()
    applyEasingToSelection(
      api,
      { keyframeKeys: ['track-a:track-a-k0'] },
      smooth,
      { presetId: 'smooth', strength: 80 },
    )
    applyEasingToSelection(
      api,
      { keyframeKeys: ['track-a:track-a-k1'] },
      natural,
      { presetId: 'natural', strength: 120 },
    )

    const summary = inspectEasingSelection(api, {
      keyframeKeys: ['track-a:track-a-k0', 'track-a:track-a-k1'],
    })
    expect(summary.mixed).toBe(true)
    expect(summary.commonEasing).toBeNull()
    expect(summary.commonPreset).toBeNull()
  })

  it('skips terminal, zero-duration, discrete, stale, and malformed refs', () => {
    const { api, a } = setup()
    api.setTrack(track('discrete', a, ['row', 'column']))
    api.setTrack({
      ...track('coincident', a, [0, 1]),
      keyframes: [
        { id: 'same-a', time: 1, value: 0 },
        { id: 'same-b', time: 1, value: 1 },
      ],
    })

    const result = applyEasingToSelection(
      api,
      {
        keyframeKeys: [
          'track-a:track-a-k2',
          'discrete:discrete-k0',
          'coincident:same-a',
          'missing:key',
          'malformed',
        ],
      },
      smooth,
      { presetId: 'smooth', strength: 100 },
    )

    expect(result.updatedSegmentCount).toBe(0)
    expect(result.skippedEndpointCount).toBe(2)
    expect(result.skippedDiscreteCount).toBe(1)
    expect(result.staleReferenceCount).toBe(2)
  })

  it('updates whole-track fallback only when there is no exact selection', () => {
    const { api } = setup()
    const result = applyEasingToSelection(
      api,
      { trackIds: ['track-a'] },
      natural,
      { presetId: 'natural', strength: 70 },
    )
    const updated = api.getTrack('track-a')!

    expect(result.scope).toBe('tracks')
    expect(updated.defaultEasing).toEqual(natural)
    expect(updated.keyframes.slice(0, -1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'track-a-k0',
          easingOut: natural,
          easingPreset: { presetId: 'natural', strength: 70 },
        }),
        expect.objectContaining({
          id: 'track-a-k1',
          easingOut: natural,
          easingPreset: { presetId: 'natural', strength: 70 },
        }),
      ]),
    )
    expect(updated.keyframes[2]?.easingOut).toBe('ease-in')
  })

  it('propagates only the corresponding selected stagger ordinal', () => {
    const { api, a, b } = setup()
    registerStaggerSetKeyframes(
      api,
      {
        setId: 'stagger',
        layerIds: [a, b],
        delay: 0.1,
        order: 'forward',
      },
      [
        {
          nodeId: a,
          propertyId: 'transform.x',
          keyframeIds: ['track-a-k0', 'track-a-k1', 'track-a-k2'],
        },
        {
          nodeId: b,
          propertyId: 'transform.x',
          keyframeIds: ['track-b-k0', 'track-b-k1', 'track-b-k2'],
        },
      ],
    )

    const result = applyEasingToSelection(
      api,
      { keyframeKeys: ['track-a:track-a-k0'] },
      natural,
      { presetId: 'natural', strength: 100 },
    )

    expect(result.eligibleSegmentCount).toBe(1)
    expect(result.affectedSegmentCount).toBe(2)
    for (const trackId of ['track-a', 'track-b']) {
      const updated = api.getTrack(trackId)!
      expect(updated.keyframes[0]?.easingOut).toEqual(natural)
      expect(updated.keyframes[1]?.easingOut).toBe('ease-in')
    }
  })

  it('applies a multi-track selection as one undoable document gesture', () => {
    const { api } = setup()
    const scene = api.doc.getMap('scene')
    const tracks = scene.get('tracks') as Y.Map<unknown>
    const undo = new Y.UndoManager([scene, tracks], {
      trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]),
    })

    applyEasingToSelection(
      api,
      {
        keyframeKeys: ['track-a:track-a-k0', 'track-b:track-b-k1'],
      },
      smooth,
      { presetId: 'smooth', strength: 90 },
    )
    expect(api.getTrack('track-a')?.keyframes[0]?.easingOut).toEqual(smooth)
    expect(api.getTrack('track-b')?.keyframes[1]?.easingOut).toEqual(smooth)

    undo.undo()
    expect(api.getTrack('track-a')?.keyframes[0]?.easingOut).toBe('ease-in')
    expect(api.getTrack('track-b')?.keyframes[1]?.easingOut).toBe('ease-in')
  })

})
