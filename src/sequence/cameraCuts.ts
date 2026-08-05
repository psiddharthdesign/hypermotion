// SPDX-License-Identifier: Apache-2.0

import {
  clampSceneLocalTime,
  normalizeFrameRate,
  quantizeTimeToFrame,
} from './timeMap'
import type {
  CameraCut,
  CameraCutCollection,
  CameraId,
  FrameRounding,
  ProgramCameraDescriptor,
  ProgramCameraResolution,
  ResolveProgramCameraInput,
} from './types'

const TIME_EPSILON = 1e-9

export interface NormalizeCameraCutsOptions {
  duration: number
  frameRate?: number
  rounding?: FrameRounding
}

/**
 * Return valid cuts in deterministic program order.
 *
 * Equal-time cuts are ordered by id, so the lexicographically greatest id is
 * the winner. This remains stable when Yjs map iteration order differs across
 * clients.
 */
export function orderedCameraCuts(
  cuts: CameraCutCollection,
): CameraCut[] {
  return cameraCutValues(cuts)
    .filter(isUsableCutShape)
    .sort(compareCameraCuts)
}

/**
 * Clamp cuts to a composition and optionally snap them to its timebase.
 *
 * The returned cuts are new values; caller-owned persistence objects are never
 * mutated.
 */
export function normalizeCameraCuts(
  cuts: CameraCutCollection,
  options: NormalizeCameraCutsOptions,
): CameraCut[] {
  const duration = Number.isFinite(options.duration) && options.duration > 0
    ? options.duration
    : 0
  const frameRate = options.frameRate === undefined
    ? null
    : normalizeFrameRate(options.frameRate)
  const rounding = options.rounding ?? 'nearest'

  return orderedCameraCuts(cuts)
    .map((cut) => {
      const clampedTime = clamp(cut.time, 0, duration)
      const time = frameRate === null
        ? clampedTime
        : clamp(
          quantizeTimeToFrame(clampedTime, frameRate, rounding),
          0,
          quantizeTimeToFrame(duration, frameRate, rounding),
        )
      return { ...cut, time }
    })
    .sort(compareCameraCuts)
}

/** Resolve the latest authored cut at or before local composition time. */
export function resolveCameraCut(
  cuts: CameraCutCollection,
  localTime: number,
): CameraCut | null {
  const time = Number.isFinite(localTime) ? localTime : 0
  const ordered = orderedCameraCuts(cuts)
  for (let index = ordered.length - 1; index >= 0; index--) {
    const cut = ordered[index]!
    if (cut.time <= time + TIME_EPSILON) return cut
  }
  return null
}

/**
 * Resolve the camera that should render the program output.
 *
 * Resolution order:
 * 1. Latest usable cut at or before local time.
 * 2. Earlier usable cut (protects playback from stale/deleted cut targets).
 * 3. Scene default camera.
 * 4. Adapter-provided fallback camera.
 * 5. First enabled owned camera.
 * 6. Null, which tells the renderer to use its identity-camera fallback.
 */
