// SPDX-License-Identifier: Apache-2.0

import type { Position } from '@/scene'

export type ParentLayoutMode = 'none' | 'flex' | 'grid'

/**
 * A projected selection can only leave its Yoga slot when layout no longer
 * owns that slot. Keep this rule shared with the pointer overlay so a flow
 * child in a flex/grid parent never gains an accidental free-canvas handle.
 */
export function canMoveProjectedSelection({
  isRoot,
  locked,
  position,
  parentLayoutMode,
}: {
  isRoot: boolean
  locked: boolean
  position: Position
  parentLayoutMode: ParentLayoutMode
}): boolean {
  return (
    !isRoot &&
    !locked &&
    (position === 'absolute' || parentLayoutMode === 'none')
  )
}

/** The move gesture starts after two physical screen pixels. */
export function passedProjectedMoveThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold = 2,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= threshold
}
