// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildSequenceTimeMap, type CompositionScene } from '@/sequence'
import { resolveSceneExportTarget } from './sceneTarget'

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

describe('scene export target', () => {
  const scenes = [scene('intro', 3), scene('detail', 5)]
  const sequenceTimeMap = buildSequenceTimeMap({
    scenes,
    items: [
      { id: 'intro-use', sceneId: 'intro' },
      { id: 'detail-first', sceneId: 'detail' },
      { id: 'detail-second', sceneId: 'detail', trimStart: 1, duration: 2 },
    ],
    frameRate: 30,
  })

  it('targets a requested non-active composition and matching occurrence', () => {
    expect(
      resolveSceneExportTarget({
        scenes,
        sequenceTimeMap,
        requestedCompositionSceneId: 'detail',
        activeCompositionSceneId: 'intro',
        selectedSequenceItemId: 'detail-second',
      }),
    ).toMatchObject({
      composition: { id: 'detail', duration: 5 },
      selectedSequenceItemId: 'detail-second',
    })
  })

  it('falls back to the first occurrence of the requested composition', () => {
    expect(
      resolveSceneExportTarget({
        scenes,
        sequenceTimeMap,
        requestedCompositionSceneId: 'detail',
        activeCompositionSceneId: 'intro',
        selectedSequenceItemId: 'intro-use',
      })?.selectedSequenceItemId,
    ).toBe('detail-first')
  })

  it('supports a composition that has no Master occurrence', () => {
    const unused = scene('unused', 2)
    expect(
      resolveSceneExportTarget({
        scenes: [...scenes, unused],
        sequenceTimeMap,
        requestedCompositionSceneId: 'unused',
        activeCompositionSceneId: 'intro',
      }),
    ).toEqual({ composition: unused })
  })

  it('rejects a missing requested composition', () => {
    expect(
      resolveSceneExportTarget({
        scenes,
        sequenceTimeMap,
        requestedCompositionSceneId: 'missing',
        activeCompositionSceneId: 'intro',
      }),
    ).toBeNull()
  })
})
