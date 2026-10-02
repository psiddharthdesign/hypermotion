// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { getAnimEngine } from '@/anim/engine'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'
import { createWorldPlaneAnimationSelector } from '@/render3d/planeAnimationSnapshot'
import { createAnimatedSnapshotSelector } from '@/ui/hooks/useAnimatedValues'
import { createSceneAPI } from './doc'
import { applyBytesToScene, applyJsonToScene, sceneToBytes, sceneToJson } from './file'
import { PROPERTIES } from './props'
import { applyIsometricCameraPreset } from '@/ui/cameraViewPreset'

afterEach(() => getAnimEngine().pause())

const pose = {
  focusPlaneX: 320,
  focusPlaneY: 180,
  focusPlaneZ: -240,
  focusPlaneRotationX: 30,
  focusPlaneRotationY: -60,
  focusPlaneRotationZ: 90,
}

describe('independent focus-plane camera model', () => {
  it('defaults legacy cameras to zero plane rotation without changing their mode', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    api.doc.transact(() => {
      for (const key of [...Object.keys(pose), 'focusPlaneInitialized']) nodes.get(camera.id)!.delete(key)
    })
    expect(api.getActiveCamera()).toMatchObject({ focusMode: 'screen', focusPlaneX: 0, focusPlaneY: 0, focusPlaneZ: 0, focusPlaneRotationX: 0, focusPlaneRotationY: 0, focusPlaneRotationZ: 0, focusPlaneInitialized: false })
  })

  it('preserves spatial mode at the origin and round-trips plane position, rotation and tracks', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const camera = api.getActiveCamera()!
    const authored = { ...camera, ...pose, name: 'Independent focus', focusMode: 'spatial' as const, focusPlaneInitialized: true, focusX: 0, focusY: 0 }
    const id = api.createNode('camera', null, authored)
    api.setActiveCameraId(id)
    api.setTrack({ id: 'focus-rotate', nodeId: id, propertyId: 'camera.focusPlaneRotationY', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: -60 }, { id: 'b', time: 1, value: 60 }] })
    // Trigger the same default-camera migration checks as any unrelated edit.
    api.setMeta({ name: 'Focus plane scene' })
    expect(api.getActiveCamera()).toMatchObject({ ...pose, focusMode: 'spatial' })

    const cloneId = api.createNode('camera', null, { ...api.getActiveCamera()!, name: 'Cloned focus' })
    expect(api.getNode(cloneId)).toMatchObject({ ...pose, focusMode: 'spatial' })
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    const binary = createSceneAPI(doc)
    const json = applyJsonToScene(new Y.Doc(), sceneToJson(api))
    for (const restored of [binary, json]) {
      const restoredCamera = restored.getAllNodeIds().map((key) => restored.getNode(key)).find((node) => node?.name === 'Independent focus')!
      expect(restoredCamera).toMatchObject({ ...pose, focusMode: 'spatial', focusPlaneInitialized: true })
      expect(restored.getTracksForNode(restoredCamera.id)[0]).toMatchObject({ propertyId: 'camera.focusPlaneRotationY', keyframes: [{ time: 0, value: -60 }, { time: 1, value: 60 }] })
    }
  })

  it('preserves the independent plane when other focus modes edit their positions', () => {
    const api = createSceneAPI()
    const id = api.createNode('camera', null, { ...pose, focusMode: 'spatial' })
    expect(api.getNode(id)).toMatchObject({ ...pose, focusPlaneInitialized: true })
    api.setNodeProperty(id, 'focusMode', 'screen')
    api.setNodeProperty(id, 'focusWorldX', 12)
    api.setNodeProperty(id, 'focusWorldY', 34)
    api.setNodeProperty(id, 'focusMode', 'plane')
    api.setNodeProperty(id, 'focusWorldZ', 560)
    api.setNodeProperty(id, 'focusDistance', 560)
    api.setNodeProperty(id, 'focusMode', 'spatial')
    expect(api.getNode(id)).toMatchObject({ ...pose, focusPlaneInitialized: true })
  })

  it('records and evaluates all six pose channels without changing the camera pose', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'focusMode', 'spatial')
    const values = keyframeValuesForPatch('camera', { ...pose, focusMode: 'spatial' })
    expect(values).toHaveLength(6)
    for (const { propertyId, value } of values) {
      api.setTrack({ id: propertyId, nodeId: camera.id, propertyId, defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 1, value }] })
    }
    const engine = getAnimEngine()
    engine.attach(api)
    const selectCamera = createAnimatedSnapshotSelector([camera.id])
    const selectPlanes = createWorldPlaneAnimationSelector()
    engine.seek(0.25)
    const first = engine.getSnapshot()
    const firstCamera = selectCamera(first)
    const firstPlanes = selectPlanes(first)
    engine.seek(0.5)
    const second = engine.getSnapshot()
    expect(selectCamera(second)).not.toBe(firstCamera)
    // Lens-only changes update rendering without rebuilding scene geometry.
    expect(selectPlanes(second)).toBe(firstPlanes)
    for (const [key, value] of Object.entries(pose)) {
      expect(second[camera.id]?.[key as keyof typeof pose]).toBeCloseTo(value / 2)
    }
    expect(api.getActiveCamera()!.transform).toEqual(camera.transform)
    expect(api.getActiveCamera()!.focusPlaneRotationX).toBe(0)
    for (const axis of ['X', 'Y', 'Z'] as const) {
      expect(PROPERTIES[`camera.focusPlaneRotation${axis}`]).toMatchObject({ interpolation: 'angle', defaultValue: 0, layoutAffecting: false, label: `Focus Plane Rotate ${axis}` })
    }
  })
  it('keeps an authored independent focus plane and its animation when choosing an isometric view', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const id = api.createNode('camera', null, { ...pose, focusMode: 'spatial', depthOfField: true, showFocusPlane: true })
    const track = { id: 'focus-y', nodeId: id, propertyId: 'camera.focusPlaneY' as const, defaultEasing: 'linear' as const,
      keyframes: [{ id: 'a', time: 0, value: 180 }, { id: 'b', time: 2, value: 360 }],
    }
    api.setTrack(track)
    const before = api.getTracksForNode(id).find(candidate => candidate.id === track.id)
    applyIsometricCameraPreset(api, id, 0, false, 'front-left')
    expect(api.getNode(id)).toMatchObject({ ...pose, focusMode: 'spatial', focusPlaneInitialized: true,
      depthOfField: true, showFocusPlane: true, projection: 'orthographic',
    })
    expect(api.getTracksForNode(id).find(candidate => candidate.id === track.id)).toEqual(before)
    api.doc.destroy()
  })

})
