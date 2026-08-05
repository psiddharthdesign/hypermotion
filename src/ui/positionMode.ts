// SPDX-License-Identifier: Apache-2.0

import type { Rect } from '@/layout'
import type { Transform } from '@/scene'

const roundToHundredth = (value: number) => Math.round(value * 100) / 100

/**
 * Convert a post-layout transform from a flow slot to the absolute origin.
 *
 * Yoga places absolute children from the parent's border-box origin in this
 * scene model. The solved child-to-parent delta is therefore the slot that is
 * about to disappear; adding it to the existing transform preserves the
 * layer's visible pose. This also intentionally preserves free-positioned
 * children under Layout: None, where both solved origins are the same.
 */
export function transformForAbsolutePosition(
  transform: Transform,
  childRect: Rect,
  parentRect: Rect,
): Transform {
  return {
    ...transform,
    x: roundToHundredth(transform.x + childRect.x - parentRect.x),
    y: roundToHundredth(transform.y + childRect.y - parentRect.y),
  }
}
