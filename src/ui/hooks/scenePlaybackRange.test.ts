// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildSequenceTimeMap, type CompositionScene } from '@/sequence'
import { selectedOccurrencePlaybackRange } from './scenePlaybackRange'

const scene: CompositionScene = {
  id: 'scene',
  name: 'Scene',
  rootNodeId: 'root',
  duration: 10,
  workArea: { start: 1, end: 9 },
  cameraIds: [],
  defaultCameraId: null,
  cameraCuts: {},
}

const timeMap = buildSequenceTimeMap({
  scenes: [scene],
  items: [
    { id: 'wide', sceneId: scene.id },
    { id: 'trimmed', sceneId: scene.id, trimStart: 3, duration: 2 },
  ],
  frameRate: 60,
})

describe('selectedOccurrencePlaybackRange', () => {
  it('uses the resolved intersection of work area and occurrence trim', () => {
    expect(
      selectedOccurrencePlaybackRange(timeMap, 'wide', scene.id),
    ).toEqual({ start: 1, end: 9 })
    expect(
      selectedOccurrencePlaybackRange(timeMap, 'trimmed', scene.id),
    ).toEqual({ start: 3, end: 5 })
  })

  it('rejects a stale item/composition pairing', () => {
    expect(
      selectedOccurrencePlaybackRange(timeMap, 'trimmed', 'other-scene'),
    ).toBeNull()
    expect(
      selectedOccurrencePlaybackRange(timeMap, null, scene.id),
    ).toBeNull()
  })
})
