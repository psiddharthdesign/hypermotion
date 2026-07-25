// SPDX-License-Identifier: Apache-2.0

import type { Node, NodeId, SceneAPI } from '@/scene'

/**
 * Normal planes use small document-derived paint-order values. Reserve a
 * separate band below selection chrome (100000+) for explicit overlays.
 */
export const ALWAYS_ON_TOP_RENDER_ORDER_BASE = 50_000

export function isAlwaysOnTopNode(
  node: Node | null | undefined,
): boolean {
  return node?.kind === 'instance' && node.alwaysOnTop
}

export function layerRenderOrder(node: Node, paintOrder: number): number {
  return (
    (isAlwaysOnTopNode(node) ? ALWAYS_ON_TOP_RENDER_ORDER_BASE : 0) +
    paintOrder
  )
}

export function isInAlwaysOnTopSubtree(
  api: SceneAPI,
  nodeId: NodeId,
): boolean {
  let current: NodeId | null = nodeId
  const visited = new Set<NodeId>()
  while (current && !visited.has(current)) {
    visited.add(current)
    const node = api.getNode(current)
    if (!node) return false
    if (isAlwaysOnTopNode(node)) return true
    current = node.parent
  }
  return false
}

/**
 * DOM nodes are individually materialized. Stable-partition the ordinary
 * scene order so an overlay instance and every one of its descendants paint
 * together after normal layers.
 */
export function moveAlwaysOnTopSubtreesLast(
  api: SceneAPI,
  order: readonly NodeId[],
): NodeId[] {
  const { normal, overlay } = partitionAlwaysOnTopSubtrees(api, order)
  return [...normal, ...overlay]
}

export function partitionAlwaysOnTopSubtrees(
  api: SceneAPI,
  order: readonly NodeId[],
): { normal: NodeId[]; overlay: NodeId[] } {
  const normal: NodeId[] = []
  const overlay: NodeId[] = []
  for (const id of order) {
    ;(isInAlwaysOnTopSubtree(api, id) ? overlay : normal).push(id)
  }
  return { normal, overlay }
}

/**
 * Return only the outermost overlay instances in bottom-to-top paint order.
 * Flat export renderers can draw their normal pass first, then append these
 * complete subtrees without rendering nested overlays twice.
 */
export function alwaysOnTopRootsInPaintOrder(api: SceneAPI): NodeId[] {
  const rootId = api.getRoot()
  if (!rootId) return []
  const out: NodeId[] = []
  const visit = (id: NodeId, insideOverlay: boolean) => {
    const node = api.getNode(id)
    if (!node) return
    const overlay = isAlwaysOnTopNode(node)
    if (overlay && !insideOverlay) {
      out.push(id)
      return
    }
    const children = api.getChildren(id)
    for (let index = children.length - 1; index >= 0; index--) {
      visit(children[index]!.id, insideOverlay || overlay)
    }
  }
  visit(rootId, false)
  return out
}
