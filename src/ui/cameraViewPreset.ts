// SPDX-License-Identifier: Apache-2.0

import { addKeyframe, findKeyframeAt, findTrack, removeKeyframe } from '@/anim/tracks'
import { recordKeyframesForPatch, stampToActiveTracksForPatch } from '@/anim/recordKeyframes'
import type { SceneAPI } from '@/scene/doc'
import { DEFAULT_ISOMETRIC_CAMERA_VIEW_ID, ISOMETRIC_CAMERA_VIEWS, type IsometricCameraViewId } from '@/scene/cameraProjection'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export function applyIsometricCameraPreset(api: SceneAPI, cameraId: string, time: number, recording: boolean, viewId: IsometricCameraViewId = DEFAULT_ISOMETRIC_CAMERA_VIEW_ID): void {
  const camera = api.getNode(cameraId)
  if (camera?.kind !== 'camera' || camera.locked) return
  const rotation = ISOMETRIC_CAMERA_VIEWS.find(view => view.id === viewId)!.rotation
  api.doc.transact(() => {
    api.setNodeProperty(cameraId, 'projection', 'orthographic')
    api.setNodeProperty(cameraId, 'transform', { ...camera.transform, ...rotation })
    if (camera.projection !== 'orthographic' && camera.compositionGuide === 'none') api.setNodeProperty(cameraId, 'compositionGuide', 'isometric')
    const stamp = recording ? recordKeyframesForPatch : stampToActiveTracksForPatch
    stamp(api, cameraId, time, 'transform', rotation)
  }, UNDOABLE_GESTURE_ORIGIN)
}

export function cameraZoomScale(percent: number): number {
  return 100 / Math.max(1, Math.min(10000, Number.isFinite(percent) ? percent : 100))
}

// Camera zoom has one visible timeline track; legacy scaleY data is inactive.
export const CAMERA_ZOOM_PROPERTY = 'transform.scaleX' as const

export function toggleCameraZoomKeyframes(api: SceneAPI, cameraId: string, time: number, scale: number): void {
  const camera = api.getNode(cameraId)
  if (camera?.kind !== 'camera' || camera.locked) return
  const key = findKeyframeAt(api, cameraId, CAMERA_ZOOM_PROPERTY, time)
  api.doc.transact(() => {
    if (key) {
      const track = findTrack(api, cameraId, CAMERA_ZOOM_PROPERTY)!
      removeKeyframe(api, track.id, key.id)
    } else {
      addKeyframe(api, cameraId, CAMERA_ZOOM_PROPERTY, time, scale)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
}
