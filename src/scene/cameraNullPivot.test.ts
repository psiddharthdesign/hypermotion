// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Vector3 } from 'three'
import { getAnimEngine, type AnimatedValue } from '@/anim'
import { createSceneAPI, snapshotScene } from '@/scene/doc'
import { applyBytesToScene, applyJsonToScene, sceneToBytes } from '@/scene/file'
import { addNull, alignNullToCamera, applyNullTransforms, createNullResolver, migrateNullCameras, setNullParent } from '@/scene/nullObject'
import { resolveCamera3D, worldToCamera } from '@/render3d/scene3d'
import type { CameraNode } from '@/scene/types'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

function setup() {
  const api = createSceneAPI()
  api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const controller = addNull(api)!
  const cameraId = api.getActiveCamera()!.id
  const move = (id: string, patch: Partial<CameraNode['transform']>) => api.setNodeProperty(id, 'transform', { ...api.getNode(id)!.transform, ...patch })
  const camera = () => api.getNode(cameraId) as CameraNode
  const pose = (values: Record<string, AnimatedValue> = {}) => {
    const animated = { ...values }
    applyNullTransforms(api, animated)
    return resolveCamera3D(camera(), animated[cameraId], api.getMeta().canvas)
  }
  return { api, controller, cameraId, camera, move, pose }
}
function expectPoint(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) {
  for (const axis of ['x', 'y', 'z'] as const) expect(actual[axis]).toBeCloseTo(expected[axis], 7)
}
afterEach(() => getAnimEngine().pause())

