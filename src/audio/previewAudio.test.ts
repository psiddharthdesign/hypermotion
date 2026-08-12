// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildSequenceTimeMap, type CompositionScene } from '@/sequence'
import {
  resolvePreviewAudioContributions,
  type ResolvePreviewAudioContributionsInput,
} from './previewAudio'

const scenes: CompositionScene[] = [
  {
    id: 'scene-a',
    name: 'A',
    rootNodeId: 'root-a',
    duration: 6,
    cameraIds: [],
    defaultCameraId: null,
    cameraCuts: {},
  },
  {
    id: 'scene-b',
    name: 'B',
    rootNodeId: 'root-b',
    duration: 6,
    cameraIds: [],
    defaultCameraId: null,
    cameraCuts: {},
  },
]

function input(
  patch: Partial<ResolvePreviewAudioContributionsInput> = {},
): ResolvePreviewAudioContributionsInput {
  return {
    previewScope: 'sequence',
    playhead: 0,
    selectedSequenceItemId: null,
    activeCompositionId: 'scene-a',
    masterAudioNodeIds: ['soundtrack'],
    sceneAudio: [
      { audioNodeId: 'overlay-a', sceneId: 'scene-a' },
      { audioNodeId: 'overlay-b', sceneId: 'scene-b' },
    ],
    timeMap: buildSequenceTimeMap({
      scenes,
      items: [
        {
          id: 'item-a',
          sceneId: 'scene-a',
          duration: 4,
          transitionOut: { kind: 'crossfade', duration: 1 },
        },
        { id: 'item-b', sceneId: 'scene-b', duration: 4 },
      ],
      frameRate: 60,
    }),
    ...patch,
  }
}

describe('preview audio mapping', () => {
  it('plays Master audio once and crossfades scene overlays by occurrence', () => {
    const result = resolvePreviewAudioContributions(
      input({ playhead: 3.25 }),
    )

    expect(result).toEqual([
      {
        key: 'master:soundtrack:sequence',
        audioNodeId: 'soundtrack',
        timelineTime: 3.25,
        gain: 1,
        source: 'master',
        sequenceItemId: null,
      },
      {
        key: 'scene:overlay-a:item-a',
        audioNodeId: 'overlay-a',
        timelineTime: 3.25,
        gain: 0.75,
        source: 'scene-overlay',
        sequenceItemId: 'item-a',
      },
      {
        key: 'scene:overlay-b:item-b',
        audioNodeId: 'overlay-b',
        timelineTime: 0.25,
        gain: 0.25,
        source: 'scene-overlay',
        sequenceItemId: 'item-b',
      },
    ])
  })

  it('ramps the Master bed across a muted occurrence boundary', () => {
    const timeMap = buildSequenceTimeMap({
      scenes,
      items: [
        {
          id: 'item-a',
          sceneId: 'scene-a',
          duration: 4,
          transitionOut: { kind: 'crossfade', duration: 1 },
        },
        {
          id: 'item-b',
          sceneId: 'scene-b',
          duration: 4,
          masterAudioMuted: true,
        },
      ],
      frameRate: 60,
    })

    const result = resolvePreviewAudioContributions(
      input({ playhead: 3.25, timeMap }),
    )

    expect(result[0]).toMatchObject({
      source: 'master',
      timelineTime: 3.25,
      gain: 0.75,
    })
    expect(result.filter((entry) => entry.source === 'scene-overlay')).toHaveLength(2)
  })

  it('maps a Scene playhead into the selected occurrence Master window', () => {
    const result = resolvePreviewAudioContributions(
      input({
        previewScope: 'scene',
        selectedSequenceItemId: 'item-b',
        activeCompositionId: 'scene-b',
        playhead: 1.5,
      }),
    )

    expect(result).toEqual([
      {
        key: 'scene:overlay-b:editor',
        audioNodeId: 'overlay-b',
        timelineTime: 1.5,
        gain: 1,
        source: 'scene-overlay',
        sequenceItemId: 'item-b',
      },
      {
        key: 'master:soundtrack:scene:item-b',
        audioNodeId: 'soundtrack',
        timelineTime: 4.5,
        gain: 1,
        source: 'master',
        sequenceItemId: 'item-b',
      },
    ])
  })

  it('silences borrowed Master audio outside the occurrence source window', () => {
    const before = resolvePreviewAudioContributions(
      input({
        previewScope: 'scene',
        selectedSequenceItemId: 'item-b',
        activeCompositionId: 'scene-b',
        playhead: -0.01,
      }),
    )
    const atEnd = resolvePreviewAudioContributions(
      input({
        previewScope: 'scene',
        selectedSequenceItemId: 'item-b',
        activeCompositionId: 'scene-b',
        playhead: 4,
      }),
    )

    expect(before.map((entry) => entry.source)).toEqual(['scene-overlay'])
    expect(atEnd.map((entry) => entry.source)).toEqual(['scene-overlay'])
  })

  it('mutes the occurrence Master bed without muting its scene overlay', () => {
    const timeMap = buildSequenceTimeMap({
      scenes,
      items: [
        {
          id: 'muted-item',
          sceneId: 'scene-a',
          duration: 4,
          masterAudioMuted: true,
        },
      ],
      frameRate: 60,
    })
    const result = resolvePreviewAudioContributions(
      input({
        previewScope: 'scene',
        selectedSequenceItemId: 'muted-item',
        activeCompositionId: 'scene-a',
        playhead: 2,
        timeMap,
      }),
    )

    expect(result).toEqual([
      {
        key: 'scene:overlay-a:editor',
        audioNodeId: 'overlay-a',
        timelineTime: 2,
        gain: 1,
        source: 'scene-overlay',
        sequenceItemId: 'muted-item',
      },
    ])
  })

  it('keeps repeated uses of one composition on independent source clocks', () => {
    const timeMap = buildSequenceTimeMap({
      scenes: [scenes[0]!],
      items: [
        { id: 'first-a', sceneId: 'scene-a', trimStart: 0, duration: 2 },
        { id: 'second-a', sceneId: 'scene-a', trimStart: 2, duration: 2 },
      ],
      frameRate: 60,
    })

    const result = resolvePreviewAudioContributions(
      input({
        timeMap,
        playhead: 2.5,
        sceneAudio: [{ audioNodeId: 'overlay-a', sceneId: 'scene-a' }],
      }),
    )

    expect(result.at(-1)).toMatchObject({
      key: 'scene:overlay-a:second-a',
      timelineTime: 2.5,
      gain: 1,
      sequenceItemId: 'second-a',
    })
  })

  it('keeps Master audio running while a held final frame silences its scene overlay', () => {
    const timeMap = buildSequenceTimeMap({
      scenes: [scenes[0]!],
      items: [
        {
          id: 'held-a',
          sceneId: 'scene-a',
          duration: 2,
          holdDuration: 3,
        },
      ],
      frameRate: 60,
    })

    expect(
      resolvePreviewAudioContributions(
        input({
          timeMap,
          playhead: 3,
          sceneAudio: [{ audioNodeId: 'overlay-a', sceneId: 'scene-a' }],
        }),
      ),
    ).toEqual([
      {
        key: 'master:soundtrack:sequence',
        audioNodeId: 'soundtrack',
        timelineTime: 3,
        gain: 1,
        source: 'master',
        sequenceItemId: null,
      },
    ])
  })
})
