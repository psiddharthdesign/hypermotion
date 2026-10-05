// SPDX-License-Identifier: Apache-2.0

import { getAnimEngine, type AnimatedValue } from '@/anim'
import { evaluateLayerMotionPath } from '@/anim/layerMotionPath'
import type { SolvedLayout } from '@/layout'
import type { NodeId, SceneAPI, Transform } from '@/scene'
import { createSolidMoveConstraint } from './solidMoveConstraint'

type PositionPatch = Partial<Pick<Transform, 'x' | 'y' | 'z'>>
const AXES = ['x', 'y', 'z'] as const

/** Pivot/rotation/scale actions keep their existing semantics. Only XYZ edits participate. */
export function isSolidPositionPatch(patch: object): patch is PositionPatch {
  const entries = Object.entries(patch)
  return entries.length > 0 && entries.every(([key, value]) => AXES.includes(key as typeof AXES[number]) && typeof value === 'number' && Number.isFinite(value))
}

export interface SolidInspectorPositionConstraint {
  /** Display coordinates, including any animated motion path offset. */
  preview: (patch: PositionPatch) => PositionPatch
  /** Authored coordinates, with a motion path applied separately by animation. */
  commit: (patch: PositionPatch) => PositionPatch
}

/**
 * Freeze the authoritative animation snapshot before the first scrub packet.
 * Inspector's `anim` value includes transient previews, so using it to recreate
 * this session every packet would feed the clamped result back into its origin.
 */
export function createSolidInspectorPositionConstraint(
  api: SceneAPI,
  nodeId: NodeId,
  animated: Record<NodeId, AnimatedValue> = getAnimEngine().getSnapshot(),
  layout?: SolvedLayout | null,
): SolidInspectorPositionConstraint | null {
  const node = api.getNode(nodeId)
  if (!node || node.kind === 'camera' || node.locked) return null
  const constrain = createSolidMoveConstraint(api, nodeId, layout, animated)
  if (!constrain) return null
  const value = animated[nodeId]
  const origin = { x: value?.x ?? node.transform.x, y: value?.y ?? node.transform.y, z: value?.z ?? node.transform.z }
  const path = node.motionPath && value?.motionPathProgress !== undefined
    ? evaluateLayerMotionPath(node.motionPath, value.motionPathProgress) : { x: 0, y: 0, z: 0 }
  const preview = (patch: PositionPatch): PositionPatch => {
    const delta = constrain({ x: (patch.x ?? origin.x) - origin.x, y: (patch.y ?? origin.y) - origin.y, z: (patch.z ?? origin.z) - origin.z }, false, false)
    const result: PositionPatch = {}
    // Preserve unedited axes and their animation tracks; inverse basis math
    // may introduce tiny nonzero rounding noise on these other coordinates.
    for (const axis of AXES) if (patch[axis] !== undefined) result[axis] = origin[axis] + delta[axis]
    return result
  }
  return {
    preview,
    commit: patch => {
      const result = preview(patch)
      for (const axis of AXES) if (result[axis] !== undefined) result[axis]! -= path[axis]
      return result
    },
  }
}
