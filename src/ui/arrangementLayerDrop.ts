// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI, NodeId } from '@/scene'
import type { AnimatedValue } from '@/anim/engine'
import type { SolvedLayout } from '@/layout'
import { addArrangementMembers } from '@/scene/arrangementActions'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { arrangementLayerOwner } from './arrangementLayerTree'

export function layerDragSelection(api: SceneAPI, draggedId: NodeId, selection: readonly NodeId[]): NodeId[] {
  const ids = new Set(selection.includes(draggedId) ? selection : [draggedId])
  return [...ids].filter(id => {
    const node = api.getNode(id)
    if (!node || node.locked || id === api.getRoot()) return false
    let parent = node.parent
    const seen = new Set<string>()
    while (parent && !seen.has(parent)) {
      if (ids.has(parent)) return false
      seen.add(parent)
      parent = api.getNode(parent)?.parent ?? null
    }
    return true
  })
}

/** Attach or reorder a complete drag payload without changing layout parents. */
export function dropLayersIntoArrangement(api: SceneAPI, targetId: NodeId, ids: readonly NodeId[], edge: 'above' | 'into' | 'below', layout: SolvedLayout, animated: Record<NodeId, AnimatedValue> = {}): NodeId[] {
  const target = api.getNode(targetId)
  const owner = target?.kind === 'arrangement' ? target : target && edge !== 'into' ? arrangementLayerOwner(api, target) : null
  if (!owner?.arrangement || owner.locked) return []
  const eligible = layerDragSelection(api, ids[0] ?? '', ids).filter(id => {
    const node = api.getNode(id)!
    return !['arrangement', 'null', 'camera', 'audio'].includes(node.kind) && !arrangementLayerOwner(api, node)?.locked
  })
  let attached: NodeId[] = []
  api.doc.transact(() => {
    addArrangementMembers(api, owner.id, eligible, layout, animated)
    const current = api.getNode(owner.id)?.arrangement
    if (!current) return
    attached = eligible.filter(id => current.memberIds.includes(id))
    const order = current.memberIds.filter(id => !attached.includes(id))
    const targetIndex = order.indexOf(targetId)
    const index = edge === 'into' || targetIndex < 0 ? order.length : targetIndex + (edge === 'below' ? 1 : 0)
    order.splice(index, 0, ...attached)
    api.setNodeProperty(owner.id, 'arrangement', { ...current, memberIds: order })
  }, UNDOABLE_GESTURE_ORIGIN)
  return attached
}
