// SPDX-License-Identifier: Apache-2.0

import {
  normalizeCameraCuts,
  resolveProgramCamera,
  type CameraCut,
  type CameraId,
  type CompositionScene,
  type ProgramCameraDescriptor,
} from '@/sequence'
import {
  cameraCutsAtPlayhead,
  planCameraCutUpsert,
  planRedundantCameraCutCleanup,
} from '@/ui/CameraCutBar.helpers'

export interface CameraRowIndicators {
  isDefault: boolean
  isProgramNow: boolean
}

/**
 * Layers only communicates authored default and playhead-resolved Program.
 * Editor-only camera viewing is an advanced control that lives in Properties.
 */
export function resolveCameraRowIndicators(
  cameraId: CameraId,
  defaultCameraId: CameraId | null,
  programCameraId: CameraId | null,
): CameraRowIndicators {
  return {
    isDefault: cameraId === defaultCameraId,
    isProgramNow: cameraId === programCameraId,
  }
}

export interface CameraRowProgramSwitchPlan {
  /** Set only when frame zero should be represented by the scene default. */
  setDefaultCameraId: CameraId | null
  /** Add or replace this cut. Null at frame zero and for a no-op click. */
  cut: CameraCut | null
  /** Same-frame collisions and newly redundant cuts removed atomically. */
  removeCutIds: string[]
  changed: boolean
}

/**
 * Plan the simple Layers camera interaction.
 *
 * Frame zero is expressed as the scene default instead of a special cut at
 * 0s. Later clicks replace the cut on that frame or create one. After a real
 * edit, redundant same-camera cuts are removed so the timeline reads as the
 * actual sequence rather than "Camera 2 → Camera 2 → Camera 2".
 */
export function planCameraRowProgramSwitch(input: {
  scene: CompositionScene
  playhead: number
  frameRate: number
  cameras: readonly ProgramCameraDescriptor[]
  targetCameraId: CameraId
  fallbackCameraId?: CameraId | null
  createId: () => string
}): CameraRowProgramSwitchPlan | null {
  const target = input.cameras.find(
    (camera) => camera.id === input.targetCameraId,
  )
  if (
    !target ||
    target.enabled === false ||
    !input.scene.cameraIds.includes(input.targetCameraId)
  ) {
    return null
  }

  const cutsHere = cameraCutsAtPlayhead(
    input.scene.cameraCuts,
    input.playhead,
    input.scene.duration,
    input.frameRate,
  )
  const atFrameZero = cutsHere.some((cut) => cut.time === 0) ||
    quantizedPlayhead(input) === 0

  if (atFrameZero) {
    const cutsAtZero = normalizeCameraCuts(input.scene.cameraCuts, {
      duration: input.scene.duration,
      frameRate: input.frameRate,
    }).filter((cut) => cut.time === 0)
    const shouldSetDefault =
      input.scene.defaultCameraId !== input.targetCameraId
    const changed = shouldSetDefault || cutsAtZero.length > 0
    if (!changed) {
      return {
        setDefaultCameraId: null,
        cut: null,
        removeCutIds: [],
        changed: false,
      }
    }

    const zeroCutIds = new Set(cutsAtZero.map((cut) => cut.id))
    const sceneAfterInitialCamera: CompositionScene = {
      ...input.scene,
      defaultCameraId: input.targetCameraId,
      cameraCuts: Object.fromEntries(
        normalizeCameraCuts(input.scene.cameraCuts, {
          duration: input.scene.duration,
          frameRate: input.frameRate,
        })
          .filter((cut) => !zeroCutIds.has(cut.id))
          .map((cut) => [cut.id, cut]),
      ),
    }
    const cleanup = planRedundantCameraCutCleanup({
      scene: sceneAfterInitialCamera,
      frameRate: input.frameRate,
      cameras: input.cameras,
      fallbackCameraId: input.fallbackCameraId,
    })

    return {
      setDefaultCameraId: shouldSetDefault
        ? input.targetCameraId
        : null,
      cut: null,
      removeCutIds: uniqueIds([
        ...zeroCutIds,
        ...cleanup.removeCutIds,
      ]),
      changed: true,
    }
  }

  const currentCameraId = resolveProgramCamera({
    scene: input.scene,
    localTime: input.playhead,
    frameRate: input.frameRate,
    cameras: input.cameras,
    fallbackCameraId: input.fallbackCameraId,
  }).cameraId
  if (currentCameraId === input.targetCameraId) {
    return {
      setDefaultCameraId: null,
      cut: null,
      removeCutIds: [],
      changed: false,
    }
  }

  const upsert = planCameraCutUpsert({
    cuts: input.scene.cameraCuts,
    playhead: input.playhead,
    duration: input.scene.duration,
    frameRate: input.frameRate,
    cameraId: input.targetCameraId,
    createId: input.createId,
  })
  const replacedCutIds = new Set(upsert.removeCutIds)
  const prospectiveScene: CompositionScene = {
    ...input.scene,
    cameraCuts: {
      ...Object.fromEntries(
        normalizeCameraCuts(input.scene.cameraCuts, {
          duration: input.scene.duration,
          frameRate: input.frameRate,
        })
          .filter(
            (cut) =>
              cut.id !== upsert.cut.id &&
              !replacedCutIds.has(cut.id),
          )
          .map((cut) => [cut.id, cut]),
      ),
      [upsert.cut.id]: upsert.cut,
    },
  }
  const cleanup = planRedundantCameraCutCleanup({
    scene: prospectiveScene,
    frameRate: input.frameRate,
    cameras: input.cameras,
    fallbackCameraId: input.fallbackCameraId,
  })
  const replacementBecomesRedundant = cleanup.removeCutIds.includes(
    upsert.cut.id,
  )

  return {
    setDefaultCameraId: null,
    cut: replacementBecomesRedundant ? null : upsert.cut,
    removeCutIds: uniqueIds([
      ...upsert.removeCutIds,
      ...cleanup.removeCutIds,
    ]),
    changed: true,
  }
}

function quantizedPlayhead(input: {
  playhead: number
  frameRate: number
  scene: CompositionScene
}): number {
  const frameRate =
    Number.isFinite(input.frameRate) && input.frameRate > 0
      ? input.frameRate
      : 60
  const duration =
    Number.isFinite(input.scene.duration) && input.scene.duration > 0
      ? input.scene.duration
      : 0
  const playhead = Number.isFinite(input.playhead) ? input.playhead : 0
  return Math.min(
    duration,
    Math.max(0, Math.round(playhead * frameRate) / frameRate),
  )
}

function uniqueIds(ids: Iterable<string>): string[] {
  return Array.from(new Set(ids))
}
