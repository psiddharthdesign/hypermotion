// SPDX-License-Identifier: Apache-2.0

import type { CameraNode, NodeId, Track } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { getProjectAPI } from '@/project/doc'

export interface DeleteCameraResult {
  deleted: boolean
  /** Active camera after the operation. */
  activeCameraId: NodeId | null
  reason?: 'missing' | 'last-camera'
}

/** Scene-level cameras in stable document insertion order. */
export function listSceneCameras(api: SceneAPI): CameraNode[] {
  const project = getProjectAPI(api)
  project.ensureInitialized()
  // Queries run during Layers/Timeline render, so they must stay read-only.
  // Camera mutations reconcile ownership in their action transaction, and
  // SceneNavigator provides an effect-based repair path for external edits.
  const composition = project.getActiveScene()
  if (composition) {
    return composition.cameraIds
      .map((id) => api.getNode(id))
      .filter((node): node is CameraNode => node?.kind === 'camera')
  }
  return api.getAllCameras().filter((camera) => camera.parent === null)
}

/** Scene cameras ordered for timeline display, with the default camera first. */
export function listTimelineCameras(api: SceneAPI): CameraNode[] {
  const defaultCameraId = api.getDefaultCameraId()
  return listSceneCameras(api).sort((a, b) => {
    if (a.id === defaultCameraId) return -1
    if (b.id === defaultCameraId) return 1
    return 0
  })
}

/** Persist the authored default on the active composition. */
export function setSceneDefaultCamera(
  api: SceneAPI,
  cameraId: NodeId,
): void {
  const project = getProjectAPI(api)
  project.ensureInitialized()
  const sceneId = project.getActiveSceneId()
  if (sceneId) project.setDefaultCamera(sceneId, cameraId)
  else api.setDefaultCameraId(cameraId)
}

/**
 * Add another camera without duplicating the active camera's animation.
 *
 * The static pose/lens of the current camera is the least surprising starting
 * point: switching to the new camera does not make the composition jump before
 * the user moves it. Tracks deliberately stay behind; "Duplicate" is the
 * explicit operation for cloning authored camera animation.
 */
export function addCamera(api: SceneAPI): NodeId {
  const source = api.getActiveCamera()
  const name = uniqueCameraName(api, 'Camera')
  let id = ''

  api.doc.transact(() => {
    id = api.createNode(
      'camera',
      null,
      source
        ? {
            ...cameraCreateProps(source),
            name,
            locked: false,
          }
        : {
            name,
            transform: centeredCameraTransform(api),
          },
    )
    setSceneDefaultCamera(api, id)
  }, UNDOABLE_GESTURE_ORIGIN)

  return id
}

/** Duplicate one camera, including all of its animation tracks. */
export function duplicateCamera(
  api: SceneAPI,
  cameraId: NodeId,
): NodeId | null {
  const source = api.getNode(cameraId)
  if (!source || source.kind !== 'camera' || source.parent !== null) return null

  const name = uniqueCameraName(api, `${source.name} copy`)
  let duplicateId = ''

  api.doc.transact(() => {
    duplicateId = api.createNode('camera', null, {
      ...cameraCreateProps(source),
      name,
      locked: false,
    })

    for (const track of api.getTracksForNode(source.id)) {
      const copy = cloneTrack(track)
      api.setTrack({
        ...copy,
        id: uniqueTrackId(api, `${track.id}_copy`),
        nodeId: duplicateId,
      })
    }
    getProjectAPI(api).reconcileSceneCameras()
  }, UNDOABLE_GESTURE_ORIGIN)

  return duplicateId
}

/**
 * Delete a camera while preserving the invariant that the scene keeps a valid
 * active camera. The final camera cannot be deleted.
 */
export function deleteCameraSafely(
  api: SceneAPI,
  cameraId: NodeId,
): DeleteCameraResult {
  const cameras = listSceneCameras(api)
  const index = cameras.findIndex((camera) => camera.id === cameraId)
  if (index < 0) {
    return {
      deleted: false,
      activeCameraId: api.getDefaultCameraId(),
      reason: 'missing',
    }
  }
  if (cameras.length <= 1) {
    return {
      deleted: false,
      activeCameraId: cameras[0]?.id ?? null,
      reason: 'last-camera',
    }
  }

  const currentActiveId = api.getDefaultCameraId()
  const project = getProjectAPI(api)
  const sceneId = project.getActiveSceneId()
  const fallback =
    cameras[index + 1] ??
    cameras[index - 1] ??
    cameras.find((camera) => camera.id !== cameraId)!

  api.doc.transact(() => {
    if (currentActiveId === cameraId) {
      if (sceneId) project.setDefaultCamera(sceneId, fallback.id)
      else api.setDefaultCameraId(fallback.id)
    }
    for (const track of api.getTracksForNode(cameraId)) {
      api.deleteTrack(track.id)
    }
    api.deleteNode(cameraId)
    if (sceneId) project.reconcileSceneCameras(sceneId)
  }, UNDOABLE_GESTURE_ORIGIN)

  return {
    deleted: true,
    activeCameraId:
      currentActiveId === cameraId ? fallback.id : currentActiveId,
  }
}

function cameraCreateProps(camera: CameraNode): Partial<CameraNode> {
  const copy = cloneValue(camera)
  const {
    id: _id,
    kind: _kind,
    parent: _parent,
    children: _children,
    ...props
  } = copy
  void _id
  void _kind
  void _parent
  void _children
  return props
}

function centeredCameraTransform(api: SceneAPI): CameraNode['transform'] {
  const canvas = api.getMeta().canvas ?? { width: 960, height: 540 }
  return {
    x: canvas.width / 2,
    y: canvas.height / 2,
    z: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
  }
}

function uniqueCameraName(api: SceneAPI, preferred: string): string {
  const names = new Set(listSceneCameras(api).map((camera) => camera.name))
  if (!names.has(preferred)) return preferred
  let suffix = 2
  while (names.has(`${preferred} ${suffix}`)) suffix++
  return `${preferred} ${suffix}`
}

function uniqueTrackId(api: SceneAPI, preferred: string): string {
  if (!api.getTrack(preferred)) return preferred
  let suffix = 2
  while (api.getTrack(`${preferred}_${suffix}`)) suffix++
  return `${preferred}_${suffix}`
}

function cloneTrack(track: Track): Track {
  return cloneValue(track)
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}
