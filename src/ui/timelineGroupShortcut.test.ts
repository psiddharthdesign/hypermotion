// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { resolveTimelineGroupShortcutIntent } from './timelineGroupShortcut'

describe('resolveTimelineGroupShortcutIntent', () => {
  it('leaves Cmd+G to canvas grouping without an explicit timeline selection', () => {
    expect(resolveTimelineGroupShortcutIntent([], new Set())).toEqual({
      kind: 'none',
    })
  })

  it('routes an arbitrary selected keyframe set to keyframe grouping', () => {
    const keys = new Set(['track-a:key-a', 'track-b:key-b'])
    expect(
      resolveTimelineGroupShortcutIntent(['stale-track'], keys),
    ).toEqual({ kind: 'keyframes', keys: [...keys] })
  })

  it('routes explicit track selection only when no keyframes are selected', () => {
    expect(
      resolveTimelineGroupShortcutIntent(
        ['track-a', 'track-a', 'track-b'],
        new Set(),
      ),
    ).toEqual({ kind: 'tracks', trackIds: ['track-a', 'track-b'] })
  })
})
