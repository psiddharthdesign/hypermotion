// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import { recordKeyframesForPatch, stampToActiveTracksForPatch } from '@/anim/recordKeyframes'
import type { EllipseNode, NodeId, RectNode, SceneAPI } from '@/scene'
import { DEFAULT_EXTRUSION_SIDE_COLOR, extrusionShapeLimitation, normalizeExtrusionDepth } from '@/scene/extrusion'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export function supportsExtrusion(node: RectNode | EllipseNode, anim?: AnimatedValue): boolean {
  return extrusionShapeLimitation(node, anim) === undefined
}

export function setExtrusionEnabled(api: SceneAPI, nodeId: NodeId, enabled: boolean, anim?: AnimatedValue): void {
  const node = api.getNode(nodeId)
  if (!node || node.locked || (node.kind !== 'rect' && node.kind !== 'ellipse')) return
  if (enabled && !supportsExtrusion(node, anim)) return
  api.doc.transact(() => {
    api.setNodeProperty(nodeId, 'extrusion', enabled
      ? node.extrusion ?? {
          depth: 80,
          sideColor: node.appearance.fill?.kind === 'solid' ? node.appearance.fill.color : DEFAULT_EXTRUSION_SIDE_COLOR,
        }
      : undefined)
  }, UNDOABLE_GESTURE_ORIGIN)
}

/** One undo step persists the final scrub value and its timeline edit together. */
export function commitExtrusionDepth(api: SceneAPI, nodeId: NodeId, depth: number, time: number, recording: boolean): void {
  const node = api.getNode(nodeId)
  if (!node || node.locked || !node.extrusion || (node.kind !== 'rect' && node.kind !== 'ellipse')) return
  const patch = { depth: normalizeExtrusionDepth(depth) }
  api.doc.transact(() => {
    api.setNodeProperty(nodeId, 'extrusion', { ...node.extrusion!, ...patch })
    const stamp = recording ? recordKeyframesForPatch : stampToActiveTracksForPatch
    stamp(api, nodeId, time, 'extrusion', patch)
  }, UNDOABLE_GESTURE_ORIGIN)
}
