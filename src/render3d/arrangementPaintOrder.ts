// SPDX-License-Identifier: Apache-2.0
import type { Node, NodeId } from '@/scene/types'
import type { Plane3D } from './scene3d'

/** Sort whole arrangement members, retaining each card's internal paint stack. */
export function sortArrangementPlanes(planes: Plane3D[], nodes: ReadonlyMap<NodeId, Node>): Plane3D[] {
  const memberOwners = new Map<NodeId, NodeId>()
  for (const node of nodes.values()) {
    if (node.kind !== 'arrangement' || !node.arrangement) continue
    for (const id of node.arrangement.memberIds) {
      if (nodes.get(id)?.transformParent?.nodeId === node.id) memberOwners.set(id, node.id)
    }
  }
  if (!memberOwners.size) return planes
  const groups = new Map<NodeId, Map<NodeId, Plane3D[]>>()
  for (const plane of planes) {
    if (plane.alwaysOnTop) continue
    let node: Node | undefined = plane.node
    const visited = new Set<NodeId>()
    while (node && !visited.has(node.id)) {
      visited.add(node.id)
      const owner = memberOwners.get(node.id)
      if (owner) {
        let members = groups.get(owner)
        if (!members) groups.set(owner, members = new Map())
        let stack = members.get(node.id)
        if (!stack) members.set(node.id, stack = [])
        stack.push(plane)
        break
      }
      node = node.parent ? nodes.get(node.parent) : undefined
    }
  }
  const result = [...planes]
  for (const members of groups.values()) {
    if (members.size < 2) continue
    const stacks = [...members.entries()].map(([id, stack]) => ({
      stack: stack.sort((a, b) => a.paintOrder - b.paintOrder),
      depth: (stack.find(plane => plane.nodeId === id) ?? stack[0]!).cameraDepth,
    }))
    // Preserve authored order for coplanar cards; far cards paint first.
    stacks.sort((a, b) => Math.abs(a.depth - b.depth) > 1e-6
      ? b.depth - a.depth : a.stack[0]!.paintOrder - b.stack[0]!.paintOrder)
    const ids = new Set(stacks.flatMap(item => item.stack.map(plane => plane.nodeId)))
    const slots = planes.flatMap((plane, index) => ids.has(plane.nodeId) ? [index] : [])
    const sorted = stacks.flatMap(item => item.stack)
    slots.forEach((index, rank) => {
      result[index] = { ...sorted[rank]!, paintOrder: planes[index]!.paintOrder }
    })
  }
  return result
}
