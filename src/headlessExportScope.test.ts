// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { CompositionScene, SequenceItem } from '@/sequence'
import { shouldRenderHeadlessSequence } from './headlessExportScope'

function scene(
  overrides: Partial<CompositionScene> = {},
): CompositionScene {
  return {
    id: 'scene-1',
    name: 'Scene 1',
    rootNodeId: 'root-1',
    duration: 8,
    cameraIds: [],
    defaultCameraId: null,
    cameraCuts: {},
    ...overrides,
  }
}

function occurrence(
  overrides: Partial<SequenceItem> = {},
): SequenceItem {
  return {
    id: 'item-1',
    sceneId: 'scene-1',
    ...overrides,
  }
}

describe('headless export scope', () => {
  it('uses Master rendering for a single occurrence whose scene has a work area', () => {
    expect(
      shouldRenderHeadlessSequence(
        [occurrence()],
        [scene({ workArea: { start: 2, end: 6 } })],
      ),
    ).toBe(true)
  })

  it('uses Master rendering for a single occurrence that mutes Master audio', () => {
    expect(
      shouldRenderHeadlessSequence(
        [occurrence({ masterAudioMuted: true })],
        [scene()],
      ),
    ).toBe(true)
  })

  it('keeps an unmodified single occurrence on the Scene renderer', () => {
    expect(
      shouldRenderHeadlessSequence([occurrence()], [scene()]),
    ).toBe(false)
  })
})
