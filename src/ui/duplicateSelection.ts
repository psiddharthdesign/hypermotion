// SPDX-License-Identifier: Apache-2.0

import type { Node, NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { duplicateArrangement, repairArrangementMembership } from '@/scene/arrangementActions'
import { remapFlowConnections } from '@/scene/flowConnection'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { instantiateComponent } from '@/ui/actions'
import { duplicateCamera } from '@/ui/cameraActions'

/** One duplication gesture, shared by the shortcut and context menu. */
export function duplicateSelection(api: SceneAPI, selection: readonly NodeId[]): NodeId[] {
  repairArrangementMembership(api)
  const selected = new Set(selection)
  const roots = [...selected].filter(id => {
    const node = api.getNode(id)
    if (!node || node.locked) return false
    const seen = new Set<NodeId>()
    let current: Node | null = node
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      if (current.transformParent) {
        const owner = api.getNode(current.transformParent.nodeId)
        if (owner?.arrangement?.memberIds.includes(current.id) && selected.has(owner.id)) return false
      }
      if (current.parent && selected.has(current.parent)) return false
      current = current.parent ? api.getNode(current.parent) : null
    }
    return node.kind === 'camera' || !!node.parent
  })
  const copies: NodeId[] = []
  const mapping = new Map<NodeId, NodeId>()
  api.doc.transact(() => {
    const clone = (source: Node, parent: NodeId): NodeId => {
      const { id: _id, parent: _parent, children: _children, ...props } = source
      void _id; void _parent; void _children
      const copy = api.createNode(source.kind, parent, { ...props, name: `${source.name} copy` } as Partial<Node>)
      mapping.set(source.id, copy)
      for (const track of api.getTracksForNode(source.id)) api.setTrack({
        ...track, id: crypto.randomUUID(), nodeId: copy,
        keyframes: track.keyframes.map(key => ({ ...key, id: crypto.randomUUID() })),
      })
      for (const child of api.getChildren(source.id)) clone(child, copy)
      return copy
    }
    for (const id of roots) {
      const source = api.getNode(id)!
      if (source.kind === 'camera') {
        const copy = duplicateCamera(api, id)
        if (copy) copies.push(copy)
        continue
      }
      if (source.kind === 'arrangement') {
        const copy = duplicateArrangement(api, id)
        if (copy) copies.push(copy)
        continue
      }
      const copyId = source.kind === 'component'
        ? instantiateComponent(api, id) : clone(source, source.parent!)
      if (!copyId) continue
      mapping.set(id, copyId)
      copies.push(copyId)
      const owner = source.transformParent && api.getNode(source.transformParent.nodeId)
      const arranged = owner?.kind === 'arrangement' && owner.arrangement?.memberIds.includes(id)
      if (arranged) continue // The new slot positions the card; never nudge it off the pattern.
      const copy = api.getNode(copyId)!
      const parent = api.getNode(source.parent!)
      const free = !parent || !('layout' in parent) || parent.layout.mode === 'none'
      api.setNodeProperty(copyId, 'transform', { ...copy.transform,
        x: free ? copy.transform.x + 16 : 0,
        y: free ? copy.transform.y + 16 : 0,
      })
    }
    for (const [sourceId, copyId] of mapping) {
      const source = api.getNode(sourceId)!
      if (source.transformParent) api.setNodeProperty(copyId, 'transformParent', {
        ...source.transformParent, nodeId: mapping.get(source.transformParent.nodeId) ?? source.transformParent.nodeId,
      })
      if (source.arrangement) api.setNodeProperty(copyId, 'arrangement', {
        ...source.arrangement, memberIds: source.arrangement.memberIds.flatMap(id => mapping.has(id) ? [mapping.get(id)!] : []),
      })
    }
    // Preserve pattern order even when multi-selection order differs from it.
    for (const id of api.getAllNodeIds()) {
      const owner = api.getNode(id)
      if (!owner?.arrangement || mapping.has(id)) continue
      const memberIds = owner.arrangement.memberIds.flatMap(memberId => {
        const copyId = mapping.get(memberId)
        return copyId && api.getNode(copyId)?.transformParent?.nodeId === id
          ? [memberId, copyId] : [memberId]
      })
      if (memberIds.length !== owner.arrangement.memberIds.length) api.setNodeProperty(id, 'arrangement', { ...owner.arrangement, memberIds })
    }
    remapFlowConnections(api, mapping)
  }, UNDOABLE_GESTURE_ORIGIN)
  return copies
}
