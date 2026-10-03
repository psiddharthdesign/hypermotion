// SPDX-License-Identifier: Apache-2.0
import type { Node, SceneAPI } from '@/scene'

/** A presentation group: keep layout parents and animated transforms intact. */
export function arrangementLayerOwner(api: SceneAPI, node: Node): Node | null {
  const owner = node.transformParent && api.getNode(node.transformParent.nodeId)
  return owner?.kind === 'arrangement' && owner.parent === api.getRoot() && owner.arrangement?.memberIds.includes(node.id) ? owner : null
}

export function layerPanelChildren(api: SceneAPI, node: Node): Node[] {
  if (node.kind === 'arrangement') return (node.arrangement?.memberIds ?? []).flatMap((id) => {
    const member = api.getNode(id)
    return member && arrangementLayerOwner(api, member)?.id === node.id ? [member] : []
  })
  return api.getChildren(node.id).filter((child) => child.kind !== 'audio' && !arrangementLayerOwner(api, child))
}

export function layerPanelParent(api: SceneAPI, node: Node): string | null {
  return arrangementLayerOwner(api, node)?.id ?? node.parent
}
