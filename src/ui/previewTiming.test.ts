// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  previewDurationForScope,
  previewWorkAreaForScope,
} from './previewTiming'

describe('preview timing', () => {
  it('keeps Master on the sequence clock when its active scene is shorter', () => {
    expect(previewDurationForScope('sequence', 4, 30)).toBe(30)
    expect(previewDurationForScope('scene', 4, 30)).toBe(4)
  })

  it('does not apply a scene-local work area to Master preview', () => {
    const sceneWorkArea = { start: 1, end: 3 }

    expect(previewWorkAreaForScope('scene', sceneWorkArea, 30)).toEqual(
      sceneWorkArea,
    )
    expect(previewWorkAreaForScope('sequence', sceneWorkArea, 30)).toEqual({
      start: 0,
      end: 30,
    })
  })

  it('guards empty preview durations', () => {
    expect(previewDurationForScope('scene', 0, 0)).toBe(0.1)
    expect(previewWorkAreaForScope('scene', null, 0.1)).toEqual({
      start: 0,
      end: 0.1,
    })
  })
})
