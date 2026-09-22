// SPDX-License-Identifier: Apache-2.0

import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { AnimatedValue } from '@/anim/engine'
import type { SceneAPI } from '@/scene/doc'
import type { Node, NodeId, TransformParent } from '@/scene/types'
import { resolveCameraPose } from '@/render3d/cameraPose'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export function normalizeTransformMatrix(value: unknown): number[] | null {
  return Array.isArray(value) && value.length === 16 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? [...value] : null
}

export function normalizeTransformParent(value: unknown): TransformParent | null {
  if (!value || typeof value !== 'object') return null
  const link = value as Partial<TransformParent>
  const inverseBind = normalizeTransformMatrix(link.inverseBind)
  return typeof link.nodeId === 'string' && inverseBind ? { nodeId: link.nodeId, inverseBind } : null
}

export function hasNullTransform(node: Node): boolean {
  return !!(node.transformParent || node.transformOffset)
}

/** Nulls use scene coordinates and a point pivot; they consume no layout space. */
export function createNullResolver(
  getNode: (id: NodeId) => Node | null | undefined,
  animated: Record<NodeId, AnimatedValue> = {},
) {
  const cache = new Map<NodeId, Matrix4>()
  const visiting = new Set<NodeId>()
  const delta = (node: Node): Matrix4 => {
    const offset = new Matrix4()
    if (node.transformOffset) offset.fromArray(node.transformOffset)
    const link = node.transformParent
    const parent = link ? getNode(link.nodeId) : null
    if (!link || parent?.kind !== 'null' || visiting.has(parent.id)) return offset
    return world(parent).clone().multiply(new Matrix4().fromArray(link.inverseBind)).multiply(offset)
  }
  const world = (node: Node): Matrix4 => {
    const cached = cache.get(node.id)
    if (cached) return cached
    visiting.add(node.id)
    const a = animated[node.id]
    const t = node.transform
    const radians = Math.PI / 180
    const local = new Matrix4().compose(
      new Vector3(a?.x ?? t.x, a?.y ?? t.y, a?.z ?? t.z),
      new Quaternion().setFromEuler(new Euler(
        (a?.rotationX ?? t.rotationX) * radians,
        (a?.rotationY ?? t.rotationY) * radians,
        (a?.rotation ?? t.rotation) * radians,
        'ZYX',
      )),
      new Vector3(a?.scaleX ?? t.scaleX, a?.scaleY ?? t.scaleY, 1),
    )
    const result = delta(node).multiply(local)
    visiting.delete(node.id)
    cache.set(node.id, result)
    return result
  }
  return { delta, world }
}

export function canParentToNull(api: SceneAPI, nodeId: NodeId, nullId: NodeId): boolean {
  const node = api.getNode(nodeId)
  const target = api.getNode(nullId)
  if (!node || node.locked || node.id === api.getRoot() || node.kind === 'audio' || target?.kind !== 'null') return false
  // Controllers belong to the active composition, never a different scene or component.
  if (target.parent !== api.getRoot()) return false
  const seen = new Set<NodeId>([nodeId])
  let current: Node | null = target
  while (current) {
    if (seen.has(current.id)) return false
    seen.add(current.id)
    current = current.transformParent ? api.getNode(current.transformParent.nodeId) : null
  }
  return true
}

/** Preserve the complete animated pose and existing keyframes at the connection time. */
export function setNullParent(
  api: SceneAPI, nodeId: NodeId, nullId: NodeId | null,
  animated: Record<NodeId, AnimatedValue> = {},
): boolean {
  const node = api.getNode(nodeId)
  if (!node || node.locked || (nullId && !canParentToNull(api, nodeId, nullId))) return false
  if ((node.transformParent?.nodeId ?? null) === nullId) return true
  const resolver = createNullResolver((id) => api.getNode(id), animated)
  const offset = resolver.delta(node).toArray()
  const parentWorld = nullId ? resolver.world(api.getNode(nullId)!) : null
  // An inverse cannot preserve the pose while a controller has zero scale.
  if (parentWorld && Math.abs(parentWorld.determinant()) < 1e-10) return false
  api.doc.transact(() => {
    if (nullId) makeNullCameraFree(api, nodeId, animated[nodeId])
    api.setNodeProperty(nodeId, 'transformOffset', offset)
    api.setNodeProperty(nodeId, 'transformParent', parentWorld && nullId
      ? { nodeId: nullId, inverseBind: parentWorld.clone().invert().toArray() } : null)
  }, UNDOABLE_GESTURE_ORIGIN)
  return true
}

export function detachNullDependents(api: SceneAPI, nullId: NodeId, animated: Record<NodeId, AnimatedValue> = {}): void {
  const resolver = createNullResolver((id) => api.getNode(id), animated)
  const dependents = api.getAllNodeIds().flatMap((id) => {
    const node = api.getNode(id)
    return node?.transformParent?.nodeId === nullId ? [{ node, offset: resolver.delta(node).toArray() }] : []
  })
  for (const { node, offset } of dependents) {
    api.setNodeProperty(node.id, 'transformOffset', offset)
    api.setNodeProperty(node.id, 'transformParent', null)
  }
}

export function addNull(api: SceneAPI): NodeId | null {
  const root = api.getRoot()
  if (!root) return null
  const names = new Set(api.getAllNodeIds().map((id) => api.getNode(id)?.name))
  let index = 1
  while (names.has(`Null ${index}`)) index++
  const canvas = api.getMeta().canvas
  let id: NodeId = ''
  api.doc.transact(() => {
    id = api.createNode('null', root, {
      name: `Null ${index}`, position: 'absolute',
      transform: { z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1, x: canvas.width / 2, y: canvas.height / 2 },
    })
  }, UNDOABLE_GESTURE_ORIGIN)
  return id
}

