// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  resolveTransportFrameStepPatch,
  resolveTransportSpacePatch,
  shouldNativeControlOwnTransportSpace,
} from './transportShortcut'

describe('shouldNativeControlOwnTransportSpace', () => {
  it('reserves Space for Master playback after an ordinary button is focused', () => {
    expect(
      shouldNativeControlOwnTransportSpace({
        timelineScope: 'sequence',
        isEditableControl: false,
        isNativeButton: true,
        isTransportControl: false,
      }),
    ).toBe(false)
  })

  it('preserves native button activation in Scene scope', () => {
    expect(
      shouldNativeControlOwnTransportSpace({
        timelineScope: 'scene',
        isEditableControl: false,
        isNativeButton: true,
        isTransportControl: false,
      }),
    ).toBe(true)
  })

  it('lets editable controls own Space in Master scope', () => {
    expect(
      shouldNativeControlOwnTransportSpace({
        timelineScope: 'sequence',
        isEditableControl: true,
        isNativeButton: false,
        isTransportControl: false,
      }),
    ).toBe(true)
  })

  it('lets transport controls delegate Space to the global shortcut', () => {
    expect(
      shouldNativeControlOwnTransportSpace({
        timelineScope: 'scene',
        isEditableControl: false,
        isNativeButton: true,
        isTransportControl: true,
      }),
    ).toBe(false)
  })
})

describe('resolveTransportSpacePatch', () => {
  it('starts Master playback in sequence preview', () => {
    expect(
      resolveTransportSpacePatch(
        {
          timelineScope: 'sequence',
          previewScope: 'scene',
          playhead: 2.5,
          playing: false,
        },
        12,
      ),
    ).toEqual({
      previewScope: 'sequence',
      playhead: 2.5,
      playing: true,
    })
  })

  it('rewinds Master playback when Space is pressed at the sequence end', () => {
    expect(
      resolveTransportSpacePatch(
        {
          timelineScope: 'sequence',
          previewScope: 'sequence',
          playhead: 12,
          playing: false,
        },
        12,
      ),
    ).toEqual({
      previewScope: 'sequence',
      playhead: 0,
      playing: true,
    })
  })

  it('pauses Master playback without moving its playhead', () => {
    expect(
      resolveTransportSpacePatch(
        {
          timelineScope: 'sequence',
          previewScope: 'sequence',
          playhead: 6.25,
          playing: true,
        },
        12,
      ),
    ).toEqual({
      previewScope: 'sequence',
      playhead: 6.25,
      playing: false,
    })
  })

  it('keeps scene transport behavior local to the current preview', () => {
    expect(
      resolveTransportSpacePatch(
        {
          timelineScope: 'scene',
          previewScope: 'scene',
          playhead: 4,
          playing: false,
        },
        12,
      ),
    ).toEqual({ playing: true })
  })
})

describe('resolveTransportFrameStepPatch', () => {
  it('steps Scene time within the active scene duration', () => {
    expect(
      resolveTransportFrameStepPatch(
        {
          timelineScope: 'scene',
          previewScope: 'scene',
          playhead: 4,
          playing: true,
        },
        1,
        4,
        12,
        60,
      ),
    ).toEqual({
      playhead: 4,
      playing: false,
    })
  })

  it('steps Master time beyond the active scene and claims sequence preview', () => {
    expect(
      resolveTransportFrameStepPatch(
        {
          timelineScope: 'sequence',
          previewScope: 'scene',
          playhead: 4,
          playing: true,
        },
        1,
        4,
        12,
        60,
      ),
    ).toEqual({
      previewScope: 'sequence',
      playhead: 4 + 1 / 60,
      playing: false,
    })
  })

  it('clamps a backward Master step to zero', () => {
    expect(
      resolveTransportFrameStepPatch(
        {
          timelineScope: 'sequence',
          previewScope: 'sequence',
          playhead: 0,
          playing: false,
        },
        -1,
        4,
        12,
        60,
      ),
    ).toEqual({
      previewScope: 'sequence',
      playhead: 0,
      playing: false,
    })
  })
})
