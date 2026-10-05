// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { ISOMETRIC_CAMERA_ROTATION } from '@/scene/cameraProjection'
import { addKeyframe, findTrack } from '@/anim/tracks'
import { applyIsometricCameraPreset, cameraZoomScale, toggleCameraZoomKeyframes } from './cameraViewPreset'

describe('isometric camera authoring', () => {
  it('applies the preset without changing framing, assets, or an existing guide', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'compositionGuide', 'thirds')
    const transform = { ...camera.transform, x: 123, y: 456, z: 321, scaleX: 0.5, scaleY: 0.5 }
    api.setNodeProperty(camera.id, 'transform', transform)
    applyIsometricCameraPreset(api, camera.id, 0, false)
    expect(api.getActiveCamera()).toMatchObject({ projection: 'orthographic', compositionGuide: 'thirds', transform: { ...transform, ...ISOMETRIC_CAMERA_ROTATION } })
    expect(api.getTracksForNode(camera.id)).toEqual([])
  })

  it('enables an isometric grid initially and records all rotation axes with Auto Key', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    applyIsometricCameraPreset(api, camera.id, 2, true)
    expect(api.getActiveCamera()!.compositionGuide).toBe('isometric')
    for (const [key, value] of Object.entries(ISOMETRIC_CAMERA_ROTATION)) {
      expect(api.getTracksForNode(camera.id).find(track => track.propertyId === `transform.${key}`)?.keyframes).toEqual([expect.objectContaining({ time: 2, value })])
    }
  })

  it('updates animated rotations at the playhead without deleting earlier animation', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    addKeyframe(api, camera.id, 'transform.rotationX', 0, 10)
    applyIsometricCameraPreset(api, camera.id, 2, false)
    expect(findTrack(api, camera.id, 'transform.rotationX')!.keyframes.map(key => [key.time, key.value])).toEqual([[0, 10], [2, ISOMETRIC_CAMERA_ROTATION.rotationX]])
  })

  it('keeps guides Off when switching between isometric directions', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    applyIsometricCameraPreset(api, camera.id, 0, false)
    api.setNodeProperty(camera.id, 'compositionGuide', 'none')
    applyIsometricCameraPreset(api, camera.id, 0, false, 'back-right')
    expect(api.getActiveCamera()!.compositionGuide).toBe('none')
  })

  it('toggles the visible uniform zoom track without creating hidden axis animation', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    toggleCameraZoomKeyframes(api, camera.id, 0, 1)
    toggleCameraZoomKeyframes(api, camera.id, 2, cameraZoomScale(200))
    expect(findTrack(api, camera.id, 'transform.scaleX')!.keyframes.map(key => [key.time, key.value])).toEqual([[0, 1], [2, 0.5]])
    expect(findTrack(api, camera.id, 'transform.scaleY')).toBeNull()
    toggleCameraZoomKeyframes(api, camera.id, 2, 0.5)
    expect(findTrack(api, camera.id, 'transform.scaleX')!.keyframes.map(key => [key.time, key.value])).toEqual([[0, 1]])
  })

  it('removes a zoom key even when an old hidden Y track has different timing', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    addKeyframe(api, camera.id, 'transform.scaleY', 1.912, 0.1042)
    addKeyframe(api, camera.id, 'transform.scaleY', 2.001, 0.0999)
    const savedY = structuredClone(findTrack(api, camera.id, 'transform.scaleY'))
    toggleCameraZoomKeyframes(api, camera.id, 0, 0.123)
    toggleCameraZoomKeyframes(api, camera.id, 2, 0.12)
    toggleCameraZoomKeyframes(api, camera.id, 2, 0.12)
    expect(findTrack(api, camera.id, 'transform.scaleX')!.keyframes.map(key => key.time)).toEqual([0])
    expect(findTrack(api, camera.id, 'transform.scaleY')).toEqual(savedY)
  })
})
