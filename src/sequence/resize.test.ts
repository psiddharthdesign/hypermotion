// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  compositionSourceWindow,
  resizeSequenceOccurrenceOut,
} from './resize'
import type { CompositionScene, ResolvedSequenceItem } from './types'

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
): Pick<ResolvedSequenceItem, 'scene' | 'sourceStart'> {
  return { scene: composition, sourceStart }
}

describe('Master occurrence resize', () => {
  it('uses full composition bounds when no work area is authored', () => {
    expect(compositionSourceWindow(scene())).toEqual({ start: 0, end: 8 })
    expect(
      resizeSequenceOccurrenceOut(occurrence(scene(), 1), 6.26, 10),
    ).toEqual({
      trimStart: 1,
      duration: 5.3,
    })
  })

  it('cannot expand an occurrence beyond the composition work area', () => {
    const composition = scene({ workArea: { start: 2, end: 6 } })
    expect(
      resizeSequenceOccurrenceOut(
        occurrence(composition, 2.5),
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
      occurrence(composition, 3),
      1,
      25,
    )
    expect(resized.trimStart).toBe(3)
    expect(resized.duration).toBeCloseTo(0.04)
  })
})
