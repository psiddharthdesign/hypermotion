// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'
import { createProjectAPI } from '@/project/doc'
import { exportCompositionToHypeBytes, importScenesFromHypeBytes } from '@/project/sceneTransfer'
import { createSceneAPI } from './doc'
import { applyBytesToScene, applyJsonToScene, sceneToBytes, sceneToJson } from './file'
import { CAMERA_COMPOSITION_GUIDE_OPTIONS, normalizeCameraCompositionGuide, type CameraCompositionGuide } from './cameraCompositionGuide'

describe('camera composition guide persistence', () => {
  it('opens missing or unsupported guide settings as Off', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    expect(camera.compositionGuide).toBe('none')
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    const savedCamera = nodes.get(camera.id)!
    for (const value of [undefined, null, '', 'future-guide', 2, {}]) {
      if (value === undefined) savedCamera.delete('compositionGuide')
      else savedCamera.set('compositionGuide', value)
      expect(api.getActiveCamera()!.compositionGuide).toBe('none')
      expect(normalizeCameraCompositionGuide(value)).toBe('none')
    }
  })

  it('round-trips every guide independently per camera through binary and JSON scenes', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    for (const { value } of CAMERA_COMPOSITION_GUIDE_OPTIONS) {
      api.createNode('camera', null, { name: value, compositionGuide: value })
    }
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    for (const restored of [createSceneAPI(doc), applyJsonToScene(new Y.Doc(), sceneToJson(api))]) {
      const cameras = restored.getAllNodeIds().map((id) => restored.getNode(id)).filter((node) => node?.kind === 'camera')
      for (const { value } of CAMERA_COMPOSITION_GUIDE_OPTIONS) {
        expect(cameras.find((camera) => camera.name === value)?.compositionGuide).toBe(value)
      }
    }
  })

  it('retains guide choice through scene duplication and portable scene import', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const scene = project.getScenes()[0]!
    api.setNodeProperty(scene.defaultCameraId!, 'compositionGuide', 'diamond-grid')
    const duplicate = project.duplicateScene(scene.id)!
    expect(api.getNode(duplicate.defaultCameraId!)).toMatchObject({ compositionGuide: 'diamond-grid' })
    api.setNodeProperty(duplicate.defaultCameraId!, 'compositionGuide', 'thirds')
    expect(api.getNode(scene.defaultCameraId!)).toMatchObject({ compositionGuide: 'diamond-grid' })

    const target = createSceneAPI()
    target.createNode('frame', null)
    const targetProject = createProjectAPI(target)
    targetProject.ensureInitialized()
    importScenesFromHypeBytes(targetProject, exportCompositionToHypeBytes(project, scene.id))
    const importedCameras = target.getAllNodeIds().map((id) => target.getNode(id)).filter((node) => node?.kind === 'camera')
    expect(importedCameras.some((camera) => camera.compositionGuide === 'diamond-grid')).toBe(true)
  })

  it('normalizes writes and keeps guide changes out of Auto Key', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'compositionGuide', 'golden-ratio')
    expect(api.getActiveCamera()!.compositionGuide).toBe('golden-ratio')
    expect(keyframeValuesForPatch('camera', { compositionGuide: 'thirds' })).toEqual([])
    // Simulate an untyped external patch arriving at the typed API boundary.
    api.setNodeProperty(camera.id, 'compositionGuide', 'unsupported' as CameraCompositionGuide)
    expect(api.getActiveCamera()!.compositionGuide).toBe('none')
  })
})
