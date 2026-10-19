// SPDX-License-Identifier: Apache-2.0

import type { CameraNode, CameraProjectionPose } from '@/scene/types'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

function copy<T>(value: T): T {
  return structuredClone(value)
}

function currentPose(api: SceneAPI, camera: CameraNode): CameraProjectionPose {
  return {
    transform: copy(camera.transform),
    tracks: api.getTracksForNode(camera.id)
      .filter(track => track.propertyId.startsWith('transform.'))
      .map(track => copy(track)),
  }
}

/** Switch projection while preserving the independently authored camera pose and animation in each mode. */
export function switchCameraProjection(
  api: SceneAPI,
  cameraId: string,
  projection: 'perspective' | 'orthographic',
): void {
  const camera = api.getNode(cameraId)
  if (camera?.kind !== 'camera' || camera.locked) return
  const currentProjection = camera.projection === 'orthographic' ? 'orthographic' : 'perspective'
  if (currentProjection === projection) return

  api.doc.transact(() => {
    switchCameraProjectionInTransaction(api, cameraId, projection)
  }, UNDOABLE_GESTURE_ORIGIN)
}

/** Caller owns the transaction, allowing view presets to switch projection atomically. */
export function switchCameraProjectionInTransaction(
  api: SceneAPI,
  cameraId: string,
  projection: 'perspective' | 'orthographic',
): void {
  const camera = api.getNode(cameraId)
  if (camera?.kind !== 'camera' || camera.locked) return
  const currentProjection = camera.projection === 'orthographic' ? 'orthographic' : 'perspective'
  if (currentProjection === projection) return

  const poses = copy(camera.projectionPoses ?? {})
  poses[currentProjection] = currentPose(api, camera)
  const activeTracks = api.getTracksForNode(cameraId)
    .filter(track => track.propertyId.startsWith('transform.'))
  const targetPose = poses[projection]

  if (targetPose) {
    for (const track of activeTracks) api.deleteTrack(track.id)
    api.setNodeProperty(cameraId, 'transform', copy(targetPose.transform))
    for (const track of targetPose.tracks) api.setTrack(copy(track))
  }

  api.setNodeProperty(cameraId, 'projectionPoses', poses)
  api.setNodeProperty(cameraId, 'projection', projection as CameraNode['projection'])
}
