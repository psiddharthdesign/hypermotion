// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from './doc'
import { applyBytesToScene, applyJsonToScene, sceneToBytes, sceneToJson } from './file'
import { normalizeCameraProjection, orthographicCameraZoom } from './cameraProjection'

describe('camera projection persistence', () => {
  it('round-trips both camera models and zoom through binary and JSON files', () => {
    const api = createSceneAPI()
    for (const projection of ['2d', 'perspective', 'orthographic'] as const) {
      api.createNode('camera', null, { name: projection, projection })
    }
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'projection', 'orthographic')
    api.setNodeProperty(camera.id, 'transform', { ...camera.transform, scaleX: 0.5, scaleY: 0.5 })
    const doc = new Y.Doc()
    applyBytesToScene(doc, sceneToBytes(api.doc))
    for (const restored of [createSceneAPI(doc), applyJsonToScene(new Y.Doc(), sceneToJson(api))]) {
      expect(restored.getActiveCamera()).toMatchObject({ projection: 'orthographic', transform: { scaleX: 0.5, scaleY: 0.5 } })
      for (const projection of ['2d', 'perspective', 'orthographic']) {
        expect(restored.getAllNodeIds().map(id => restored.getNode(id)).find(n => n?.name === projection)).toMatchObject({ projection })
      }
    }
  })

  it('opens legacy or invalid projection safely and clamps degenerate zoom', () => {
    expect(normalizeCameraProjection(undefined)).toBe('2d')
    expect(normalizeCameraProjection('unknown')).toBe('2d')
    const api = createSceneAPI()
    expect(api.getActiveCamera()!.projection).toBe('2d')
    expect(orthographicCameraZoom(0.5)).toBe(2)
    expect(orthographicCameraZoom(NaN)).toBe(1)
    expect(Number.isFinite(orthographicCameraZoom(0))).toBe(true)
  })
})
