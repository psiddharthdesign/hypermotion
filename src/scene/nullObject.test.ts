// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Matrix4, Object3D, Vector3 } from 'three'
import { getProjectAPI } from '@/project/doc'
import { createSceneAPI, snapshotScene } from '@/scene/doc'
import { applyBytesToScene, applyJsonToScene, sceneToBytes } from '@/scene/file'
import { addNull, applyNullTransforms, canParentToNull, createNullResolver, detachNullDependents, resetNullConnectionOffset, setNullParent } from '@/scene/nullObject'
import { buildWorldPlanes, resolveCamera3D } from '@/render3d/scene3d'
import { applyNullPlaneMatrix } from '@/render3d/nullPlaneMatrix'
import { solveLayout, yogaReady } from '@/layout/engine'
import { getAnimEngine, type AnimatedValue } from '@/anim'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const layer = api.createNode('rect', root, { size: { width: 80, height: 40 } })
  const controller = addNull(api)!
  const camera = api.getActiveCamera()!
  return { api, root, layer, controller, camera }
}

function move(api: ReturnType<typeof createSceneAPI>, id: string, patch: Partial<NonNullable<ReturnType<typeof api.getNode>>['transform']>) {
  api.setNodeProperty(id, 'transform', { ...api.getNode(id)!.transform, ...patch })
}

function matrix(api: ReturnType<typeof createSceneAPI>, id: string, animated = {}) {
  return createNullResolver((key) => api.getNode(key), animated).delta(api.getNode(id)!)
}

function expectMatrix(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index]!, 8))
}

afterEach(() => getAnimEngine().pause())

