// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { getProjectAPI } from '@/project/doc'
import { addCamera } from '@/ui/cameraActions'
import { resolveProgramCameraPreviewId } from '@/ui/programCameraPreview'
import {
  collectTimelineTrackGroups,
  resolveTimelineCameraTrackPlaceholder,
} from '@/ui/timelineTrackGroups'

describe('timeline track groups', () => {
  it('includes tracks from every owned camera and excludes unowned cameras', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { name: 'Artboard' })
    const project = getProjectAPI(api)
    project.ensureInitialized()

    const camera1 = api.getDefaultCameraId()
    if (!camera1) throw new Error('Expected the seeded camera')
    const camera2 = addCamera(api)
    api.setDefaultCameraId(camera1)
    const unownedCamera = api.createNode('camera', null, {
      name: 'Unowned camera',
    })

    api.setTrack({
      id: 'camera-1-x',
      nodeId: camera1,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [{ id: 'camera-1-x-start', time: 0, value: 100 }],
    })
    api.setTrack({
      id: 'camera-2-focal-length',
      nodeId: camera2,
      propertyId: 'camera.focalLength',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'camera-2-focal-length-start', time: 0, value: 1000 },
      ],
    })
    api.setTrack({
      id: 'unowned-camera-x',
      nodeId: unownedCamera,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [{ id: 'unowned-camera-x-start', time: 0, value: 0 }],
    })

    const groups = collectTimelineTrackGroups(api)

    expect(groups.map((group) => group.nodeId)).toEqual([
      camera1,
      camera2,
    ])
    expect(groups.map((group) => group.tracks.map((track) => track.id))).toEqual(
      [['camera-1-x'], ['camera-2-focal-length']],
    )
  })

  it('deduplicates root traversal and hides legacy camera scaleY tracks', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { name: 'Artboard' })
    const project = getProjectAPI(api)
    project.ensureInitialized()
    const cameraId = api.getDefaultCameraId()
    if (!cameraId) throw new Error('Expected the seeded camera')
    const textId = api.createNode('text', rootId, {
      name: 'Title',
      text: 'Title',
    })
    const scene = api.doc.getMap<unknown>('scene')
    const nodes = scene.get('nodes') as Y.Map<Y.Map<unknown>>
    const root = nodes.get(rootId)
    const children = root?.get('children') as Y.Array<string> | undefined
    children?.push([textId])

    api.setTrack({
      id: 'camera-scale-y',
      nodeId: cameraId,
      propertyId: 'transform.scaleY',
      defaultEasing: 'linear',
      keyframes: [{ id: 'camera-scale-y-start', time: 0, value: 1 }],
    })
    api.setTrack({
      id: 'camera-z',
      nodeId: cameraId,
      propertyId: 'transform.z',
      defaultEasing: 'linear',
      keyframes: [{ id: 'camera-z-start', time: 0, value: 0 }],
    })
    api.setTrack({
      id: 'title-opacity',
      nodeId: textId,
      propertyId: 'appearance.opacity',
      defaultEasing: 'linear',
      keyframes: [{ id: 'title-opacity-start', time: 0, value: 1 }],
    })

    const groups = collectTimelineTrackGroups(api)

    expect(groups.map((group) => group.nodeId)).toEqual([
      cameraId,
      textId,
    ])
    expect(groups[0]?.tracks.map((track) => track.id)).toEqual(['camera-z'])
    expect(new Set(groups.map((group) => group.nodeId)).size).toBe(
      groups.length,
    )
  })

  it('describes only an owned visible camera with no usable tracks', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { name: 'Artboard' })
    const project = getProjectAPI(api)
    project.ensureInitialized()
    const camera1 = api.getDefaultCameraId()
    if (!camera1) throw new Error('Expected the seeded camera')
    const camera2 = addCamera(api)
    const camera1Node = api.getNode(camera1)
    const camera2Node = api.getNode(camera2)
    if (camera1Node?.kind !== 'camera' || camera2Node?.kind !== 'camera') {
      throw new Error('Expected owned cameras')
    }

    expect(resolveTimelineCameraTrackPlaceholder(api, camera1)).toEqual({
      nodeId: camera1,
      nodeName: camera1Node.name,
    })
    expect(resolveTimelineCameraTrackPlaceholder(api, camera2)).toEqual({
      nodeId: camera2,
      nodeName: camera2Node.name,
    })

    api.setTrack({
      id: 'legacy-camera-scale-y',
      nodeId: camera1,
      propertyId: 'transform.scaleY',
      defaultEasing: 'linear',
      keyframes: [{ id: 'legacy-camera-scale-y-start', time: 0, value: 1 }],
    })
    expect(resolveTimelineCameraTrackPlaceholder(api, camera1)).toEqual({
      nodeId: camera1,
      nodeName: camera1Node.name,
    })

    api.setTrack({
      id: 'camera-1-x',
      nodeId: camera1,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [{ id: 'camera-1-x-start', time: 0, value: 0 }],
    })
    expect(resolveTimelineCameraTrackPlaceholder(api, camera1)).toBeNull()

    const unownedCamera = api.createNode('camera', null, {
      name: 'Unowned camera',
    })
    expect(
      resolveTimelineCameraTrackPlaceholder(api, unownedCamera),
    ).toBeNull()
    expect(resolveTimelineCameraTrackPlaceholder(api, null)).toBeNull()
  })

  it('keeps every camera group available while Program follows cuts', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { name: 'Artboard' })
    const project = getProjectAPI(api)
    project.ensureInitialized()
    const camera1 = api.getDefaultCameraId()
    if (!camera1) throw new Error('Expected the seeded camera')
    const camera2 = addCamera(api)
    api.setDefaultCameraId(camera1)
    const titleId = api.createNode('text', rootId, {
      name: 'Title',
      text: 'Title',
    })

    api.setTrack({
      id: 'camera-1-x',
      nodeId: camera1,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'camera-1-x-start', time: 0, value: 100 },
        { id: 'camera-1-x-end', time: 2, value: 300 },
      ],
    })
    api.setTrack({
      id: 'camera-2-z',
      nodeId: camera2,
      propertyId: 'transform.z',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'camera-2-z-start', time: 0, value: 0 },
        { id: 'camera-2-z-end', time: 2, value: 240 },
      ],
    })
    api.setTrack({
      id: 'title-opacity',
      nodeId: titleId,
      propertyId: 'appearance.opacity',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'title-opacity-start', time: 0, value: 0 },
        { id: 'title-opacity-end', time: 1, value: 1 },
      ],
    })

    const activeScene = project.getActiveScene()
    if (!activeScene) throw new Error('Expected the active scene')
    project.upsertCameraCut(activeScene.id, {
      id: 'detail',
      time: 1,
      cameraId: camera2,
    })
    const cutScene = project.getActiveScene()
    if (!cutScene) throw new Error('Expected the active scene after cut')
    const cameras = cutScene.cameraIds.map((cameraId) => {
      const camera = api.getNode(cameraId)
      return {
        id: cameraId,
        enabled: camera?.kind === 'camera' ? camera.enabled : false,
      }
    })
    const visibleCameraAt = (localTime: number) =>
      resolveProgramCameraPreviewId({
        scene: cutScene,
        localTime,
        frameRate: api.getMeta().frameRate,
        cameras,
        fallbackCameraId: api.getDefaultCameraId(),
        previewScope: 'scene',
        editorView: { mode: 'program' },
      })

    expect(visibleCameraAt(1 - 1 / api.getMeta().frameRate)).toBe(camera1)
    expect(visibleCameraAt(1)).toBe(camera2)

    const groups = collectTimelineTrackGroups(api)
    expect(groups.map((group) => group.nodeId)).toEqual([
      camera1,
      camera2,
      titleId,
    ])
    expect(groups[0]?.tracks[0]?.keyframes.map((keyframe) => keyframe.id))
      .toEqual(['camera-1-x-start', 'camera-1-x-end'])
    expect(groups[1]?.tracks[0]?.keyframes.map((keyframe) => keyframe.id))
      .toEqual(['camera-2-z-start', 'camera-2-z-end'])
  })

  it('can include empty owned cameras without adding empty scene layers', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { name: 'Artboard' })
    const project = getProjectAPI(api)
    project.ensureInitialized()
    const camera1 = api.getDefaultCameraId()
    if (!camera1) throw new Error('Expected the seeded camera')
    const camera2 = addCamera(api)
    api.setDefaultCameraId(camera1)
    api.createNode('text', rootId, {
      name: 'Unanimated title',
      text: 'Title',
    })

    expect(collectTimelineTrackGroups(api)).toEqual([])
    expect(
      collectTimelineTrackGroups(api, {
        includeEmptyCameras: true,
      }).map((group) => ({
        nodeId: group.nodeId,
        nodeKind: group.nodeKind,
        tracks: group.tracks,
      })),
    ).toEqual([
      { nodeId: camera1, nodeKind: 'camera', tracks: [] },
      { nodeId: camera2, nodeKind: 'camera', tracks: [] },
    ])
  })

  it('shows scene-root animation tracks without adding an empty root row', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { name: 'Scene' })

    expect(collectTimelineTrackGroups(api)).toEqual([])

    api.setTrack({
      id: 'scene-fill',
      nodeId: rootId,
      propertyId: 'appearance.fill',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'scene-fill-start', time: 0, value: 'oklch(0.9 0.04 250)' },
        { id: 'scene-fill-end', time: 1, value: 'oklch(0.3 0.12 250)' },
      ],
    })

    expect(collectTimelineTrackGroups(api)).toEqual([
      expect.objectContaining({
        nodeId: rootId,
        nodeName: 'Scene',
        nodeKind: 'frame',
        tracks: [expect.objectContaining({ id: 'scene-fill' })],
      }),
    ])
  })
})