describe('camera and Null pivots', () => {
  it('preserves a rotated camera view on connection and exposes the true eye XYZ', () => {
    const { api, controller, cameraId, camera, move, pose } = setup()
    move(cameraId, { x: 620, y: 380, z: 240, rotationX: 23, rotationY: -37, rotation: 18 })
    const before = pose()
    setNullParent(api, cameraId, controller)
    expect(camera().positionMode).toBe('free')
    expectPoint(camera().transform, before.position)
    expectPoint(pose().position, before.position)
    expectPoint(worldToCamera({ x: 50, y: 80, z: 25 }, pose()), worldToCamera({ x: 50, y: 80, z: 25 }, before))
  })

  it.each(['rotationX', 'rotationY', 'rotation'] as const)('rotates a coincident Null around %s without orbiting the camera', axis => {
    const { api, controller, cameraId, camera, move, pose } = setup()
    const eye = pose().position
    move(controller, eye)
    setNullParent(api, cameraId, controller)
    move(controller, { [axis]: 63 })
    expectPoint(pose().position, eye)
    move(cameraId, { [axis]: -42 })
    expectPoint(pose().position, eye)
    expectPoint(camera().transform, eye)
  })

  it('keeps a free camera eye fixed when its lens changes and after disconnect', () => {
    const { api, controller, cameraId, move, pose, camera } = setup()
    setNullParent(api, cameraId, controller)
    const eye = pose().position
    api.setNodeProperty(cameraId, 'fieldOfView', 80)
    expectPoint(pose().position, eye)
    setNullParent(api, cameraId, null)
    move(cameraId, { rotationX: 45, rotationY: 60 })
    expect(camera().positionMode).toBe('free')
    expectPoint(pose().position, eye)
  })

  it('preserves the animated bind-time view and translation keyframe metadata', () => {
    const { api, controller, cameraId, camera, pose } = setup()
    const engine = getAnimEngine()
    for (const [axis, first, last] of [['x', 480, 680], ['y', 270, 370], ['z', 0, 120], ['rotationY', 0, 60]] as const) {
      api.setTrack({ id: axis, nodeId: cameraId, propertyId: `transform.${axis}`, defaultEasing: 'linear', keyframes: [
        { id: `${axis}-a`, time: 0, value: first, easingOut: 'linear' }, { id: `${axis}-b`, time: 1, value: last, presetOrigin: 'in' },
      ] })
    }
    engine.attach(api)
    engine.seek(0.5)
    const oldTracks = api.getTracksForNode(cameraId)
    const values = engine.getSnapshot()
    const before = pose(values)
    setNullParent(api, cameraId, controller, values)
    const after = pose(engine.getSnapshot())
    expectPoint(after.position, before.position)
    expectPoint(worldToCamera({ x: 90, y: 60, z: 0 }, after), worldToCamera({ x: 90, y: 60, z: 0 }, before))
    const offset = { x: camera().transform.x - 480, y: camera().transform.y - 270, z: camera().transform.z }
    for (const track of oldTracks) {
      const axis = track.id as keyof typeof offset
      expect(api.getTrack(track.id)?.keyframes).toEqual(track.keyframes.map(k => ({ ...k, value: Number(k.value) + (offset[axis] ?? 0) })))
    }
  })

  it('aligns an animated, nested controller without moving any connected object', () => {
    const { api, controller, cameraId, move, pose } = setup()
    const outer = addNull(api)!
    const layer = api.createNode('rect', api.getRoot(), { size: { width: 50, height: 50 } })
    setNullParent(api, controller, outer)
    setNullParent(api, cameraId, controller)
    setNullParent(api, layer, controller)
    move(outer, { x: 600, rotationY: 25, rotation: 12, scaleX: 1.2 })
    const values: Record<string, AnimatedValue> = { [controller]: { x: 560, rotationY: 15 }, [cameraId]: { rotationX: 10 } }
    const before = pose(values)
    const beforeLayer = createNullResolver(id => api.getNode(id), values).delta(api.getNode(layer)!)
    const result = alignNullToCamera(api, cameraId, values)!
    expect(result).not.toBeNull()
    const aligned = { ...values, [controller]: { ...values[controller], ...result.patch } }
    expectPoint(pose(aligned).position, before.position)
    const resolver = createNullResolver(id => api.getNode(id), aligned)
    expectPoint(new Vector3().applyMatrix4(resolver.world(api.getNode(controller)!)), before.position)
    resolver.delta(api.getNode(layer)!).elements.forEach((value, i) => expect(value).toBeCloseTo(beforeLayer.elements[i]!, 7))
    expectPoint(pose({ ...aligned, [controller]: { ...aligned[controller], rotationY: 80, rotationX: 35 } }).position, before.position)
  })

  it('undoes connection and eye-coordinate conversion as one gesture', () => {
    const { api, controller, cameraId, camera, pose } = setup()
    const before = camera()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    setNullParent(api, cameraId, controller)
    const linkedPose = pose()
    undo.undo()
    expect(camera().positionMode).toBe('orbit')
    expect(camera().transform).toEqual(before.transform)
    expect(camera().transformParent).toBeNull()
    undo.redo()
    expect(camera().positionMode).toBe('free')
    expectPoint(pose().position, linkedPose.position)
    undo.destroy()
  })

  it('migrates an older connected camera once while preserving its view', () => {
    const { api, controller, cameraId, camera, pose, move } = setup()
    move(cameraId, { rotationX: 20, rotationY: 30 })
    const inverseBind = createNullResolver(id => api.getNode(id)).world(api.getNode(controller)!).invert().toArray()
    api.setNodeProperty(cameraId, 'transformParent', { nodeId: controller, inverseBind })
    move(controller, { rotationY: 30, x: 550 })
    const before = pose()
    const engine = getAnimEngine()
    engine.attach(api)
    expect(camera().positionMode).toBe('free')
    expectPoint(pose(engine.getSnapshot()).position, before.position)
    const version = api.getVersion()
    migrateNullCameras(api)
    engine.seek(1)
    expect(api.getVersion()).toBe(version)
  })

  it('retains eye coordinates through binary and JSON round trips', () => {
    const { api, controller, cameraId, camera } = setup()
    setNullParent(api, cameraId, controller)
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    for (const restored of [createSceneAPI(doc), applyJsonToScene(new Y.Doc(), snapshotScene(api))]) {
      const saved = restored.getAllNodeIds().map(id => restored.getNode(id)).find(n => n?.kind === 'camera') as CameraNode
      expect(saved.positionMode).toBe('free')
      expect(saved.transform).toEqual(camera().transform)
    }
  })

  it('retains the original orbit behavior for unconnected cameras', () => {
    const { cameraId, move, pose, camera } = setup()
    const before = pose().position
    move(cameraId, { rotationY: 45 })
    expect(camera().positionMode).toBe('orbit')
    expect(pose().position.x).not.toBeCloseTo(before.x)
  })
})
