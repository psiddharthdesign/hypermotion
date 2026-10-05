import { remapFlowConnections } from '@/scene/flowConnection'
// SPDX-License-Identifier: Apache-2.0
import { Matrix4 } from 'three'
import type { SceneAPI, Node, NodeId } from '@/scene'
import type { AnimatedValue } from '@/anim/engine'
import type { SolvedLayout } from '@/layout'
import { animatedArrangement, defaultArrangement, type ArrangementMode } from './arrangement'
import { createNullResolver, setNullParent } from './nullObject'
import { buildWorldPlanes, resolveCamera3D } from '@/render3d/scene3d'
import { UNDOABLE_GESTURE_ORIGIN } from './undo'

/** Repair older duplicates that copied a controller link but omitted its slot. */
export function repairArrangementMembership(api: SceneAPI): number {
  const rootOf = (id: string): string | null => {
    const seen = new Set<string>()
    let node = api.getNode(id)
    while (node && !seen.has(node.id)) {
      seen.add(node.id)
      if (!node.parent) return node.id
      node = api.getNode(node.parent)
    }
    return null
  }
  const additions = new Map<string, string[]>()
  for (const id of api.getAllNodeIds()) {
    const member = api.getNode(id)
    if (!member?.transformParent || ['arrangement', 'null', 'camera', 'audio'].includes(member.kind)) continue
    const owner = api.getNode(member.transformParent.nodeId)
    if (owner?.kind !== 'arrangement' || !owner.arrangement || owner.arrangement.memberIds.includes(id)) continue
    if (rootOf(id) !== rootOf(owner.id)) continue
    const list = additions.get(owner.id) ?? []
    list.push(id)
    additions.set(owner.id, list)
  }
  let count = 0
  if (additions.size) api.doc.transact(() => {
    for (const [id, memberIds] of additions) {
      const owner = api.getNode(id)!
      api.setNodeProperty(id, 'arrangement', { ...owner.arrangement!, memberIds: [...owner.arrangement!.memberIds, ...memberIds] })
      count += memberIds.length
    }
  }, 'arrangement-membership-repair')
  return count
}

