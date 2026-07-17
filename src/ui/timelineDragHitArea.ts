// SPDX-License-Identifier: Apache-2.0

/**
 * Segment connectors are visually quiet, but their pointer target should be
 * large enough to grab without pixel hunting. The target stays inside the
 * 24 px timeline row so it cannot steal interaction from adjacent tracks.
 */
export const SEGMENT_DRAG_HIT_HEIGHT = 18

/**
 * Keep at least half of every group/set bar available for moving the whole
 * set. Fixed 16 px edge handles used to overlap most (or all) of short bars,
 * so grabbing the body accidentally started edge scaling instead.
 */
export function groupEdgeHitWidth(barWidth: number): number {
  const width = Math.max(0, barWidth)
  return Math.min(8, width / 4)
}

