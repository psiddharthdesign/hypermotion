// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import {
  addCamera,
  deleteCameraSafely,
  duplicateCamera,
  listSceneCameras,
  listTimelineCameras,
} from '@/ui/cameraActions'

describe('multi-camera editor actions', () => {
  it('adds a camera from the active static pose and makes it active', () => {
    const api = createSceneAPI()
    const first = api.getActiveCamera()
    expect(first).not.toBeNull()

    api.setNodeProperty(first!.id, 'fieldOfView', 52)
    api.setNodeProperty(first!.id, 'transform', {
      ...first!.transform,
      x: 321,
      y: 123,
      z: 80,
    })

    const addedId = addCamera(api)
    const added = api.getNode(addedId)

    expect(listSceneCameras(api)).toHaveLength(2)
    expect(api.getDefaultCameraId()).toBe(addedId)
    expect(added?.kind).toBe('camera')
    if (added?.kind === 'camera') {
      expect(added.fieldOfView).toBe(52)
      expect(added.transform).toMatchObject({ x: 321, y: 123, z: 80 })
    }
  })

  it('duplicates camera properties and tracks without changing the active camera', () => {
    const api = createSceneAPI()
    const source = api.getActiveCamera()!
    api.setNodeProperty(source.id, 'bloomEnabled', true)
    api.setTrack({
      id: 'camera-x',
      nodeId: source.id,
      propertyId: 'transform.x',
      defaultEasing: 'ease-in-out',
      keyframes: [
        { id: 'start', time: 0, value: 100 },
        { id: 'end', time: 1, value: 500 },
      ],
    })

    const duplicateId = duplicateCamera(api, source.id)
    const duplicate = duplicateId ? api.getNode(duplicateId) : null

    expect(duplicateId).not.toBeNull()
    expect(api.getDefaultCameraId()).toBe(source.id)
    expect(duplicate?.kind).toBe('camera')
    if (duplicate?.kind === 'camera') {
      expect(duplicate.bloomEnabled).toBe(true)
      expect(duplicate.name).toBe('Camera copy')
    }
    expect(api.getTracksForNode(duplicateId!)).toEqual([
      expect.objectContaining({
        id: 'camera-x_copy',
        nodeId: duplicateId,
        propertyId: 'transform.x',
        keyframes: [
          { id: 'start', time: 0, value: 100 },
          { id: 'end', time: 1, value: 500 },
        ],
      }),
    ])
  })

  it('deletes an inactive camera and its tracks without changing the active camera', () => {
    const api = createSceneAPI()
    const activeId = api.getDefaultCameraId()!
    const secondId = addCamera(api)
    api.setDefaultCameraId(activeId)
    api.setTrack({
      id: 'second-z',
      nodeId: secondId,
      propertyId: 'transform.z',
      defaultEasing: 'linear',
      keyframes: [{ id: 'z', time: 0, value: 10 }],
    })

    const result = deleteCameraSafely(api, secondId)

    expect(result).toEqual({ deleted: true, activeCameraId: activeId })
    expect(api.getNode(secondId)).toBeNull()
    expect(api.getTrack('second-z')).toBeNull()
    expect(api.getDefaultCameraId()).toBe(activeId)
  })

  it('promotes a neighboring camera before deleting the active camera', () => {
    const api = createSceneAPI()
    const firstId = api.getDefaultCameraId()!
    const secondId = addCamera(api)

    const result = deleteCameraSafely(api, secondId)

    expect(result).toEqual({ deleted: true, activeCameraId: firstId })
    expect(api.getDefaultCameraId()).toBe(firstId)
    expect(api.getNode(secondId)).toBeNull()
  })

  it('refuses to delete the final camera', () => {
    const api = createSceneAPI()
    const cameraId = api.getDefaultCameraId()!

    expect(deleteCameraSafely(api, cameraId)).toEqual({
      deleted: false,
      activeCameraId: cameraId,
      reason: 'last-camera',
    })
    expect(api.getNode(cameraId)?.kind).toBe('camera')
  })

  it('orders every camera for the timeline with the default camera first', () => {
    const api = createSceneAPI()
    const firstId = api.getDefaultCameraId()!
    const secondId = addCamera(api)
    const thirdId = addCamera(api)

    api.setDefaultCameraId(secondId)

    expect(listTimelineCameras(api).map((camera) => camera.id)).toEqual([
      secondId,
      firstId,
      thirdId,
    ])
  })
})
