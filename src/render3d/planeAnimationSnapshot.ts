// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { NodeId } from '@/scene'

/**
 * Animation fields consumed while building Plane3D world transforms.
 *
 * Text progress and paint properties are intentionally absent: they are
 * applied while syncing the existing Three.js records and must not rebuild
 * the complete scene plane tree on every glyph-animation frame.
 */
const WORLD_PLANE_ANIMATION_PROPERTIES = [
  'x',
  'y',
  'z',
  'rotation',
  'rotationX',
  'rotationY',
  'scaleX',
  'scaleY',
  'anchorX',
  'anchorY',
  'anchorZ',
  'opacity',
] as const satisfies readonly (keyof AnimatedValue)[]

const EMPTY_WORLD_PLANE_ANIMATION = Object.freeze({}) as Record<
  NodeId,
  AnimatedValue
>

function sameWorldPlaneAnimation(
  left: AnimatedValue | undefined,
  right: AnimatedValue | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return WORLD_PLANE_ANIMATION_PROPERTIES.every((property) =>
    Object.is(left[property], right[property]),
  )
}

/**
 * Projects the engine's full per-frame snapshot onto just the values used by
 * `buildWorldPlanes`, structurally sharing the previous result when those
 * values did not change.
 *
 * The animation engine necessarily publishes a fresh snapshot while
 * `text.progress` advances. Without this boundary, that unrelated reference
 * invalidated the world-plane `useMemo` and recursively rebuilt the full scene
 * graph for every letter-animation frame.
 */
export function createWorldPlaneAnimationSelector() {
  let previousSource: Record<NodeId, AnimatedValue> | null = null
  let previousSelection = EMPTY_WORLD_PLANE_ANIMATION

  return (
    source: Record<NodeId, AnimatedValue>,
  ): Record<NodeId, AnimatedValue> => {
    if (source === previousSource) return previousSelection
    previousSource = source

    const next: Record<NodeId, AnimatedValue> = {}
    for (const [nodeId, value] of Object.entries(source)) {
      let projected: AnimatedValue | undefined
      for (const property of WORLD_PLANE_ANIMATION_PROPERTIES) {
        const propertyValue = value[property]
        if (propertyValue === undefined) continue
        projected ??= {}
        Object.assign(projected, { [property]: propertyValue })
      }
      if (projected) next[nodeId] = projected
    }

    const nextIds = Object.keys(next)
    if (nextIds.length === 0) {
      previousSelection = EMPTY_WORLD_PLANE_ANIMATION
      return previousSelection
    }

    const previousIds = Object.keys(previousSelection)
    if (
      previousIds.length === nextIds.length &&
      nextIds.every((nodeId) =>
        sameWorldPlaneAnimation(previousSelection[nodeId], next[nodeId]),
      )
    ) {
      return previousSelection
    }

    previousSelection = next
    return previousSelection
  }
}
