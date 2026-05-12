// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react'
import type { NodeId } from '@/scene'
import { getAnimEngine } from '@/anim'

/**
 * Per-node animated value bundle produced by the anim engine each tick.
 *
 * REPLACE semantics: every field is optional. A defined value means
 * there's an active keyframe track for that property; the render layer
 * should use it *instead of* the static. Undefined means no track —
 * renderer falls through to the node's static value.
 *
 * Mirrors `AnimatedValue` in `src/anim/engine.ts`. The two types have to
 * stay in sync; we keep this local copy so the UI layer doesn't import
 * from the engine internals.
 */
export interface AnimatedValue {
  x?: number
  y?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
  opacity?: number
  cornerRadius?: number
  fill?: string
}

/**
 * Subscribe to the engine's per-frame output for a set of nodes.
 *
 * Uses `useSyncExternalStore` so React only re-renders the Canvas on
 * ticks that actually changed something. When nothing is animating
 * the engine emits zero updates and this hook returns a stable empty
 * object, which prevents needless work.
 */
export function useAnimatedValues(
  nodeIds: NodeId[],
): Record<NodeId, AnimatedValue> {
  const engine = getAnimEngine()
  // nodeIds changes identity on every Canvas render because the tree
  // walk re-runs. The engine ignores the actual contents and returns
  // its latest snapshot, so the argument is advisory: it lets the
  // engine know which nodes the UI needs. In practice we subscribe to
  // the whole snapshot and the consumer pulls what it wants.
  void nodeIds
  return useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot,
  )
}