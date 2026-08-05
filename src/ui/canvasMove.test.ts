// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { canMoveChildOnCanvas } from './canvasMove'

describe('canvas child dragging', () => {
  it('allows flow children only when their immediate parent uses free layout', () => {
    expect(canMoveChildOnCanvas('flow', 'none')).toBe(true)
    expect(canMoveChildOnCanvas('flow', 'flex')).toBe(false)
    expect(canMoveChildOnCanvas('flow', 'grid')).toBe(false)
  })

  it('preserves dragging for children explicitly removed from auto layout', () => {
    expect(canMoveChildOnCanvas('absolute', 'none')).toBe(true)
    expect(canMoveChildOnCanvas('absolute', 'flex')).toBe(true)
    expect(canMoveChildOnCanvas('absolute', 'grid')).toBe(true)
  })
})