describe('Null controllers', () => {
  it('does not consume auto-layout slots or paint, even with authored appearance', async () => {
    const { api, root, layer, controller, camera } = setup()
    const yoga = await yogaReady
    const withNull = solveLayout(yoga, api, root, { width: 960, height: 540 })
    expect(withNull[controller]).toBeUndefined()
    const planes = buildWorldPlanes(api, withNull, {}, resolveCamera3D(camera, undefined, api.getMeta().canvas))
    expect(planes.map((plane) => plane.nodeId)).not.toContain(controller)
    api.deleteNode(controller)
    expect(solveLayout(yoga, api, root, { width: 960, height: 540 })[layer]).toEqual(withNull[layer])
  })

  it('preserves the pose on connect, reconnect and disconnect, including animated Nulls', () => {
    const { api, layer, controller } = setup()
    const second = addNull(api)!
    const animated = { [controller]: { x: 730, rotation: 30, scaleX: 2 }, [second]: { y: 200, rotationY: 40 } }
    expect(setNullParent(api, layer, controller, animated)).toBe(true)
    expectMatrix(matrix(api, layer, animated), new Matrix4())
    const moved = { ...animated, [controller]: { x: 820, rotation: 60, scaleX: 3 } }
    const before = matrix(api, layer, moved)
    expect(setNullParent(api, layer, second, moved)).toBe(true)
    expectMatrix(matrix(api, layer, moved), before)
    expect(setNullParent(api, layer, null, moved)).toBe(true)
    expectMatrix(matrix(api, layer, moved), before)
    expect(api.getNode(layer)!.parent).toBe(api.getRoot())
  })

  it('rejects cycles, invalid targets and singular controllers', () => {
    const { api, root, layer, controller } = setup()
    const second = addNull(api)!
    expect(setNullParent(api, second, controller)).toBe(true)
    expect(canParentToNull(api, controller, second)).toBe(false)
    expect(canParentToNull(api, controller, controller)).toBe(false)
    expect(canParentToNull(api, root, controller)).toBe(false)
    expect(setNullParent(api, layer, layer)).toBe(false)
    move(api, controller, { scaleX: 0 })
    expect(setNullParent(api, layer, controller)).toBe(false)
    expect(api.getNode(layer)!.transformParent).toBeNull()
  })

  it('composes chained Nulls and remains safe for malformed cycles', () => {
    const { api, layer, controller } = setup()
    const second = addNull(api)!
    setNullParent(api, second, controller)
    setNullParent(api, layer, second)
    move(api, controller, { x: 580 })
    const point = new Vector3(100, 200, 0).applyMatrix4(matrix(api, layer))
    expect(point.x).toBeCloseTo(200)
    const link = { nodeId: second, inverseBind: new Matrix4().toArray() }
    api.setNodeProperty(controller, 'transformParent', link)
    expect(matrix(api, layer).elements.every(Number.isFinite)).toBe(true)
  })

  it('moves nested layers as independent planes and applies exact matrices to GPU objects', () => {
    const { api, root, layer, controller, camera } = setup()
    const parent = api.createNode('frame', root, { size: { width: 300, height: 200 }, clipsContent: false })
    const nested = api.createNode('rect', parent, { size: { width: 80, height: 40 } })
    const layout = {
      [root]: { x: 0, y: 0, width: 960, height: 540 },
      [layer]: { x: 0, y: 0, width: 80, height: 40 },
      [parent]: { x: 100, y: 100, width: 300, height: 200 },
      [nested]: { x: 120, y: 120, width: 80, height: 40 },
    }
    setNullParent(api, nested, controller)
    move(api, controller, { rotation: 90, scaleX: 2, z: 100 })
    const planes = buildWorldPlanes(api, layout, {}, resolveCamera3D(camera, undefined, api.getMeta().canvas))
    const plane = planes.find((entry) => entry.nodeId === nested)!
    expect(plane).toBeDefined()
    const expected = new Vector3(160, 140, 0).applyMatrix4(matrix(api, nested))
    expect(plane.center.x).toBeCloseTo(expected.x)
    expect(plane.center.y).toBeCloseTo(expected.y)
    expect(plane.center.z).toBeCloseTo(100)
    const object = new Object3D()
    expect(applyNullPlaneMatrix(object, plane)).toBe(true)
    object.updateMatrixWorld(true)
    const right = new Vector3(1, 0, 0).applyMatrix4(object.matrixWorld).sub(new Vector3().applyMatrix4(object.matrixWorld))
    expect(right.x).toBeCloseTo(0)
    expect(right.y).toBeCloseTo(2)
  })

  it('applies camera rig translation, orbit and roll in world space', () => {
    const { api, camera, controller } = setup()
    setNullParent(api, camera.id, controller)
    const viewport = api.getMeta().canvas
    const before = resolveCamera3D(camera, undefined, viewport)
    move(api, controller, { x: 580, rotationY: 30, rotation: 20 })
    const animated: Record<string, AnimatedValue> = {}
    applyNullTransforms(api, animated)
    const after = resolveCamera3D(api.getNode(camera.id) as typeof camera, animated[camera.id], viewport)
    const delta = matrix(api, camera.id)
    const expected = new Vector3(before.position.x, before.position.y, before.position.z).applyMatrix4(delta)
    expect(after.position.x).toBeCloseTo(expected.x)
    expect(after.position.y).toBeCloseTo(expected.y)
    expect(after.position.z).toBeCloseTo(expected.z)
    expect(after.rigDown).toBeDefined()
    expect(api.getNode(camera.id)!.parent).toBeNull()
  })

  it('evaluates Null keyframes before its connected camera and layer', () => {
    const { api, layer, camera, controller } = setup()
    setNullParent(api, layer, controller)
    setNullParent(api, camera.id, controller)
    api.setTrack({ id: 'null-x', nodeId: controller, propertyId: 'transform.x', defaultEasing: 'linear', keyframes: [
      { id: 'a', time: 0, value: 480 }, { id: 'b', time: 1, value: 680 },
    ] })
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.5)
    expect(engine.getSnapshot()[layer]!.parentMatrix![12]).toBeCloseTo(100)
    expect(engine.getSnapshot()[camera.id]!.parentMatrix![12]).toBeCloseTo(100)
  })

  it('deletes only the controller, preserves its dependents, and undoes the entire gesture', () => {
    const { api, layer, camera, controller } = setup()
    setNullParent(api, layer, controller)
    setNullParent(api, camera.id, controller)
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    const animated = { [controller]: { x: 600, rotation: 45 } }
    const before = matrix(api, layer, animated)
    api.doc.transact(() => {
      detachNullDependents(api, controller, animated)
      api.deleteNode(controller)
    }, UNDOABLE_GESTURE_ORIGIN)
    expect(api.getNode(controller)).toBeNull()
    expect(api.getNode(layer)!.transformParent).toBeNull()
    expect(api.getNode(camera.id)).not.toBeNull()
    expectMatrix(matrix(api, layer), before)
    undo.undo()
    expect(api.getNode(controller)!.kind).toBe('null')
    expect(api.getNode(layer)!.transformParent?.nodeId).toBe(controller)
    undo.destroy()
  })

  it('duplicates scene rigs with independent controller references', () => {
    const { api, layer, controller, camera } = setup()
    const project = getProjectAPI(api)
    project.ensureInitialized()
    setNullParent(api, layer, controller)
    setNullParent(api, camera.id, controller)
    const source = project.getActiveScene()!
    const copy = project.duplicateScene(source.id)!
    const copiedNull = api.getChildren(copy.rootNodeId).find((node) => node.kind === 'null')!
    const copiedLayer = api.getChildren(copy.rootNodeId).find((node) => node.kind === 'rect')!
    expect(copiedNull.id).not.toBe(controller)
    expect(copiedLayer.transformParent?.nodeId).toBe(copiedNull.id)
    expect(api.getNode(copy.cameraIds[0]!)!.transformParent?.nodeId).toBe(copiedNull.id)
    move(api, copiedNull.id, { x: 580 })
    expect(matrix(api, copiedLayer.id).elements[12]).toBeCloseTo(100)
    expectMatrix(matrix(api, layer), new Matrix4())
  })

  it('round trips binary and JSON files, remapping connection references', () => {
    const { api, layer, camera, controller } = setup()
    setNullParent(api, layer, controller)
    setNullParent(api, camera.id, controller)
    move(api, controller, { x: 550 })
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    const restored = createSceneAPI(doc)
    expect(restored.getNode(layer)!.transformParent?.nodeId).toBe(controller)
    const jsonRestored = applyJsonToScene(new Y.Doc(), snapshotScene(api))
    const nullNode = jsonRestored.getAllNodeIds().map((id) => jsonRestored.getNode(id)!).find((node) => node.kind === 'null')!
    const rect = jsonRestored.getAllNodeIds().map((id) => jsonRestored.getNode(id)!).find((node) => node.kind === 'rect')!
    expect(rect.transformParent?.nodeId).toBe(nullNode.id)
    expectMatrix(matrix(jsonRestored, rect.id), matrix(api, layer))
  })
})


