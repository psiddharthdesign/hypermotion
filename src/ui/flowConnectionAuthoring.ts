// SPDX-License-Identifier: Apache-2.0

import { recordKeyframesForPatch, stampToActiveTracksForPatch } from '@/anim/recordKeyframes'
import type { NodeId, SceneAPI } from '@/scene'
import { DEFAULT_FLOW_CONNECTION, normalizeFlowConnection, type FlowConnection } from '@/scene/flowConnection'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export type FlowConnectionSelection =
  | { valid: true; sourceId: NodeId; targetId: NodeId; parentId: NodeId }
  | { valid: false; message: string }

/** Validate the authored selection without silently dropping ineligible layers. */
export function validateFlowConnectionSelection(api: SceneAPI, selection: readonly NodeId[]): FlowConnectionSelection {
  const ids = [...new Set(selection)]
  if (ids.length !== 2) return { valid: false, message: 'Select two assets to connect. The first selected asset is the source.' }
  const rootId = api.getRoot()
  for (const id of ids) {
    const node = api.getNode(id)
    if (!node || id === rootId || node.kind === 'camera' || node.kind === 'audio' || node.kind === 'null' || node.kind === 'arrangement' || node.connection) {
      return { valid: false, message: 'Choose two visual assets, rather than a scene, camera, controller, or existing connection.' }
    }
  }
  for (const id of ids) {
    let ancestorId: NodeId | null = id
    const visited = new Set<NodeId>()
    let inScene = false
    while (ancestorId && !visited.has(ancestorId)) {
      visited.add(ancestorId)
      const ancestor = api.getNode(ancestorId)
      if (!ancestor || ancestor.workspaceOnly) break
      if (ancestor.locked || !ancestor.visible) {
        return { valid: false, message: 'Choose visible, unlocked assets. Their containing groups must also be visible and unlocked.' }
      }
      if (ancestorId !== id && ids.includes(ancestorId)) {
        return { valid: false, message: 'Choose two separate assets, not a group and one of its own parts.' }
      }
      if (ancestorId === rootId) { inScene = true; break }
      ancestorId = ancestor.parent
    }
    if (!inScene) return { valid: false, message: 'Choose two assets inside the current scene.' }
  }
  return { valid: true, sourceId: ids[0]!, targetId: ids[1]!, parentId: rootId }
}

/** The attached route is procedural, but its layer and timeline remain ordinary scene data. */
export function createFlowConnection(api: SceneAPI, selection: readonly NodeId[]): NodeId {
  const checked = validateFlowConnectionSelection(api, selection)
  if (!checked.valid) throw new Error(checked.message)
  const { sourceId, targetId, parentId } = checked
  const source = api.getNode(sourceId)!
  const target = api.getNode(targetId)!
  let id = ''
  api.doc.transact(() => {
    id = api.createNode('vector', parentId, {
      name: `${source.name} → ${target.name}`,
      size: { width: 1, height: 1 },
      position: 'absolute',
      transform: { x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1, renderMode: 'plane' },
      appearance: { opacity: 1, fill: null, stroke: null, cornerRadius: 0, effects: [], blendMode: 'normal' },
      connection: { ...DEFAULT_FLOW_CONNECTION, sourceId, targetId },
    })
  }, UNDOABLE_GESTURE_ORIGIN)
  return id
}

export type FlowConnectionPatch = Partial<Omit<FlowConnection, 'version' | 'sourceId' | 'targetId'>>

/** Persist a field edit and any corresponding timeline key together in one undo step. */
export function commitFlowConnectionPatch(
  api: SceneAPI, nodeId: NodeId, patch: FlowConnectionPatch, time: number, recording: boolean,
): void {
  const node = api.getNode(nodeId)
  if (node?.kind !== 'vector' || !node.connection || node.locked) return
  const connection = normalizeFlowConnection({ ...node.connection, ...patch })
  if (!connection) return
  const normalizedPatch: Record<string, unknown> = {}
  for (const key of Object.keys(patch) as (keyof FlowConnectionPatch)[]) normalizedPatch[key] = connection[key]
  api.doc.transact(() => {
    api.setNodeProperty(nodeId, 'connection', connection)
    const stamp = recording ? recordKeyframesForPatch : stampToActiveTracksForPatch
    stamp(api, nodeId, time, 'connection', normalizedPatch)
  }, UNDOABLE_GESTURE_ORIGIN)
}

export function swapFlowConnectionEndpoints(api: SceneAPI, nodeId: NodeId): void {
  const node = api.getNode(nodeId)
  if (node?.kind !== 'vector' || !node.connection || node.locked) return
  const connection = node.connection
  api.doc.transact(() => api.setNodeProperty(nodeId, 'connection', {
    ...connection, sourceId: connection.targetId, targetId: connection.sourceId,
  }), UNDOABLE_GESTURE_ORIGIN)
}
