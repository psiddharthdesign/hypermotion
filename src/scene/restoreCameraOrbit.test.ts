// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from './doc'
import { applyBytesToScene, loadSceneIntoDoc, readScene, sceneToBytes } from './file'
import { removeLegacy3DObjects } from './removeLegacy3DObjects'
import { projectWorldPoint, resolveCamera3D } from '@/render3d/scene3d'

function retiredRig() {
  const api = createSceneAPI()
  api.setMeta({ canvas: { width: 960, height: 540 } })
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  api.doc.getMap('scene').set('root', root)
  const card = api.createNode('rect', root, { transform: { x: 200, y: 100, z: 0, rotationX: 16, rotationY: 0, rotation: 0, scaleX: 1, scaleY: 1 } })
  const camera = api.getActiveCamera()!
  api.setNodeProperty(camera.id, 'fieldOfView', 2 * Math.atan(270 / 1000) * 180 / Math.PI)
  api.setNodeProperty(camera.id, 'focalLength', 1000)
  api.setNodeProperty(camera.id, 'transform', { ...camera.transform, x: 480, y: 270, z: -1000, rotationX: 0, rotationY: 0, rotation: 0 })
  api.setTrack({ id: 'dolly', nodeId: camera.id, propertyId: 'transform.z', defaultEasing: 'linear', keyframes: [
    { id: 'start', time: 0, value: -1000 }, { id: 'end', time: 2, value: -800 },
  ] })
  const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
  const controller = new Y.Map<unknown>()
  nodes.set('controller', controller)
  controller.set('id', 'controller')
  controller.set('kind', 'null')
  controller.set('parent', root)
  controller.set('children', [])
  const children = nodes.get(root)!.get('children') as Y.Array<string>
  children.push(['controller'])
  for (const id of [card, camera.id]) {
    nodes.get(id)!.set('transformParent', { nodeId: 'controller', inverseBind: [] })
    nodes.get(id)!.set('transformOffset', [])
  }
  nodes.get(camera.id)!.set('positionMode', 'free')
  api.setTrack({ id: 'controller-rotation', nodeId: 'controller', propertyId: 'transform.rotationY', defaultEasing: 'linear', keyframes: [{ id: 'rotation', time: 0, value: 40 }] })
  return { api, root, card, cameraId: camera.id }
}

describe('restore camera orbit after retiring controllers', () => {
  it.each(['read', 'replace', 'apply', 'autosave'] as const)('cleans %s scenes and retains camera/layer animation', (mode) => {
    const original = retiredRig()
    const bytes = sceneToBytes(original.api.doc)
    const doc = new Y.Doc()
    let api
    if (mode === 'read') api = readScene(bytes).api
    else if (mode === 'replace') {
      api = createSceneAPI(doc)
      loadSceneIntoDoc(doc, bytes)
    } else {
      if (mode === 'apply') applyBytesToScene(doc, bytes)
      else Y.applyUpdate(doc, bytes)
      api = createSceneAPI(doc)
    }
    expect(api.getNode('controller')).toBeNull()
    expect(api.getTrack('controller-rotation')).toBeNull()
    expect(api.getNode(original.root)!.children).toEqual([original.card])
    expect(api.getNode(original.card)!.transform.rotationX).toBe(16)
    const camera = api.getNode(original.cameraId)!
    expect(camera.transform).toMatchObject({ x: 480, y: 270 })
    expect(camera.transform.z).toBeCloseTo(0)
    expect(api.getActiveCameraId()).toBe(original.cameraId)
    const keys = api.getTrack('dolly')!.keyframes
    expect(keys.map(({ id, time }) => ({ id, time }))).toEqual([{ id: 'start', time: 0 }, { id: 'end', time: 2 }])
    expect(keys[0].value).toBeCloseTo(0)
    expect(keys[1].value).toBeCloseTo(200)
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    for (const node of nodes.values()) {
      expect(node.has('positionMode')).toBe(false)
      expect(node.has('transformParent')).toBe(false)
      expect(node.has('transformOffset')).toBe(false)
    }
    const snapshot = sceneToBytes(api.doc)
    removeLegacy3DObjects(api.doc)
    expect(sceneToBytes(api.doc)).toEqual(snapshot)
  })

  it('restores a rotated eye to its scene-plane orbit target', () => {
    const { api, cameraId } = retiredRig()
    const camera = api.getActiveCamera()!
    api.setNodeProperty(cameraId, 'transform', { ...camera.transform, x: -20, y: 270, z: -Math.sqrt(3) * 500, rotationY: 30 })
    removeLegacy3DObjects(api.doc)
    const converted = api.getActiveCamera()!
    expect(converted.transform.x).toBeCloseTo(480)
    expect(converted.transform.z).toBeCloseTo(0)
    const pose = resolveCamera3D(converted, undefined, { width: 960, height: 540 })
    expect(pose.position.x).toBeCloseTo(-20)
    expect(pose.position.z).toBeCloseTo(-Math.sqrt(3) * 500)
  })

  it('also converts disconnected cameras without any remaining controller nodes', () => {
    const { api, cameraId } = retiredRig()
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    nodes.delete('controller')
    nodes.get(cameraId)!.delete('transformParent')
    removeLegacy3DObjects(api.doc)
    expect(api.getActiveCamera()!.transform.z).toBeCloseTo(0)
    expect(nodes.get(cameraId)!.has('positionMode')).toBe(false)
  })

  it('leaves pre-feature documents and their camera keys untouched', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'transform', { ...camera.transform, rotationY: 40, z: 100 })
    api.setTrack({ id: 'orbit', nodeId: camera.id, propertyId: 'transform.rotationY', defaultEasing: 'linear', keyframes: [{ id: 'key', time: 1, value: 50 }] })
    const snapshot = sceneToBytes(api.doc)
    removeLegacy3DObjects(api.doc)
    expect(sceneToBytes(api.doc)).toEqual(snapshot)
  })

  it('orbits around the scene center through animated rotations and dolly', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    const viewport = { width: 960, height: 540 }
    const center = { x: 480, y: 270, z: 0 }
    for (const rotation of [{ rotationX: 0, rotationY: 45 }, { rotationX: 35, rotationY: -50, rotation: 20 }]) {
      const pose = resolveCamera3D(camera, { x: center.x, y: center.y, z: 200, ...rotation }, viewport)
      expect(pose.pointOfInterest).toEqual(center)
      expect(pose.position.x).not.toBe(center.x)
      expect(Math.hypot(pose.position.x - center.x, pose.position.y - center.y, pose.position.z)).toBeCloseTo(pose.focalLength - 200)
      const projected = projectWorldPoint(center, pose, viewport)
      expect(projected.x).toBeCloseTo(480)
      expect(projected.y).toBeCloseTo(270)
    }
  })
})