/** Called after keyframes and motion paths, shared by preview and export. */
export function applyNullTransforms(
  api: SceneAPI, animated: Record<NodeId, AnimatedValue>, compiledNodes?: ReadonlyMap<NodeId, Node>,
): void {
  const nodes = compiledNodes ?? new Map(api.getAllNodeIds().flatMap((id) => {
    const node = api.getNode(id)
    return node ? [[id, node] as const] : []
  }))
  const resolver = createNullResolver((id) => nodes.get(id), animated)
  for (const [id, node] of nodes) {
    if (!hasNullTransform(node)) continue
    animated[id] = { ...animated[id], parentMatrix: resolver.delta(node).toArray() }
  }
}

/** Convert the camera target/dolly coordinates to eye coordinates at the bind pose.
 * Translation keys move by the same constant; ids, timing and easing are retained.
 * Once free, disconnecting a camera keeps its own-pivot rotation semantics.
 */
export function makeNullCameraFree(api: SceneAPI, id: NodeId, animated?: AnimatedValue): void {
  const camera = api.getNode(id)
  if (camera?.kind !== 'camera' || camera.positionMode === 'free') return
  const pose = resolveCameraPose(camera, animated, api.getMeta().canvas)
  const offset = {
    x: pose.position.x - (animated?.x ?? camera.transform.x),
    y: pose.position.y - (animated?.y ?? camera.transform.y),
    z: pose.position.z - (animated?.z ?? camera.transform.z),
  }
  api.setNodeProperty(id, 'positionMode', 'free')
  api.setNodeProperty(id, 'transform', { ...camera.transform,
    x: camera.transform.x + offset.x, y: camera.transform.y + offset.y, z: camera.transform.z + offset.z,
  })
  for (const track of api.getTracksForNode(id)) {
    const key = track.propertyId.slice('transform.'.length)
    if (!track.propertyId.startsWith('transform.') || (key !== 'x' && key !== 'y' && key !== 'z')) continue
    api.setTrack({ ...track, keyframes: track.keyframes.map(k => ({ ...k, value: typeof k.value === 'number' ? k.value + offset[key] : k.value })) })
  }
}

/** Upgrade earlier Null-connected cameras once, including scene activation/import. */
export function migrateNullCameras(api: SceneAPI): void {
  const cameras = api.getAllNodeIds().filter(id => {
    const node = api.getNode(id)
    return node?.kind === 'camera' && hasNullTransform(node) && node.positionMode !== 'free'
  })
  if (!cameras.length) return
  api.doc.transact(() => { for (const id of cameras) makeNullCameraFree(api, id) }, 'migration')
}

/** Move the controller pivot to the camera eye without moving any connected object. */
export function alignNullToCamera(
  api: SceneAPI, cameraId: NodeId, animated: Record<NodeId, AnimatedValue> = {},
): { id: NodeId; patch: { x: number; y: number; z: number } } | null {
  const camera = api.getNode(cameraId)
  const controller = camera?.transformParent ? api.getNode(camera.transformParent.nodeId) : null
  if (camera?.kind !== 'camera' || camera.positionMode !== 'free' || camera.locked || controller?.kind !== 'null' || controller.locked) return null
  const resolver = createNullResolver(id => api.getNode(id), animated)
  const delta = resolver.delta(controller)
  const world = resolver.world(controller)
  if (Math.abs(delta.determinant()) < 1e-10 || Math.abs(world.determinant()) < 1e-10) return null
  const eye = resolveCameraPose(camera, animated[cameraId], api.getMeta().canvas).position
  const local = new Vector3(eye.x, eye.y, eye.z).applyMatrix4(resolver.delta(camera)).applyMatrix4(delta.clone().invert())
  const patch = { x: local.x, y: local.y, z: local.z }
  const dependents = api.getAllNodeIds().flatMap(id => {
    const node = api.getNode(id)
    return node?.transformParent?.nodeId === controller.id ? [{ id, offset: resolver.delta(node).toArray() }] : []
  })
  api.doc.transact(() => {
    api.setNodeProperty(controller.id, 'transform', { ...controller.transform, ...patch })
    const updated = { ...animated, [controller.id]: { ...animated[controller.id], ...patch } }
    const inverseBind = createNullResolver(id => api.getNode(id), updated).world(api.getNode(controller.id)!).invert().toArray()
    for (const child of dependents) {
      api.setNodeProperty(child.id, 'transformOffset', child.offset)
      api.setNodeProperty(child.id, 'transformParent', { nodeId: controller.id, inverseBind })
    }
  }, UNDOABLE_GESTURE_ORIGIN)
  return { id: controller.id, patch }
}

/** Restore authored transforms and use the parent's current pose as the new bind.
 * This intentionally clears retained translation, rotation and scale, while
 * keeping the connection and every authored property/keyframe intact.
 */
export function resetNullConnectionOffset(
  api: SceneAPI, nodeId: NodeId, animated: Record<NodeId, AnimatedValue> = {},
): boolean {
  const node = api.getNode(nodeId)
  if (!node || node.locked || !hasNullTransform(node)) return false
  const parent = node.transformParent ? api.getNode(node.transformParent.nodeId) : null
  const world = parent?.kind === 'null' ? createNullResolver(id => api.getNode(id), animated).world(parent) : null
  if (world && Math.abs(world.determinant()) < 1e-10) return false
  api.doc.transact(() => {
    api.setNodeProperty(nodeId, 'transformOffset', null)
    api.setNodeProperty(nodeId, 'transformParent', world && parent
      ? { nodeId: parent.id, inverseBind: world.clone().invert().toArray() } : null)
  }, UNDOABLE_GESTURE_ORIGIN)
  return true
}
