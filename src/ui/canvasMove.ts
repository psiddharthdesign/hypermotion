// SPDX-License-Identifier: Apache-2.0

import type { LayoutMode, Position } from '@/scene'

/**
 * Whether a child can translate directly on the canvas.
 *
 * A free-canvas (`none`) parent owns no child positions, so its direct
 * children can always move. Flex/grid flow children remain owned by their
 * parent layout; their existing absolute-position escape hatch is preserved.
 */
export function canMoveChildOnCanvas(
  position: Position,
  parentMode: LayoutMode,
): boolean {
  return parentMode === 'none' || position === 'absolute'
}
