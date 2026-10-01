// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { getAnimEngine } from '@/anim/engine'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'
import { createProjectAPI } from '@/project/doc'
import { createSceneAPI } from './doc'
import { applyBytesToScene, applyJsonToScene, sceneToBytes, sceneToJson } from './file'
import { PROPERTIES } from './props'
import type { Track } from './types'

const defaults = {
  vignetteEnabled: false,
  vignetteAmount: 0.35,
  vignetteSize: 0.5,
  vignetteFeather: 0.5,
}
const authored = {
  vignetteEnabled: true,
  vignetteAmount: 0.8,
  vignetteSize: 0.25,
  vignetteFeather: 0.7,
}

function vignetteTrack(nodeId: string, field: 'Amount' | 'Size' | 'Feather'): Track {
  return {
    id: `vignette-${field}`,
    nodeId,
    propertyId: `camera.vignette${field}`,
    defaultEasing: 'linear',
    keyframes: [
      { id: `${field}-start`, time: 0, value: 0.2 },
      { id: `${field}-end`, time: 2, value: 0.8 },
    ],
  }
}

describe('camera vignette model', () => {
  it('defaults new and legacy cameras to an inactive vignette', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    expect(camera).toMatchObject(defaults)
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    api.doc.transact(() => {
      for (const field of Object.keys(defaults)) nodes.get(camera.id)!.delete(field)
    })
    expect(api.getActiveCamera()).toMatchObject(defaults)
  })

  it('clamps creation, editing, and legacy data and replaces non-finite values', () => {
    const api = createSceneAPI()
    const id = api.createNode('camera', null, {
      vignetteAmount: 2, vignetteSize: -1, vignetteFeather: Number.NaN,
    })
    expect(api.getNode(id)).toMatchObject({ vignetteAmount: 1, vignetteSize: 0, vignetteFeather: 0.5 })
    api.setNodeProperty(id, 'vignetteAmount', Number.POSITIVE_INFINITY)
    api.setNodeProperty(id, 'vignetteSize', 2)
    api.setNodeProperty(id, 'vignetteFeather', -1)
    expect(api.getNode(id)).toMatchObject({ vignetteAmount: 0.35, vignetteSize: 1, vignetteFeather: 0 })
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    api.doc.transact(() => nodes.get(id)!.set('vignetteAmount', -10))
    expect(api.getNode(id)).toMatchObject({ vignetteAmount: 0 })
  })

  it('preserves settings and tracks through binary and JSON save/reopen', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    api.doc.transact(() => {
      api.setNodeProperty(camera.id, 'vignetteEnabled', authored.vignetteEnabled)
      api.setNodeProperty(camera.id, 'vignetteAmount', authored.vignetteAmount)
      api.setNodeProperty(camera.id, 'vignetteSize', authored.vignetteSize)
      api.setNodeProperty(camera.id, 'vignetteFeather', authored.vignetteFeather)
      for (const field of ['Amount', 'Size', 'Feather'] as const) api.setTrack(vignetteTrack(camera.id, field))
    })
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    for (const restored of [createSceneAPI(doc), applyJsonToScene(new Y.Doc(), sceneToJson(api))]) {
      const restoredCamera = restored.getActiveCamera()!
      expect(restoredCamera).toMatchObject(authored)
      expect(restored.getTracksForNode(restoredCamera.id).map(track => track.propertyId).sort()).toEqual([
        'camera.vignetteAmount', 'camera.vignetteFeather', 'camera.vignetteSize',
      ])
    }
  })

  it('copies camera settings and animation when duplicating a composition', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { name: 'Root', size: { width: 960, height: 540 } })
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const source = project.getScenes()[0]!
    const cameraId = source.defaultCameraId!
    api.setNodeProperty(cameraId, 'vignetteEnabled', true)
    api.setNodeProperty(cameraId, 'vignetteAmount', 0.8)
    api.setTrack(vignetteTrack(cameraId, 'Amount'))
    const copy = project.duplicateScene(source.id)!
    expect(copy.defaultCameraId).not.toBe(cameraId)
    expect(api.getNode(copy.defaultCameraId!)).toMatchObject({ vignetteEnabled: true, vignetteAmount: 0.8 })
    expect(api.getTracksForNode(copy.defaultCameraId!)).toEqual([
      expect.objectContaining({ nodeId: copy.defaultCameraId, propertyId: 'camera.vignetteAmount' }),
    ])
  })

  it('records only numeric controls and interpolates all three without changing stored values', () => {
    expect(keyframeValuesForPatch('camera', authored)).toEqual([
      { propertyId: 'camera.vignetteAmount', value: 0.8 },
      { propertyId: 'camera.vignetteSize', value: 0.25 },
      { propertyId: 'camera.vignetteFeather', value: 0.7 },
    ])
    for (const field of ['Amount', 'Size', 'Feather'] as const) {
      expect(PROPERTIES[`camera.vignette${field}`]).toMatchObject({ interpolation: 'numeric', layoutAffecting: false })
    }
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    for (const field of ['Amount', 'Size', 'Feather'] as const) api.setTrack(vignetteTrack(camera.id, field))
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.5)
    for (const field of ['vignetteAmount', 'vignetteSize', 'vignetteFeather'] as const) {
      expect(engine.getSnapshot()[camera.id]?.[field]).toBeCloseTo(0.35)
    }
    expect(api.getActiveCamera()).toMatchObject(defaults)
  })
})
