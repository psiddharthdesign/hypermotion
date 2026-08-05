// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  currentAnimationAuthorTime,
  pausedInspectorPlayhead,
} from './animationPlayhead'

describe('pausedInspectorPlayhead', () => {
  it('keeps one stable selector value across playback samples', () => {
    expect(pausedInspectorPlayhead({ playing: true, playhead: 1 })).toBeNull()
    expect(pausedInspectorPlayhead({ playing: true, playhead: 2 })).toBeNull()
  })

  it('exposes scrubbed time while playback is paused', () => {
    expect(pausedInspectorPlayhead({ playing: false, playhead: 1.25 })).toBe(
      1.25,
    )
  })
})

describe('currentAnimationAuthorTime', () => {
  it('uses paused UI time without touching the engine clock', () => {
    const readEnginePlayhead = vi.fn(() => 9)

    expect(
      currentAnimationAuthorTime(
        { playing: false, playhead: 1.25 },
        readEnginePlayhead,
      ),
    ).toBe(1.25)
    expect(readEnginePlayhead).not.toHaveBeenCalled()
  })

  it('uses exact engine time while playing', () => {
    const readEnginePlayhead = vi.fn(() => 3.75)

    expect(
      currentAnimationAuthorTime(
        { playing: true, playhead: 3.5 },
        readEnginePlayhead,
      ),
    ).toBe(3.75)
    expect(readEnginePlayhead).toHaveBeenCalledOnce()
  })

  it('uses composition-local engine time in paused sequence preview', () => {
    const readEnginePlayhead = vi.fn(() => 2.13)

    expect(
      currentAnimationAuthorTime(
        {
          playing: false,
          playhead: 4.44,
          previewScope: 'sequence',
        },
        readEnginePlayhead,
      ),
    ).toBe(2.13)
    expect(readEnginePlayhead).toHaveBeenCalledOnce()
  })

  it('keeps paused scene preview on the UI playhead', () => {
    const readEnginePlayhead = vi.fn(() => 9)

    expect(
      currentAnimationAuthorTime(
        { playing: false, playhead: 1.25, previewScope: 'scene' },
        readEnginePlayhead,
      ),
    ).toBe(1.25)
    expect(readEnginePlayhead).not.toHaveBeenCalled()
  })
})
