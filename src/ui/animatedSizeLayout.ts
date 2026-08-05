// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { Node, NodeId, SceneAPI } from '@/scene'
import type { SolvedLayout } from '@/layout'

export type AnimatedSizeSnapshot = Readonly<
  Record<NodeId, Readonly<Pick<AnimatedValue, 'width' | 'height'>>>
>

const EMPTY_ANIMATED_SIZES = Object.freeze({}) as AnimatedSizeSnapshot

/**
 * Select only layout-size overrides from the animation engine's global frame.
 *
 * Transform, opacity, and paint tracks should never invalidate Yoga. This
 * selector structurally shares its previous result, so useSyncExternalStore
 * subscribers re-render only while a width/height track is actually changing.
 */
export function createAnimatedSizeSnapshotSelector() {
  let previousSource: Record<NodeId, AnimatedValue> | null = null
  let previousSelection: AnimatedSizeSnapshot = EMPTY_ANIMATED_SIZES

  return (source: Record<NodeId, AnimatedValue>): AnimatedSizeSnapshot => {
    if (source === previousSource) return previousSelection
    previousSource = source

    const next: Record<NodeId, Pick<AnimatedValue, 'width' | 'height'>> = {}
    for (const [nodeId, value] of Object.entries(source)) {
      const width = finiteSize(value.width)
      const height = finiteSize(value.height)
      if (width === undefined && height === undefined) continue
      next[nodeId] = {
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      }
    }

    const nextIds = Object.keys(next)
    if (nextIds.length === 0) {
      previousSelection = EMPTY_ANIMATED_SIZES
      return previousSelection
    }

    const previousIds = Object.keys(previousSelection)
    if (
      previousIds.length === nextIds.length &&
      nextIds.every((nodeId) => {
        const before = previousSelection[nodeId]
        const after = next[nodeId]
        return before?.width === after?.width && before?.height === after?.height
      })
    ) {
      return previousSelection
    }

    previousSelection = next
    return previousSelection
  }
}

/** Return one scene node with numeric animated axes composed over its authoring mode. */
export function applyAnimatedSize(
  node: Node,
  value: AnimatedSizeSnapshot[NodeId] | undefined,
): Node {
  if (!value || !('size' in node)) return node
  return {
    ...node,
    size: {
      ...node.size,
      ...(value.width !== undefined ? { width: value.width } : {}),
      ...(value.height !== undefined ? { height: value.height } : {}),
    },
  } as Node
}

/** Read-only SceneAPI facade used by Yoga for the current animation frame. */
export function sceneAPIWithAnimatedSizes(
  api: SceneAPI,
  values: AnimatedSizeSnapshot,
): SceneAPI {
  if (Object.keys(values).length === 0) return api
  return {
    ...api,
    getNode: (nodeId) => {
      const node = api.getNode(nodeId)
      return node ? applyAnimatedSize(node, values[nodeId]) : null
    },
    getChildren: (nodeId) =>
      api
        .getChildren(nodeId)
        .map((node) => applyAnimatedSize(node, values[node.id])),
  }
}

/**
 * True when animated dimensions cannot affect any other solved rect.
 *
 * A leaf under a free-positioned (`none`) parent owns its own box: changing
 * that box does not reflow siblings or descendants. Those are common after a
 * Figma import (chart bars and grid rules), so they can bypass Yoga entirely
 * during playback. Flow children and containers still take the authoritative
 * full-layout path.
 */
export function canPatchAnimatedLeafSizes(
  api: SceneAPI,
  values: AnimatedSizeSnapshot,
): boolean {
  const entries = Object.entries(values)
  if (entries.length === 0) return true

  return entries.every(([nodeId]) => {
    const node = api.getNode(nodeId)
    if (!node || !('size' in node) || node.parent === null) return false
    const parent = api.getNode(node.parent)
    if (!parent || !('layout' in parent) || parent.layout.mode !== 'none') {
      return false
    }
    return api.getChildren(nodeId).every((child) => !child.visible)
  })
}

/**
 * Paint numeric leaf dimensions over an existing authoritative layout.
 * Copies only when a rect actually changes and never mutates the cached solve.
 */
export function patchAnimatedLeafSizes(
  solved: SolvedLayout,
  values: AnimatedSizeSnapshot,
): SolvedLayout {
  let next = solved
  for (const [nodeId, value] of Object.entries(values)) {
    const rect = solved[nodeId]
    if (!rect) continue
    const width = value.width ?? rect.width
    const height = value.height ?? rect.height
    if (width === rect.width && height === rect.height) continue
    if (next === solved) next = { ...solved }
    next[nodeId] = { ...rect, width, height }
  }
  return next
}

function finiteSize(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, value)
}
