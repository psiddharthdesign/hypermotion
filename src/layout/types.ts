// SPDX-License-Identifier: Apache-2.0

import type { NodeId } from '@/scene'

/**
 * A computed rectangle in scene space — absolute coordinates, not
 * relative to the parent. The render layer consumes these directly.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The output of one layout pass: every node's absolute rect keyed by id.
 * Using a plain object (not Map) so React state updates can be shallow
 * and useMemo can diff by reference.
 */
export type SolvedLayout = Record<NodeId, Rect>

/**
 * The size of the container we're solving into — typically the scene
 * canvas for top-level solves. Passed explicitly so the same scene tree
 * can be solved into an export size that differs from the editor canvas.
 */
export interface ContainerSize {
  width: number
  height: number
}