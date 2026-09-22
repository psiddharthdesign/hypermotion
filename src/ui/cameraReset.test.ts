// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import type { CameraNode, PropertyId, Track } from '@/scene'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import { resetCameraTransformGroup } from '@/ui/cameraReset'

function activeCamera(api: SceneAPI): CameraNode {
  const camera = api.getActiveCamera()
  if (!camera) throw new Error('Expected the test scene to have a camera')
  return camera
}

function trackFor(api: SceneAPI, propertyId: PropertyId): Track {
  const camera = activeCamera(api)
  const track = api
    .getTracksForNode(camera.id)
    .find((candidate) => candidate.propertyId === propertyId)
  if (!track) throw new Error(`Expected ${propertyId} track`)
  return track
}

describe('camera transform group reset', () => {
  it('resets position to the current canvas centre and creates three tracks atomically', () => {
    const api = createSceneAPI()
    api.setMeta({ canvas: { width: 1001, height: 701 } })
    const camera = activeCamera(api)
    api.setNodeProperty(camera.id, 'transform', {
      ...camera.transform,
      x: 125,
      y: -80,
      z: 420,
      rotationX: 12,
      rotationY: -24,
      rotation: 36,
      scaleX: 1.25,
      scaleY: 0.75,
    })

    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)
    expect(resetCameraTransformGroup(api, camera.id, 'position', 1.25)).toBe(
      true,
    )

    expect(activeCamera(api).transform).toEqual({
      ...camera.transform,
      x: 500.5,
      y: 350.5,
      z: 0,
      rotationX: 12,
      rotationY: -24,
      rotation: 36,
      scaleX: 1.25,
      scaleY: 0.75,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(api.getTracksForNode(camera.id)).toHaveLength(3)
    expect(trackFor(api, 'transform.x').keyframes).toEqual([
      expect.objectContaining({ time: 1.25, value: 500.5 }),
    ])
    expect(trackFor(api, 'transform.y').keyframes).toEqual([
      expect.objectContaining({ time: 1.25, value: 350.5 }),
    ])
    expect(trackFor(api, 'transform.z').keyframes).toEqual([
      expect.objectContaining({ time: 1.25, value: 0 }),
    ])
    unsubscribe()
  })

  it('updates existing tracks, creates missing axes, and preserves older keyframes and metadata', () => {
    const api = createSceneAPI()
    const camera = activeCamera(api)
    const xTrack: Track = {
      id: 'camera-x',
      nodeId: camera.id,
      propertyId: 'transform.x',
      defaultEasing: 'ease-in-out',
      keyframes: [
        { id: 'x-old', time: 0, value: 200, easingOut: 'linear' },
        {
          id: 'x-at-playhead',
          time: 2.005,
          value: 800,
          easingOut: 'ease-out',
          presetOrigin: 'in',
        },
      ],
    }
    const yTrack: Track = {
      id: 'camera-y',
      nodeId: camera.id,
      propertyId: 'transform.y',
      defaultEasing: 'linear',
      keyframes: [{ id: 'y-old', time: 0.5, value: 50 }],
    }
    const unrelatedTrack: Track = {
      id: 'camera-rotation',
      nodeId: camera.id,
      propertyId: 'transform.rotation',
      defaultEasing: 'linear',
      keyframes: [{ id: 'rotation-old', time: 0, value: 45 }],
    }
    api.doc.transact(() => {
      api.setTrack(xTrack)
      api.setTrack(yTrack)
      api.setTrack(unrelatedTrack)
    })
    const unrelatedBefore = api.getTrack(unrelatedTrack.id)

    resetCameraTransformGroup(api, camera.id, 'position', 2)

    const nextX = api.getTrack(xTrack.id)!
    expect(nextX.keyframes).toEqual([
      xTrack.keyframes[0],
      {
        ...xTrack.keyframes[1],
        time: 2,
        value: 480,
      },
    ])
    expect(nextX.keyframes[1]).toMatchObject({
      id: 'x-at-playhead',
      easingOut: 'ease-out',
      presetOrigin: 'in',
    })
    expect(api.getTrack(yTrack.id)?.keyframes).toEqual([
      yTrack.keyframes[0],
      expect.objectContaining({ time: 2, value: 270 }),
    ])
    expect(trackFor(api, 'transform.z').keyframes).toEqual([
      expect.objectContaining({ time: 2, value: 0 }),
    ])
    expect(api.getTrack(unrelatedTrack.id)).toEqual(unrelatedBefore)
    expect(
      api
        .getTracksForNode(camera.id)
        .filter((track) => track.propertyId === 'transform.x'),
    ).toHaveLength(1)
  })

  it('resets only rotation while retaining position, scale, and unrelated tracks', () => {
    const api = createSceneAPI()
    const camera = activeCamera(api)
    api.setNodeProperty(camera.id, 'transform', {
      ...camera.transform,
      x: 700,
      y: 350,
      z: -200,
      rotationX: 20,
      rotationY: -30,
      rotation: 40,
      scaleX: 1.5,
      scaleY: 1.5,
    })
    const unrelatedTrack: Track = {
      id: 'camera-x-existing',
      nodeId: camera.id,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [{ id: 'x-existing', time: 0, value: 700 }],
    }
    api.setTrack(unrelatedTrack)
    const unrelatedBefore = api.getTrack(unrelatedTrack.id)

    resetCameraTransformGroup(api, camera.id, 'rotation', 3.5)

    expect(activeCamera(api).transform).toMatchObject({
      x: 700,
      y: 350,
      z: -200,
      rotationX: 0,
      rotationY: 0,
      rotation: 0,
      scaleX: 1.5,
      scaleY: 1.5,
    })
    for (const propertyId of [
      'transform.rotationX',
      'transform.rotationY',
      'transform.rotation',
    ] as const) {
      expect(trackFor(api, propertyId).keyframes).toEqual([
        expect.objectContaining({ time: 3.5, value: 0 }),
      ])
    }
    expect(api.getTrack(unrelatedTrack.id)).toEqual(unrelatedBefore)
    expect(
      api
        .getTracksForNode(camera.id)
        .filter((track) =>
          ['transform.x', 'transform.y', 'transform.z'].includes(
            track.propertyId,
          ),
        ),
    ).toHaveLength(1)
  })

  it('is idempotent at the same playhead', () => {
    const api = createSceneAPI()
    const camera = activeCamera(api)

    resetCameraTransformGroup(api, camera.id, 'rotation', 4)
    const first = api
      .getTracksForNode(camera.id)
      .map((track) => ({
        id: track.id,
        propertyId: track.propertyId,
        keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
      }))

    resetCameraTransformGroup(api, camera.id, 'rotation', 4)
    const second = api
      .getTracksForNode(camera.id)
      .map((track) => ({
        id: track.id,
        propertyId: track.propertyId,
        keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
      }))

    expect(second).toEqual(first)
    expect(api.getTracksForNode(camera.id)).toHaveLength(3)
    expect(
      api.getTracksForNode(camera.id).every((track) => track.keyframes.length === 1),
    ).toBe(true)
  })

  it('does nothing for missing and non-camera node ids', () => {
    const api = createSceneAPI()
    const rectId = api.createNode('rect', null)
    const listener = vi.fn()
    const unsubscribe = api.subscribe(listener)

    expect(resetCameraTransformGroup(api, 'missing', 'position', 1)).toBe(false)
    expect(resetCameraTransformGroup(api, rectId, 'rotation', 1)).toBe(false)

    expect(listener).not.toHaveBeenCalled()
    expect(api.getTracksForNode(rectId)).toEqual([])
    unsubscribe()
  })
})
