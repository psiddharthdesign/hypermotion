// SPDX-License-Identifier: Apache-2.0

import { useMemo, useSyncExternalStore } from 'react'
import type { NodeId, SceneAPI } from '@/scene'
import { getAnimEngine } from '@/anim'
import type { TextAnimationConfig } from '@/anim'

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
  /** Z depth on the camera's optical axis. 0 = focal plane. */
  z?: number
  rotation?: number
  /** Pitch (X-axis rotation), degrees. */
  rotationX?: number
  /** Yaw (Y-axis rotation), degrees. */
  rotationY?: number
  scaleX?: number
  scaleY?: number
  anchorX?: number
  anchorY?: number
  anchorZ?: number
  opacity?: number
  cornerRadius?: number
  fill?: string
  textProgress?: number
  textAnimation?: TextAnimationConfig
  focusDistance?: number
  focusX?: number
  focusY?: number
  focusWorldX?: number
  focusWorldY?: number
  focusWorldZ?: number
  focusRadius?: number
  focusFalloff?: number
  pointOfInterestX?: number
  pointOfInterestY?: number
  pointOfInterestZ?: number
  focalLength?: number
  fieldOfView?: number
  nearClip?: number
  farClip?: number
  aperture?: number
  fStop?: number
  bladeCount?: number
  bladeRotation?: number
  bokehRatio?: number
  blurLevel?: number
  blurQuality?: number
}

const EMPTY_ANIMATED_VALUES = Object.freeze({}) as Record<
  NodeId,
  AnimatedValue
>
const subscribeToNothing = () => () => {}
const getZeroPlaybackClock = () => 0

function sameAnimatedValue(
  left: AnimatedValue | undefined,
  right: AnimatedValue | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left) as (keyof AnimatedValue)[]
  const rightKeys = Object.keys(right) as (keyof AnimatedValue)[]
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

/**
 * Select one stable slice from the animation engine's global snapshot.
 *
 * The engine publishes a new object every frame. Returning that global
 * object from every consumer meant a camera-only track also rerendered the
 * complete scene DOM. This selector structurally shares its previous result
 * and returns the same frozen empty object when none of the requested nodes
 * is animated.
 */
export function createAnimatedSnapshotSelector(nodeIds: readonly NodeId[]) {
  const selectedIds = [...nodeIds]
  let previousSource: Record<NodeId, AnimatedValue> | null = null
  let previousSelection = EMPTY_ANIMATED_VALUES

  return (source: Record<NodeId, AnimatedValue>): Record<NodeId, AnimatedValue> => {
    if (source === previousSource) return previousSelection
    previousSource = source

    const next: Record<NodeId, AnimatedValue> = {}
    for (const id of selectedIds) {
      const value = source[id]
      if (value) next[id] = value
    }
    const nextIds = Object.keys(next)
    if (nextIds.length === 0) {
      previousSelection = EMPTY_ANIMATED_VALUES
      return previousSelection
    }

    const previousIds = Object.keys(previousSelection)
    if (
      previousIds.length === nextIds.length &&
      nextIds.every((id) =>
        sameAnimatedValue(previousSelection[id], next[id]),
      )
    ) {
      return previousSelection
    }

    previousSelection = next
    return previousSelection
  }
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
  const selectSnapshot = useMemo(
    () => createAnimatedSnapshotSelector(nodeIds),
    [nodeIds],
  )
  const getSelectedSnapshot = useMemo(
    () => () => selectSnapshot(engine.getSnapshot()),
    [engine, selectSnapshot],
  )
  return useSyncExternalStore(
    engine.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot,
  )
}

/**
 * Node-authored text effects predate `text.progress` tracks. They still use
 * absolute scene time, but the structurally shared animation selector stays
 * empty for them. Opt only their small WebGL leaf into the engine clock so
 * playback remains 60fps without making the complete editor render per tick.
 */
export function useAnimationPlaybackClock(enabled: boolean): number {
  const engine = getAnimEngine()
  const getSnapshot = enabled ? engine.getPlayhead : getZeroPlaybackClock
  return useSyncExternalStore(
    enabled ? engine.subscribe : subscribeToNothing,
    getSnapshot,
    getSnapshot,
  )
}

export function hasNodeDrivenTextAnimation(
  api: SceneAPI,
  nodeIds: readonly NodeId[],
): boolean {
  for (const nodeId of nodeIds) {
    const node = api.getNode(nodeId)
    if (node?.kind !== 'text' || !node.textAnimation) continue
    const engineDriven = api.getTracksForNode(nodeId).some(
      (track) =>
        track.propertyId === 'text.progress' && track.keyframes.length >= 2,
    )
    if (!engineDriven) return true
  }
  return false
}
