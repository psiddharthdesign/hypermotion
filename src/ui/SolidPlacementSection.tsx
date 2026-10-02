// SPDX-License-Identifier: Apache-2.0

import type { Node, NodeId, SceneAPI } from '@/scene'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

function hasSolid(api: SceneAPI, node: Node, visited = new Set<NodeId>()): boolean {
  if (visited.has(node.id) || node.connection) return false
  visited.add(node.id)
  if ((node.kind === 'rect' || node.kind === 'ellipse') && (node.extrusion?.depth ?? 0) > 0) return true
  if (node.kind !== 'frame' && node.kind !== 'component' && node.kind !== 'instance') return false
  return api.getChildren(node.id).some(child => hasSolid(api, child, visited))
}

function protectingAncestor(api: SceneAPI, node: Node): Node | undefined {
  const visited = new Set<NodeId>([node.id])
  let id = node.parent
  while (id && !visited.has(id)) {
    visited.add(id)
    const ancestor = api.getNode(id)
    if (!ancestor) break
    if (ancestor.preventOverlap) return ancestor
    id = ancestor.parent
  }
  return undefined
}

export function SolidPlacementSection({ api, node }: { api: SceneAPI; node: Node }) {
  if (node.id === api.getRoot() || !hasSolid(api, node)) return null
  const inherited = protectingAncestor(api, node)
  return <fieldset disabled={node.locked} className="min-w-0 space-y-2 border-t border-border pt-4" aria-label="3D placement">
    <label className="flex items-center justify-between gap-2 text-xs font-medium text-text">
      <span>Prevent overlap</span>
      <input type="checkbox" aria-label="Prevent overlap" checked={!!inherited || node.preventOverlap === true} disabled={!!inherited}
        onChange={event => {
          const current = api.getNode(node.id)
          if (!current || current.locked || protectingAncestor(api, current)) return
          api.doc.transact(() => api.setNodeProperty(node.id, 'preventOverlap', event.target.checked), UNDOABLE_GESTURE_ORIGIN)
        }} className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40" />
    </label>
    {inherited && <p className="text-[11px] leading-4 text-text-muted">Protected by {inherited.name || 'parent group'}.</p>}
    <p className="text-[11px] leading-4 text-text-muted">Stops this asset and other 3D assets from being placed inside each other. Its own parts can overlap.</p>
  </fieldset>
}
