// SPDX-License-Identifier: Apache-2.0

/**
 * Layout engine (Step 3).
 *
 * Wraps Yoga (Meta's WASM build). Maps scene nodes to Yoga nodes, runs
 * the layout pass, emits computed rects keyed by node id.
 *
 * Re-solve rules:
 *   - On structural change (add/remove/reparent)
 *   - On layout-property change (flex, gap, padding, size, position)
 *   - On variant switch of an instance (variant may change layout props)
 *
 * Never on every frame — animation properties (opacity, transform) do
 * NOT trigger a re-solve. Keyframes on transform are applied as a
 * post-layout offset. Keyframes on layout properties trigger the
 * FLIP technique to tween between solved states.
 *
 * Public surface: solveLayout + the yogaReady promise + types. Anything
 * outside src/layout/ imports from here, not from engine/mapper/types.
 */

export { solveLayout, yogaReady } from './engine'
export type { ContainerSize, Rect, SolvedLayout } from './types'