export function arrangementMemberCandidates(api: SceneAPI, memberIds: readonly string[] = []): Node[] {
  const eligibleNodes = eligible(api, api.getAllNodeIds().filter((id) => id !== api.getRoot()), false)
  const related = (first: string, second: string) => {
    const seen = new Set<string>()
    let current: string | null = first
    while (current && !seen.has(current)) {
      if (current === second) return true
      seen.add(current)
      current = api.getNode(current)?.parent ?? null
    }
    return false
  }
  return eligibleNodes.filter((node) => !memberIds.some((id) => related(node.id, id) || related(id, node.id)))
}
function eligible(api: SceneAPI, ids: NodeId[], excludeDescendants = true): Node[] {
  const all = new Set(ids)
  return [...all].flatMap((id) => {
    const node = api.getNode(id)
    if (!node || node.locked || (node.kind === 'vector' && !!node.connection) || node.id === api.getRoot() || ['null', 'arrangement', 'camera', 'audio'].includes(node.kind)) return []
    let parent = node.parent
    const seen = new Set<string>()
    while (parent && !seen.has(parent)) {
      if (excludeDescendants && all.has(parent)) return []
      seen.add(parent)
      if (parent === api.getRoot()) return [node]
      parent = api.getNode(parent)?.parent ?? null
    }
    return []
  })
}
export function addArrangementMembers(api: SceneAPI, controllerId: string, ids: string[], layout: SolvedLayout, animated: Record<string, AnimatedValue> = {}): void {
  const controller = api.getNode(controllerId)
  if (controller?.kind !== 'arrangement' || !controller.arrangement || controller.locked) return
  const candidates = new Set(arrangementMemberCandidates(api, controller.arrangement.memberIds).map((node) => node.id))
  const members = eligible(api, ids).filter((n) => candidates.has(n.id) && layout[n.id])
  if (!members.length) return
  const camera = api.getActiveCamera()
  if (!camera) return
  const resolver = createNullResolver((id) => api.getNode(id), animated)
  const world = resolver.world(controller)
  if (Math.abs(world.determinant()) < 1e-10) throw new Error('Give the arrangement a nonzero scale before adding layers.')
  const offsets = new Map(members.map((node) => [node.id, resolver.delta(node).toArray()]))
  api.doc.transact(() => {
    // Expose each member as an independent render plane while preserving its current pose.
    for (const node of members) {
      api.setNodeProperty(node.id, 'transformOffset', offsets.get(node.id)!)
      api.setNodeProperty(node.id, 'transformParent', { nodeId: controllerId, inverseBind: world.clone().invert().toArray() })
    }
    const clean = Object.fromEntries(Object.entries(animated).map(([id, value]) => { const copy = { ...value }; delete copy.parentMatrix; return [id, copy] }))
    const planes = buildWorldPlanes(api, layout, clean, resolveCamera3D(camera, animated[camera.id], api.getMeta().canvas))
    const added: string[] = []
    for (const node of members) {
      const plane = planes.find((p) => p.nodeId === node.id)
      if (!plane) {
        api.setNodeProperty(node.id, 'transformParent', node.transformParent ?? null)
        api.setNodeProperty(node.id, 'transformOffset', node.transformOffset ?? null)
        continue
      }
      api.setNodeProperty(node.id, 'transformParent', { nodeId: controllerId, inverseBind: new Matrix4().makeTranslation(-plane.center.x, -plane.center.y, -plane.center.z).toArray() })
      const old = node.transformParent && api.getNode(node.transformParent.nodeId)
      if (old?.arrangement) api.setNodeProperty(old.id, 'arrangement', { ...old.arrangement, memberIds: old.arrangement.memberIds.filter((id) => id !== node.id) })
      added.push(node.id)
    }
    api.setNodeProperty(controllerId, 'arrangement', { ...controller.arrangement!, memberIds: [...controller.arrangement!.memberIds, ...added] })
  }, UNDOABLE_GESTURE_ORIGIN)
}
/** Real, editable members; fixed placement is controlled by the arrangement. */
export function addArrangementBlueSquares(api: SceneAPI, controllerId: string): string[] {
  const controller = api.getNode(controllerId)
  const root = api.getRoot()
  if (!root || controller?.kind !== 'arrangement' || !controller.arrangement || controller.locked) return []
  const size = Math.max(16, Math.min(64, Math.floor(Math.min(api.getMeta().canvas.width, api.getMeta().canvas.height) / 8 / 8) * 8))
  const members: string[] = []
  api.doc.transact(() => {
    for (let index = 0; index < 9; index++) {
      members.push(api.createNode('rect', root, {
        name: `Blue square ${controller.arrangement!.memberIds.length + index + 1}`,
        position: 'absolute', size: { width: size, height: size },
        appearance: { opacity: 1, fill: { kind: 'solid', color: '#3B82F6' }, stroke: null, cornerRadius: 0, effects: [] },
        transformParent: { nodeId: controllerId, inverseBind: new Matrix4().makeTranslation(-size / 2, -size / 2, 0).toArray() },
      }))
    }
    api.setNodeProperty(controllerId, 'arrangement', { ...controller.arrangement!, memberIds: [...controller.arrangement!.memberIds, ...members] })
  }, UNDOABLE_GESTURE_ORIGIN)
  return members
}
export function createArrangement(api: SceneAPI, ids: string[], layout: SolvedLayout, animated: Record<string, AnimatedValue> = {}, mode: ArrangementMode = 'rectangular'): string | null {
  const root = api.getRoot()
  if (!root) return null
  let id = ''
  api.doc.transact(() => {
    const canvas = api.getMeta().canvas
    id = api.createNode('arrangement', root, { name: 'Advanced layout', arrangement: defaultArrangement(mode), transform: { x: canvas.width / 2, y: canvas.height / 2, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 } })
    addArrangementMembers(api, id, ids, layout, animated)
    if (!api.getNode(id)!.arrangement!.memberIds.length) {
      const spacing = Math.max(32, Math.min(104, Math.floor(Math.min(canvas.width, canvas.height) / 4 / 8) * 8))
      api.setNodeProperty(id, 'arrangement', { ...defaultArrangement(mode), spacingX: spacing, spacingY: spacing, radius: spacing * 1.5 })
      addArrangementBlueSquares(api, id)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
  return id
}
function planeMatrix(api: SceneAPI, id: string, layout: SolvedLayout, animated: Record<string, AnimatedValue>): Matrix4 | null {
  const camera = api.getActiveCamera()
  if (!camera) return null
  const clean = Object.fromEntries(Object.entries(animated).map(([key, value]) => { const copy = { ...value }; delete copy.parentMatrix; return [key, copy] }))
  const plane = buildWorldPlanes(api, layout, clean, resolveCamera3D(camera, animated[camera.id], api.getMeta().canvas)).find((item) => item.nodeId === id)
  return plane?.transformMatrix ? new Matrix4().fromArray(plane.transformMatrix) : null
}
export function removeArrangementMember(api: SceneAPI, controllerId: string, memberId: string, animated: Record<string, AnimatedValue> = {}, layout?: SolvedLayout): void {
  const controller = api.getNode(controllerId), node = api.getNode(memberId)
  if (!controller?.arrangement || controller.locked || node?.locked) return
  api.doc.transact(() => {
    if (node?.transformParent?.nodeId === controllerId) {
      const pose = layout ? planeMatrix(api, memberId, layout, animated) : null
      const opacity = animatedArrangement(controller.arrangement!, animated[controllerId]?.arrangement).opacity
      api.setNodeProperty(node.id, 'appearance', { ...node.appearance, opacity: node.appearance.opacity * opacity })
      for (const track of api.getTracksForNode(node.id)) if (track.propertyId === 'appearance.opacity') api.setTrack({ ...track, keyframes: track.keyframes.map((k) => ({ ...k, value: typeof k.value === 'number' ? k.value * opacity : k.value })) })
      setNullParent(api, memberId, null, animated)
      // Camera-facing planes are resolved against the active camera after placement.
      // Bake the final affine pose on detach, while retaining each authored track.
      if (pose && layout) {
        const offset = api.getNode(memberId)!.transformOffset
        api.setNodeProperty(memberId, 'transformOffset', new Matrix4().toArray())
        const base = planeMatrix(api, memberId, layout, animated)
        api.setNodeProperty(memberId, 'transformOffset', base && Math.abs(base.determinant()) > 1e-10
          ? pose.multiply(base.invert()).toArray() : offset ?? null)
      }
    }
    api.setNodeProperty(controllerId, 'arrangement', { ...controller.arrangement!, memberIds: controller.arrangement!.memberIds.filter((id) => id !== memberId) })
  }, UNDOABLE_GESTURE_ORIGIN)
}
export function dissolveArrangement(api: SceneAPI, id: string, animated: Record<string, AnimatedValue> = {}, layout?: SolvedLayout): void {
  const node = api.getNode(id)
  if (!node?.arrangement || node.locked || node.arrangement.memberIds.some((key) => api.getNode(key)?.locked)) return
  // Capture all matrices before removing any member; removal would otherwise compact the pattern.
  const resolver = createNullResolver((key) => api.getNode(key), animated)
  const poses = new Map(node.arrangement.memberIds.map((key) => {
    const member = api.getNode(key)
    return [key, { delta: member ? resolver.delta(member).toArray() : null, world: layout ? planeMatrix(api, key, layout, animated) : null }]
  }))
  api.doc.transact(() => {
    for (const memberId of node.arrangement!.memberIds) {
      removeArrangementMember(api, id, memberId, animated, layout)
      const pose = poses.get(memberId)
      if (!api.getNode(memberId) || !pose) continue
      if (pose.world && layout) {
        api.setNodeProperty(memberId, 'transformOffset', new Matrix4().toArray())
        const base = planeMatrix(api, memberId, layout, animated)
        if (base && Math.abs(base.determinant()) > 1e-10) api.setNodeProperty(memberId, 'transformOffset', pose.world.multiply(base.invert()).toArray())
        else api.setNodeProperty(memberId, 'transformOffset', pose.delta)
      } else api.setNodeProperty(memberId, 'transformOffset', pose.delta)
    }
    api.deleteNode(id)
  }, UNDOABLE_GESTURE_ORIGIN)
}
export function duplicateArrangement(api: SceneAPI, id: string): string | null {
  const source = api.getNode(id)
  if (!source?.arrangement) return null
  let result = ''
  api.doc.transact(() => {
    const map = new Map<string, string>()
    const clone = (node: Node, parent: string | null): string => {
      const copy = api.createNode(node.kind, parent, { ...node, name: `${node.name} copy` })
      map.set(node.id, copy)
      for (const track of api.getTracksForNode(node.id)) api.setTrack({ ...track, id: crypto.randomUUID(), nodeId: copy, keyframes: track.keyframes.map((k) => ({ ...k, id: crypto.randomUUID() })) })
      for (const child of api.getChildren(node.id)) clone(child, copy)
      return copy
    }
    result = clone(source, source.parent)
    for (const memberId of source.arrangement!.memberIds) { const member = api.getNode(memberId); if (member && !map.has(memberId)) clone(member, member.parent) }
    for (const [originalId, copyId] of map) {
      const original = api.getNode(originalId)!
      if (original.transformParent) api.setNodeProperty(copyId, 'transformParent', { ...original.transformParent, nodeId: map.get(original.transformParent.nodeId) ?? original.transformParent.nodeId })
    }
    remapFlowConnections(api, map)
    api.setNodeProperty(result, 'arrangement', { ...source.arrangement!, memberIds: source.arrangement!.memberIds.flatMap((key) => map.has(key) ? [map.get(key)!] : []) })
  }, UNDOABLE_GESTURE_ORIGIN)
  return result
}
