// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { FlexDirection, Node, NodeId, SceneAPI } from '@/scene'
import type { SolvedLayout } from '@/layout'
import {
  canPatchAnimatedLeafSizes,
  patchAnimatedLeafSizes,
} from '@/ui/animatedSizeLayout'

export type AnimatedLayoutValue = Readonly<
  Pick<
    AnimatedValue,
    | 'width'
    | 'height'
    | 'layoutDirection'
    | 'layoutGap'
    | 'layoutPaddingTop'
    | 'layoutPaddingRight'
    | 'layoutPaddingBottom'
    | 'layoutPaddingLeft'
  >
>

export type AnimatedLayoutSnapshot = Readonly<
  Record<NodeId, AnimatedLayoutValue>
>

const EMPTY_ANIMATED_LAYOUT = Object.freeze({}) as AnimatedLayoutSnapshot

const ANIMATED_LAYOUT_KEYS = [
  'width',
  'height',
  'layoutDirection',
  'layoutGap',
  'layoutPaddingTop',
  'layoutPaddingRight',
  'layoutPaddingBottom',
  'layoutPaddingLeft',
] as const satisfies readonly (keyof AnimatedLayoutValue)[]

/**
 * Select only values that can change solved geometry.
 *
 * Paint and transform animation frames therefore keep the same snapshot
 * identity and never re-run Yoga. Equal layout frames are structurally shared
 * as well, which matters for discrete direction tracks while they hold a
 * value between keyframes.
 */
export function createAnimatedLayoutSnapshotSelector() {
  let previousSource: Record<NodeId, AnimatedValue> | null = null
  let previousSelection: AnimatedLayoutSnapshot = EMPTY_ANIMATED_LAYOUT

  return (source: Record<NodeId, AnimatedValue>): AnimatedLayoutSnapshot => {
    if (source === previousSource) return previousSelection
    previousSource = source

    const next: Record<NodeId, AnimatedLayoutValue> = {}
    for (const [nodeId, sourceValue] of Object.entries(source)) {
      const value = normalizedAnimatedLayoutValue(sourceValue)
      if (value) next[nodeId] = value
    }

    const nextIds = Object.keys(next)
    if (nextIds.length === 0) {
      previousSelection = EMPTY_ANIMATED_LAYOUT
      return previousSelection
    }

    const previousIds = Object.keys(previousSelection)
    if (
      previousIds.length === nextIds.length &&
      nextIds.every((nodeId) =>
        sameAnimatedLayoutValue(previousSelection[nodeId], next[nodeId]),
      )
    ) {
      return previousSelection
    }

    previousSelection = next
    return previousSelection
  }
}

/** Compose one animation-frame layout over an authored node, read-only. */
export function applyAnimatedLayout(
  node: Node,
  value: AnimatedLayoutValue | undefined,
): Node {
  if (!value) return node

  let next = node
  if ('size' in next && (value.width !== undefined || value.height !== undefined)) {
    next = {
      ...next,
      size: {
        ...next.size,
        ...(value.width !== undefined ? { width: value.width } : {}),
        ...(value.height !== undefined ? { height: value.height } : {}),
      },
    } as Node
  }

  if ('layout' in next && hasLayoutContainerOverride(value)) {
    next = {
      ...next,
      layout: {
        ...next.layout,
        ...(value.layoutDirection !== undefined
          ? { direction: value.layoutDirection }
          : {}),
        ...(value.layoutGap !== undefined ? { gap: value.layoutGap } : {}),
        padding: {
          ...next.layout.padding,
          ...(value.layoutPaddingTop !== undefined
            ? { top: value.layoutPaddingTop }
            : {}),
          ...(value.layoutPaddingRight !== undefined
            ? { right: value.layoutPaddingRight }
            : {}),
          ...(value.layoutPaddingBottom !== undefined
            ? { bottom: value.layoutPaddingBottom }
            : {}),
          ...(value.layoutPaddingLeft !== undefined
            ? { left: value.layoutPaddingLeft }
            : {}),
        },
      },
    } as Node
  }

  return next
}

/** SceneAPI facade used by Yoga for the current animation frame. */
export function sceneAPIWithAnimatedLayout(
  api: SceneAPI,
  values: AnimatedLayoutSnapshot,
): SceneAPI {
  if (Object.keys(values).length === 0) return api
  return {
    ...api,
    getNode: (nodeId) => {
      const node = api.getNode(nodeId)
      return node ? applyAnimatedLayout(node, values[nodeId]) : null
    },
    getChildren: (nodeId) =>
      api
        .getChildren(nodeId)
        .map((node) => applyAnimatedLayout(node, values[node.id])),
  }
}

/**
 * Preserve the rect-only performance path exclusively for size-only tracks.
 * Gap, padding, or direction can move siblings and must use Yoga.
 */
export function canPatchAnimatedLayout(
  api: SceneAPI,
  values: AnimatedLayoutSnapshot,
): boolean {
  for (const value of Object.values(values)) {
    if (hasLayoutContainerOverride(value)) return false
  }
  return canPatchAnimatedLeafSizes(api, values)
}

export function patchAnimatedLayout(
  solved: SolvedLayout,
  values: AnimatedLayoutSnapshot,
): SolvedLayout {
  return patchAnimatedLeafSizes(solved, values)
}

function normalizedAnimatedLayoutValue(
  source: AnimatedValue,
): AnimatedLayoutValue | null {
  const value: Record<string, number | FlexDirection> = {}
  const width = finiteNonNegative(source.width)
  const height = finiteNonNegative(source.height)
  const gap = finiteNonNegative(source.layoutGap)
  const top = finiteNonNegative(source.layoutPaddingTop)
  const right = finiteNonNegative(source.layoutPaddingRight)
  const bottom = finiteNonNegative(source.layoutPaddingBottom)
  const left = finiteNonNegative(source.layoutPaddingLeft)

  if (width !== undefined) value.width = width
  if (height !== undefined) value.height = height
  if (source.layoutDirection === 'row' || source.layoutDirection === 'column') {
    value.layoutDirection = source.layoutDirection
  }
  if (gap !== undefined) value.layoutGap = gap
  if (top !== undefined) value.layoutPaddingTop = top
  if (right !== undefined) value.layoutPaddingRight = right
  if (bottom !== undefined) value.layoutPaddingBottom = bottom
  if (left !== undefined) value.layoutPaddingLeft = left

  return Object.keys(value).length > 0 ? (value as AnimatedLayoutValue) : null
}

function sameAnimatedLayoutValue(
  left: AnimatedLayoutValue | undefined,
  right: AnimatedLayoutValue | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return ANIMATED_LAYOUT_KEYS.every((key) => left[key] === right[key])
}

function hasLayoutContainerOverride(value: AnimatedLayoutValue): boolean {
  return (
    value.layoutDirection !== undefined ||
    value.layoutGap !== undefined ||
    value.layoutPaddingTop !== undefined ||
    value.layoutPaddingRight !== undefined ||
    value.layoutPaddingBottom !== undefined ||
    value.layoutPaddingLeft !== undefined
  )
}

function finiteNonNegative(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, value)
}