describe('reset retained Null connection offsets', () => {
  it('clears a bind-time rotation that remains when both displayed rotations are zero', () => {
    const { api, controller, layer } = setup()
    move(api, controller, { rotationX: 24 })
    setNullParent(api, layer, controller)
    move(api, controller, { rotationX: 0 })
    const authored = api.getNode(layer)!.transform
    expect(matrix(api, layer).elements[6]).not.toBeCloseTo(0)
    expect(resetNullConnectionOffset(api, layer)).toBe(true)
    expectMatrix(matrix(api, layer), new Matrix4())
    expect(api.getNode(layer)!.transformParent?.nodeId).toBe(controller)
    expect(api.getNode(layer)!.transform).toEqual(authored)
    move(api, controller, { x: 580 })
    expect(matrix(api, layer).elements[12]).toBeCloseTo(100)
  })

  it('rebases at the current animated parent pose and is undoable', () => {
    const { api, controller, layer } = setup()
    setNullParent(api, layer, controller)
    const animated = { [controller]: { rotationX: 24, x: 600 } }
    const before = matrix(api, layer, animated)
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    expect(resetNullConnectionOffset(api, layer, animated)).toBe(true)
    expectMatrix(matrix(api, layer, animated), new Matrix4())
    undo.undo()
    expectMatrix(matrix(api, layer, animated), before)
    undo.destroy()
  })

  it('refuses to reset a singular or locked connection', () => {
    const { api, controller, layer } = setup()
    setNullParent(api, layer, controller)
    move(api, controller, { scaleX: 0 })
    expect(resetNullConnectionOffset(api, layer)).toBe(false)
    move(api, controller, { scaleX: 1 })
    api.setNodeProperty(layer, 'locked', true)
    expect(resetNullConnectionOffset(api, layer)).toBe(false)
  })
})


it('uses the offset Null pivot for controller rotation and the Card anchor for its own rotation', () => {
  const { api, root, layer, controller, camera } = setup()
  const layout = {
    [root]: { x: 0, y: 0, width: 3840, height: 2400 },
    [layer]: { x: 1168, y: 875.5, width: 1504, height: 649 },
  }
  move(api, controller, { x: 1920, y: 1000, z: 199.58 })
  setNullParent(api, layer, controller)
  const resolvedCamera = resolveCamera3D(camera, undefined, { width: 3840, height: 2400 })
  const center = () => buildWorldPlanes(api, layout, {}, resolvedCamera).find(plane => plane.nodeId === layer)!.center
  const before = center()
  const pivot = new Vector3(1920, 1000, 199.58)
  const radius = new Vector3(before.x, before.y, before.z).distanceTo(pivot)
  expect(radius).toBeGreaterThan(280)
  move(api, controller, { rotationX: -47.95, rotationY: 40.62 })
  const orbit = center()
  expect(new Vector3(orbit.x, orbit.y, orbit.z).distanceTo(pivot)).toBeCloseTo(radius, 7)
  expect(new Vector3(orbit.x, orbit.y, orbit.z).distanceTo(new Vector3(before.x, before.y, before.z))).toBeGreaterThan(100)
  move(api, layer, { rotationX: 16 })
  const ownRotation = center()
  expect(ownRotation.x).toBeCloseTo(orbit.x, 7)
  expect(ownRotation.y).toBeCloseTo(orbit.y, 7)
  expect(ownRotation.z).toBeCloseTo(orbit.z, 7)
})