export function resolveProgramCamera(
  input: ResolveProgramCameraInput,
): ProgramCameraResolution {
  const localTime = clampSceneLocalTime(
    input.scene,
    input.localTime,
    input.frameRate,
  )
  const cuts = normalizeCameraCuts(input.scene.cameraCuts, {
    duration: input.scene.duration,
    frameRate: input.frameRate,
  })
  const requestedCut = latestCutAtOrBefore(cuts, localTime)
  const ownedCameraIds = new Set(input.scene.cameraIds)
  const cameraById = indexCameras(input.cameras)
  const candidateCuts = cuts
    .filter((cut) => cut.time <= localTime + TIME_EPSILON)
    .reverse()

  for (const cut of candidateCuts) {
    if (isAvailableOwnedCamera(cut.cameraId, ownedCameraIds, cameraById)) {
      return {
        cameraId: cut.cameraId,
        source: cut.id === requestedCut?.id ? 'cut' : 'earlier-cut',
        requestedCut,
        resolvedCut: cut,
        requestedCutFailure: requestedCutFailure(
          requestedCut,
          ownedCameraIds,
          cameraById,
        ),
      }
    }
  }

  if (
    input.scene.defaultCameraId !== null &&
    isAvailableOwnedCamera(
      input.scene.defaultCameraId,
      ownedCameraIds,
      cameraById,
    )
  ) {
    return {
      cameraId: input.scene.defaultCameraId,
      source: 'default',
      requestedCut,
      resolvedCut: null,
      requestedCutFailure: requestedCutFailure(
        requestedCut,
        ownedCameraIds,
        cameraById,
      ),
    }
  }

  if (
    input.fallbackCameraId != null &&
    isAvailableOwnedCamera(
      input.fallbackCameraId,
      ownedCameraIds,
      cameraById,
    )
  ) {
    return {
      cameraId: input.fallbackCameraId,
      source: 'fallback',
      requestedCut,
      resolvedCut: null,
      requestedCutFailure: requestedCutFailure(
        requestedCut,
        ownedCameraIds,
        cameraById,
      ),
    }
  }

  for (const cameraId of input.scene.cameraIds) {
    if (isAvailableOwnedCamera(cameraId, ownedCameraIds, cameraById)) {
      return {
        cameraId,
        source: 'first-enabled',
        requestedCut,
        resolvedCut: null,
        requestedCutFailure: requestedCutFailure(
          requestedCut,
          ownedCameraIds,
          cameraById,
        ),
      }
    }
  }

  return {
    cameraId: null,
    source: 'none',
    requestedCut,
    resolvedCut: null,
    requestedCutFailure: requestedCutFailure(
      requestedCut,
      ownedCameraIds,
      cameraById,
    ),
  }
}

function cameraCutValues(cuts: CameraCutCollection): CameraCut[] {
  return Array.isArray(cuts)
    ? [...cuts]
    : Object.values(cuts)
}

function latestCutAtOrBefore(
  cuts: readonly CameraCut[],
  localTime: number,
): CameraCut | null {
  for (let index = cuts.length - 1; index >= 0; index--) {
    const cut = cuts[index]!
    if (cut.time <= localTime + TIME_EPSILON) return cut
  }
  return null
}

function indexCameras(
  cameras: readonly ProgramCameraDescriptor[],
): Map<CameraId, ProgramCameraDescriptor> {
  const result = new Map<CameraId, ProgramCameraDescriptor>()
  for (const camera of cameras) {
    if (!result.has(camera.id)) result.set(camera.id, camera)
  }
  return result
}

function isAvailableOwnedCamera(
  cameraId: CameraId,
  ownedCameraIds: ReadonlySet<CameraId>,
  cameraById: ReadonlyMap<CameraId, ProgramCameraDescriptor>,
): boolean {
  if (!ownedCameraIds.has(cameraId)) return false
  const camera = cameraById.get(cameraId)
  return camera !== undefined && camera.enabled !== false
}

function requestedCutFailure(
  requestedCut: CameraCut | null,
  ownedCameraIds: ReadonlySet<CameraId>,
  cameraById: ReadonlyMap<CameraId, ProgramCameraDescriptor>,
): ProgramCameraResolution['requestedCutFailure'] {
  if (!requestedCut) return null
  if (!ownedCameraIds.has(requestedCut.cameraId)) return 'not-owned'
  const camera = cameraById.get(requestedCut.cameraId)
  if (!camera) return 'missing'
  return camera.enabled === false ? 'disabled' : null
}

function isUsableCutShape(cut: CameraCut): boolean {
  return (
    typeof cut.id === 'string' &&
    cut.id.trim().length > 0 &&
    typeof cut.cameraId === 'string' &&
    cut.cameraId.trim().length > 0 &&
    Number.isFinite(cut.time)
  )
}

function compareCameraCuts(left: CameraCut, right: CameraCut): number {
  if (left.time !== right.time) return left.time - right.time
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
