// SPDX-License-Identifier: Apache-2.0

import { resolveProgramCamera } from '@/sequence'
import type {
  CameraId,
  ResolveProgramCameraInput,
} from '@/sequence'
import type { CameraView, PreviewScope } from '@/state/ui'

export interface ProgramCameraPreviewInput
  extends ResolveProgramCameraInput {
  previewScope: PreviewScope
  editorView?: CameraView | null
}

export interface ProgramCameraPreviewSnapshotInput
  extends Omit<ProgramCameraPreviewInput, 'localTime'> {
  readLocalTime: () => number
}

/**
 * Resolve the camera visible in the interactive editor preview.
 *
 * Program output always follows authored cuts. Scene preview may instead lock
 * to one valid owned camera as an authoring aid, while Master preview ignores
 * that editor-only preference so it stays identical to export.
 */
export function resolveProgramCameraPreviewId(
  input: ProgramCameraPreviewInput,
): CameraId | null {
  const programCameraId = resolveProgramCamera(input).cameraId
  if (
    input.previewScope !== 'scene' ||
    input.editorView?.mode !== 'camera'
  ) {
    return programCameraId
  }

  const lockedCameraId = input.editorView.cameraId
  const lockedCamera = input.cameras.find(
    (camera) => camera.id === lockedCameraId,
  )
  const validLockedCamera =
    input.scene.cameraIds.includes(lockedCameraId) &&
    lockedCamera !== undefined &&
    lockedCamera.enabled !== false

  return validLockedCamera ? lockedCameraId : programCameraId
}

/**
 * Build a `useSyncExternalStore`-compatible primitive snapshot getter.
 *
 * The returned camera id remains referentially stable between cuts because it
 * is a string (or null), while `readLocalTime` can follow a mutable transport
 * clock without allocating a new snapshot object on every animation frame.
 */
export function createProgramCameraPreviewSnapshot({
  readLocalTime,
  ...input
}: ProgramCameraPreviewSnapshotInput): () => CameraId | null {
  return () =>
    resolveProgramCameraPreviewId({
      ...input,
      localTime: readLocalTime(),
    })
}
