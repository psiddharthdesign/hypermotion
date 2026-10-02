// SPDX-License-Identifier: Apache-2.0
import type { NodeId, SceneAPI } from '@/scene'

/** Selecting an asset exposes its editable solid parts, while respecting locks up the hierarchy. */
export function selectedSolidNodeIds(api: SceneAPI, selection: readonly NodeId[]): Set<NodeId> {
  const result = new Set<NodeId>()
  const visited = new Set<NodeId>()
  const root = api.getRoot()
  const visit = (id: NodeId) => {
    if (visited.has(id) || id === root) return
    visited.add(id)
    const node = api.getNode(id)
    if (!node || node.locked || !node.visible || node.workspaceOnly) return
    if ((node.kind === 'rect' || node.kind === 'ellipse') && node.extrusion) result.add(id)
    for (const child of api.getChildren(id)) visit(child.id)
  }
  for (const id of selection) {
    let parent = api.getNode(id)?.parent
    const ancestors = new Set<NodeId>()
    let blocked = false
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent)
      const node = api.getNode(parent)
      if (!node || node.locked || !node.visible || node.workspaceOnly) { blocked = true; break }
      parent = node.parent
    }
    if (!blocked) visit(id)
  }
  return result
}
