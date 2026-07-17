// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  groupEdgeHitWidth,
  SEGMENT_DRAG_HIT_HEIGHT,
} from '@/ui/timelineDragHitArea'

describe('timeline drag hit areas', () => {
  it('gives quiet segment connectors a forgiving in-row target', () => {
    expect(SEGMENT_DRAG_HIT_HEIGHT).toBeGreaterThanOrEqual(16)
    expect(SEGMENT_DRAG_HIT_HEIGHT).toBeLessThanOrEqual(24)
  })

  it.each([2, 8, 16, 24, 32, 80, 240])(
    'preserves a body drag zone for a %dpx keyframe set',
    (barWidth) => {
      const edge = groupEdgeHitWidth(barWidth)
      const body = barWidth - edge * 2
      expect(edge).toBeGreaterThanOrEqual(0)
      expect(edge).toBeLessThanOrEqual(8)
      expect(body).toBeGreaterThanOrEqual(barWidth / 2)
    },
  )
})

