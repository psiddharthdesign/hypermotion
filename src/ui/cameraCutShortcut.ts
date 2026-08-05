// SPDX-License-Identifier: Apache-2.0

import { resolveProgramCamera } from '@/sequence'
import type {
  CameraId,
  CompositionScene,
  ProgramCameraDescriptor,
} from '@/sequence'
import type { TimelineScope } from '@/state/ui'
import {
  planCameraCutUpsert,
  type CameraCutUpsertPlan,
} from '@/ui/CameraCutBar.helpers'

export interface CameraCutShortcutInput {
  timelineScope: TimelineScope
  scene: CompositionScene | null
  playhead: number
  frameRate: number
  cameras: readonly ProgramCameraDescriptor[]
  fallbackCameraId?: CameraId | null
  createId: () => string
}

/**
 * Plan Cmd/Ctrl+B without touching editor or project state.
 *
 * The command always cuts to the next enabled owned camera after current
 * Program output, wrapping in composition ownership order. Keeping layer
 * selection out of this decision makes repeated Cmd/Ctrl+B presses predictable:
 * with two cameras they simply alternate, while explicit targeting remains
 * available in Properties for larger camera sets.
 */
export function planCameraCutShortcut(
  input: CameraCutShortcutInput,
): CameraCutUpsertPlan | null {
  if (input.timelineScope !== 'scene' || !input.scene) return null

  const cameraById = new Map<CameraId, ProgramCameraDescriptor>()
  for (const camera of input.cameras) {
    if (!cameraById.has(camera.id)) cameraById.set(camera.id, camera)
  }
  const usableCameraIds = input.scene.cameraIds.filter((cameraId) => {
    const camera = cameraById.get(cameraId)
    return camera !== undefined && camera.enabled !== false
  })
  if (usableCameraIds.length < 2) return null

  const currentCameraId = resolveProgramCamera({
    scene: input.scene,
    localTime: input.playhead,
    frameRate: input.frameRate,
    cameras: input.cameras,
    fallbackCameraId: input.fallbackCameraId,
  }).cameraId

  const currentIndex = currentCameraId
    ? usableCameraIds.indexOf(currentCameraId)
    : -1
  const targetCameraId =
    usableCameraIds[(currentIndex + 1) % usableCameraIds.length]!

  return planCameraCutUpsert({
    cuts: input.scene.cameraCuts,
    playhead: input.playhead,
    duration: input.scene.duration,
    frameRate: input.frameRate,
    cameraId: targetCameraId,
    createId: input.createId,
  })
}
