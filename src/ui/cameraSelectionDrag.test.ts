// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  canMoveProjectedSelection,
  passedProjectedMoveThreshold,
} from '@/ui/cameraSelectionDrag'

describe('canMoveProjectedSelection', () => {
  it('allows absolute children even when their parent uses auto layout', () => {
    expect(
      canMoveProjectedSelection({
        isRoot: false,
        locked: false,
        position: 'absolute',
        parentLayoutMode: 'flex',
      }),
    ).toBe(true)
  })

  it('allows free-position flow children under a layout-none parent', () => {
    expect(
      canMoveProjectedSelection({
        isRoot: false,
        locked: false,
        position: 'flow',
        parentLayoutMode: 'none',
      }),
    ).toBe(true)
  })

  it('keeps flow children owned by flex and grid layouts non-draggable', () => {
    for (const parentLayoutMode of ['flex', 'grid'] as const) {
      expect(
        canMoveProjectedSelection({
          isRoot: false,
          locked: false,
          position: 'flow',
          parentLayoutMode,
        }),
      ).toBe(false)
    }
  })

  it('never moves the scene root or a locked node', () => {
    expect(
      canMoveProjectedSelection({
        isRoot: true,
        locked: false,
        position: 'absolute',
        parentLayoutMode: 'none',
      }),
    ).toBe(false)
    expect(
      canMoveProjectedSelection({
        isRoot: false,
        locked: true,
        position: 'absolute',
        parentLayoutMode: 'none',
      }),
    ).toBe(false)
  })
})

describe('passedProjectedMoveThreshold', () => {
  it('uses screen-space distance and begins at two pixels', () => {
    expect(passedProjectedMoveThreshold(100, 100, 101, 100)).toBe(false)
    expect(passedProjectedMoveThreshold(100, 100, 101, 101)).toBe(false)
    expect(passedProjectedMoveThreshold(100, 100, 102, 100)).toBe(true)
    expect(passedProjectedMoveThreshold(100, 100, 101.5, 101.5)).toBe(true)
  })
})
