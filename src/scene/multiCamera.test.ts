// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { addKeyframe } from '@/anim/tracks'

describe('multi-camera scene API', () => {
  it('keeps multiple scene-level cameras and switches the authored default explicitly', () => {
    const api = createSceneAPI()
    const first = api.getActiveCamera()
    if (!first) throw new Error('Expected the seeded camera')

    const secondId = api.createNode('camera', null, {
      name: 'Detail camera',
      transform: {
        ...first.transform,
        x: first.transform.x + 120,
        z: 240,
      },
      focalLength: 720,
    })

    expect(api.getAllCameras().map((camera) => camera.id)).toEqual([
      first.id,
      secondId,
    ])
    expect(api.getDefaultCameraId()).toBe(first.id)

    api.setDefaultCameraId(secondId)

    expect(api.getDefaultCameraId()).toBe(secondId)
    expect(api.getActiveCamera()?.id).toBe(secondId)
  })

  it('repairs the default camera and removes orphan tracks when a camera is deleted', () => {
    const api = createSceneAPI()
    const first = api.getActiveCamera()
    if (!first) throw new Error('Expected the seeded camera')
    const secondId = api.createNode('camera', null, { name: 'Camera B' })
    api.setDefaultCameraId(secondId)
    addKeyframe(api, secondId, 'camera.focalLength', 0, 1000)
    addKeyframe(api, secondId, 'camera.focalLength', 1, 650)

    expect(api.getTracksForNode(secondId)).toHaveLength(1)
    api.deleteNode(secondId)

    expect(api.getNode(secondId)).toBeNull()
    expect(api.getTracksForNode(secondId)).toEqual([])
    expect(api.getDefaultCameraId()).toBe(first.id)
    expect(api.getAllCameras()).toHaveLength(1)
  })

  it('rejects a non-camera as the default camera', () => {
    const api = createSceneAPI()
    const frameId = api.createNode('frame', null, { name: 'Not a camera' })

    expect(() => api.setDefaultCameraId(frameId)).toThrow(
      `Node ${frameId} is not a camera`,
    )
  })
})
