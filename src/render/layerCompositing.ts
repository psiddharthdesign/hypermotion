// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { Node, NodeId } from '@/scene/types'
import { normalizeLayerZIndex } from '@/scene/zIndex'

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

export function layerRenderOrder(
  node: Node,
  paintOrder: number,
  insideAlwaysOnTopSubtree = isAlwaysOnTopNode(node),
): number {
  return (
    (insideAlwaysOnTopSubtree ? ALWAYS_ON_TOP_RENDER_ORDER_BASE : 0) +
    paintOrder
  )
}

/**
 * Return siblings in the order a painter should append them: back to front.
 *
 * z-index is deliberately local to the sibling list. Recursing through this
 * order keeps every subtree contiguous, so a deeply nested child can never
 * escape above an unrelated parent. Equal z-index values retain the existing
 * layer-panel contract: child index 0 is frontmost.
 */
export function nodesInBackToFrontPaintOrder(
  nodes: readonly Node[],
): Node[] {
  return nodes
    .map((node, index) => ({
      node,
      index,
      zIndex: normalizeLayerZIndex(node.zIndex),
    }))
    .sort(
      (a, b) =>
        a.zIndex - b.zIndex ||
        b.index - a.index,
    )
    .map(({ node }) => node)
}

export function childrenInBackToFrontPaintOrder(
  api: SceneAPI,
  parentId: NodeId,
): Node[] {
  return nodesInBackToFrontPaintOrder(api.getChildren(parentId))
}

/**
 * Flatten a layer subtree in deterministic back-to-front paint order. Each
 * direct sibling list is sorted independently and each child subtree is
 * emitted as one contiguous paint group.
 */
export function flattenLayerSubtreeInPaintOrder(
  api: SceneAPI,
  rootId: NodeId,
): NodeId[] {
  const out: NodeId[] = []
  const visited = new Set<NodeId>()
  const visit = (id: NodeId) => {
    if (visited.has(id)) return
    const node = api.getNode(id)
    if (!node) return
    visited.add(id)
    out.push(id)
    for (const child of childrenInBackToFrontPaintOrder(api, id)) {
      visit(child.id)
    }
  }
  visit(rootId)
  return out
}

/**
 * Scene paint order shared by the editor and hidden render window. Explicit
 * overlay instances remain a final, separate compositing pass regardless of
 * their numeric z-index.
 */
export function flattenSceneInPaintOrder(
  api: SceneAPI,
  rootId: NodeId,
): NodeId[] {
  return moveAlwaysOnTopSubtreesLast(
    api,
    flattenLayerSubtreeInPaintOrder(api, rootId),
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
    for (const child of childrenInBackToFrontPaintOrder(api, id)) {
      visit(child.id, insideOverlay || overlay)
    }
  }
  visit(rootId, false)
  return out
}
