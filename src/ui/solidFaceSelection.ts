// SPDX-License-Identifier: Apache-2.0
import type { NodeId, SceneAPI } from '@/scene'

/** Selecting an asset exposes its editable solid parts, while respecting both layer and arrangement groups. */
export function selectedSolidNodeIds(api: SceneAPI, selection: readonly NodeId[]): Set<NodeId> {
  const result = new Set<NodeId>()
  const visited = new Set<NodeId>()
  const root = api.getRoot()
  const editable = (id: NodeId, ancestors = new Set<NodeId>()): boolean => {
    if (ancestors.has(id)) return false
    const node = api.getNode(id)
    if (!node || node.locked || !node.visible || node.workspaceOnly) return false
    if (id === root) return true
    if (!node.parent) return false
    const chain = new Set(ancestors).add(id)
    // Arrangement members keep their original layout parent. The visible
    // presentation group must still guard direct selection of a member's face.
    const owner = node.transformParent ? api.getNode(node.transformParent.nodeId) : null
    if (owner?.kind === 'arrangement' && owner.arrangement?.memberIds.includes(id) && !editable(owner.id, chain)) return false
    return editable(node.parent, chain)
  }
  const visit = (id: NodeId) => {
    if (visited.has(id) || id === root) return
    visited.add(id)
    if (!editable(id)) return
    const node = api.getNode(id)!
    if ((node.kind === 'rect' || node.kind === 'ellipse') && node.extrusion) result.add(id)
    if (node.kind === 'arrangement') {
      for (const memberId of node.arrangement?.memberIds ?? []) {
        // Ignore stale references, other scenes, and members moved to another controller.
        if (api.getNode(memberId)?.transformParent?.nodeId === id) visit(memberId)
      }
    }
    for (const child of api.getChildren(id)) visit(child.id)
  }
  for (const id of selection) visit(id)
  return result
}
