// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildSequenceTimeMap } from '@/sequence'
import type { CompositionScene } from '@/sequence'
import {
  resolveMediaTimelineSamples,
  resolveSceneExportOccurrence,
} from './audioMix'

function scene(id: string, duration: number): CompositionScene {
  return {
    id,
    name: id,
    rootNodeId: `${id}-root`,
    duration,
    cameraIds: [`${id}-camera`],
    defaultCameraId: `${id}-camera`,
    cameraCuts: {},
  }
}

describe('sequence media timeline mapping', () => {
  const map = buildSequenceTimeMap({
    scenes: [scene('opening', 4), scene('detail', 3)],
    items: [
      {
        id: 'opening-use',
        sceneId: 'opening',
        trimStart: 1,
        duration: 3,
        transitionOut: { kind: 'crossfade', duration: 1 },
      },
      {
        id: 'detail-use',
        sceneId: 'detail',
      },
    ],
    frameRate: 30,
  })

  it('keeps project-level audio on master time', () => {
    expect(resolveMediaTimelineSamples({
      masterTime: 2.5,
      ownerSceneId: null,
      sequenceTimeMap: map,
    })).toEqual([{ time: 2.5, weight: 1 }])
  })

  it('applies the transition-weighted occurrence mute envelope to Master audio', () => {
    const mutedMap = buildSequenceTimeMap({
      scenes: [scene('opening', 3), scene('detail', 3)],
      items: [
        {
          id: 'opening-use',
          sceneId: 'opening',
          transitionOut: { kind: 'crossfade', duration: 1 },
        },
        {
          id: 'detail-use',
          sceneId: 'detail',
          masterAudioMuted: true,
        },
      ],
      frameRate: 30,
    })

    expect(resolveMediaTimelineSamples({
      masterTime: 2.25,
      ownerSceneId: null,
      sequenceTimeMap: mutedMap,
    })[0]).toMatchObject({ time: 2.25, weight: 0.75 })
    expect(resolveMediaTimelineSamples({
      masterTime: 3.25,
      ownerSceneId: null,
      sequenceTimeMap: mutedMap,
    })).toEqual([{ time: 3.25, weight: 0 }])
  })

  it('omits project-level audio from a scene-only export', () => {
    expect(resolveMediaTimelineSamples({
      masterTime: 2.5,
      ownerSceneId: null,
    })).toEqual([])
  })

  it('borrows the selected occurrence Master slice for a Scene export', () => {
    const repeatedMap = buildSequenceTimeMap({
      scenes: [scene('opening', 5), scene('detail', 5)],
      items: [
        {
          id: 'opening-use',
          sceneId: 'opening',
          trimStart: 1,
          duration: 3,
        },
        {
          id: 'detail-use',
          sceneId: 'detail',
          trimStart: 2,
          duration: 2,
        },
      ],
      frameRate: 30,
    })

    expect(resolveMediaTimelineSamples({
      masterTime: 2.5,
      ownerSceneId: null,
      sequenceTimeMap: repeatedMap,
      scope: 'scene',
      sceneSequenceItemId: 'detail-use',
    })).toEqual([{ time: 3.5, weight: 1 }])
    expect(resolveMediaTimelineSamples({
      masterTime: 1.99,
      ownerSceneId: null,
      sequenceTimeMap: repeatedMap,
      scope: 'scene',
      sceneSequenceItemId: 'detail-use',
    })).toEqual([])
    expect(resolveMediaTimelineSamples({
      masterTime: 4,
      ownerSceneId: null,
      sequenceTimeMap: repeatedMap,
      scope: 'scene',
      sceneSequenceItemId: 'detail-use',
    })).toEqual([])
  })

  it('keeps scene overlays local while a Scene export borrows Master audio', () => {
    expect(resolveMediaTimelineSamples({
      masterTime: 2.5,
      ownerSceneId: 'detail',
      sequenceTimeMap: map,
      scope: 'scene',
      sceneSequenceItemId: 'detail-use',
    })).toEqual([{ time: 2.5, weight: 1 }])
  })

  it('silences borrowed Master audio for a muted occurrence', () => {
    const mutedMap = buildSequenceTimeMap({
      scenes: [scene('detail', 4)],
      items: [
        {
          id: 'muted-detail',
          sceneId: 'detail',
          masterAudioMuted: true,
        },
      ],
      frameRate: 30,
    })

    expect(resolveMediaTimelineSamples({
      masterTime: 2,
      ownerSceneId: null,
      sequenceTimeMap: mutedMap,
      scope: 'scene',
      sceneSequenceItemId: 'muted-detail',
    })).toEqual([])
  })

  it('selects an explicit occurrence then falls back deterministically', () => {
    const repeatedMap = buildSequenceTimeMap({
      scenes: [scene('opening', 3), scene('detail', 3)],
      items: [
        { id: 'opening-first', sceneId: 'opening' },
        { id: 'detail-first', sceneId: 'detail' },
        { id: 'detail-second', sceneId: 'detail' },
      ],
      frameRate: 30,
    })

    expect(
      resolveSceneExportOccurrence(
        repeatedMap,
        'detail-second',
        'detail',
      )?.item.id,
    ).toBe('detail-second')
    expect(
      resolveSceneExportOccurrence(repeatedMap, undefined, 'detail')?.item.id,
    ).toBe('detail-first')
    expect(
      resolveSceneExportOccurrence(repeatedMap, 'missing', null)?.item.id,
    ).toBe('opening-first')
    expect(
      resolveSceneExportOccurrence(repeatedMap, 'missing', 'missing-scene'),
    ).toBeNull()
  })

  it('maps scene-owned media through local trim time and crossfade weight', () => {
    expect(resolveMediaTimelineSamples({
      masterTime: 2.5,
      ownerSceneId: 'opening',
      sequenceTimeMap: map,
    })).toEqual([{ time: 3.5, weight: 0.5 }])
    expect(resolveMediaTimelineSamples({
      masterTime: 2.5,
      ownerSceneId: 'detail',
      sequenceTimeMap: map,
    })).toEqual([{ time: 0.5, weight: 0.5 }])
  })

  it('omits media owned by an inactive composition', () => {
    expect(resolveMediaTimelineSamples({
      masterTime: 0.5,
      ownerSceneId: 'detail',
      sequenceTimeMap: map,
    })).toEqual([])
  })

  it('keeps Master audio on its clock but silences scene media during a held final frame', () => {
    const heldMap = buildSequenceTimeMap({
      scenes: [scene('detail', 4)],
      items: [
        {
          id: 'held-detail',
          sceneId: 'detail',
          duration: 2,
          holdDuration: 3,
        },
      ],
      frameRate: 30,
    })

    expect(resolveMediaTimelineSamples({
      masterTime: 3,
      ownerSceneId: null,
      sequenceTimeMap: heldMap,
    })).toEqual([{ time: 3, weight: 1 }])
    expect(resolveMediaTimelineSamples({
      masterTime: 3,
      ownerSceneId: 'detail',
      sequenceTimeMap: heldMap,
    })).toEqual([])
  })
})
