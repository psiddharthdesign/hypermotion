// SPDX-License-Identifier: Apache-2.0
import type { Node, SceneAPI } from '@/scene'

/** Show an arrangement inside the closest shared container of its members. */
function arrangementContainer(api: SceneAPI, node: Node): string | null {
  const members = (node.arrangement?.memberIds ?? []).flatMap(id => {
    const member = api.getNode(id)
    return member && arrangementLayerOwner(api, member)?.id === node.id ? [member] : []
  })
  if (!members.length) return node.parent
  const ancestors = (member: Node) => {
    const result: string[] = []
    let id = member.parent
    while (id && !result.includes(id)) {
      result.push(id)
      id = api.getNode(id)?.parent ?? null
    }
    return result
  }
  const paths = members.map(ancestors)
  return paths[0]!.find(id => paths.every(path => path.includes(id))) ?? node.parent
}

/** A presentation group: keep layout parents and animated transforms intact. */
export function arrangementLayerOwner(api: SceneAPI, node: Node): Node | null {
  const owner = node.transformParent && api.getNode(node.transformParent.nodeId)
  if (owner?.kind !== 'arrangement' || !owner.arrangement?.memberIds.includes(node.id)) return null
  const seen = new Set<string>()
  let current: Node | null = owner
  while (current && !seen.has(current.id)) {
    if (current.id === api.getRoot()) return owner
    seen.add(current.id)
    current = current.parent ? api.getNode(current.parent) : null
  }
  return null
}

export function layerPanelChildren(api: SceneAPI, node: Node): Node[] {
  if (node.kind === 'arrangement') return (node.arrangement?.memberIds ?? []).flatMap((id) => {
    const member = api.getNode(id)
    return member && arrangementLayerOwner(api, member)?.id === node.id ? [member] : []
  })
  const children = api.getChildren(node.id).filter(child => child.kind !== 'audio' && layerPanelParent(api, child) === node.id)
  const root = api.getRoot()
  const nestedArrangements = root
    ? api.getAllNodeIds().map(id => api.getNode(id)).filter((child): child is Node => !!child && child.kind === 'arrangement' && arrangementContainer(api, child) === node.id && !children.some(item => item.id === child.id))
    : []
  return [...children, ...nestedArrangements]
}

export function layerPanelParent(api: SceneAPI, node: Node): string | null {
  return node.kind === 'arrangement' ? arrangementContainer(api, node) : arrangementLayerOwner(api, node)?.id ?? node.parent
}
