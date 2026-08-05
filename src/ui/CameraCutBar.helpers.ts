// SPDX-License-Identifier: Apache-2.0

import {
  normalizeCameraCuts,
  quantizeTimeToFrame,
  resolveProgramCamera,
  type CameraCut,
  type CameraCutCollection,
  type CameraId,
  type CompositionScene,
  type ProgramCameraDescriptor,
} from '@/sequence'

export interface CameraCutUpsertPlan {
  cut: CameraCut
  /** Same-frame duplicates to remove before writing `cut`. */
  removeCutIds: string[]
  replaced: boolean
}

export interface CameraCutUpsertActions {
  removeCut: (cutId: string) => void
  upsertCut: (cut: CameraCut) => void
  /** Reveal authored program output after the edit is safely persisted. */
  revealProgramOutput: () => void
}

export interface CameraCutDragPlan {
  /** The dragged cut keeps its identity while its frame changes. */
  cut: CameraCut
  /** Existing cuts displaced from the destination frame. */
  removeCutIds: string[]
  /** Collision-free cuts used for the reversible lane preview. */
  previewCuts: CameraCut[]
  changed: boolean
}

export interface CameraCutCleanupPlan {
  /**
   * Cuts that cannot change Program output in the current camera graph.
   *
   * This includes deterministic same-frame losers and a winning cut whose
   * usable target is already on Program immediately before its frame.
   */
  removeCutIds: string[]
  changed: boolean
}

/**
 * Choose the camera shown in the Properties cut-target select.
 *
 * Existing same-frame cuts keep their authored target so replacement is
 * predictable. A new cut instead advances to the next enabled owned camera;
 * defaulting to the camera already on Program authors a marker with no visible
 * switch, which is especially confusing when two cameras are present.
 */
export function suggestCameraCutTarget(input: {
  cameras: readonly ProgramCameraDescriptor[]
  currentCameraId?: CameraId | null
  existingCutCameraId?: CameraId | null
  preferredCameraId?: CameraId | null
}): CameraId | null {
  const ownedCameraIds = new Set(input.cameras.map((camera) => camera.id))
  if (
    input.preferredCameraId &&
    ownedCameraIds.has(input.preferredCameraId)
  ) {
    return input.preferredCameraId
  }
  if (
    input.existingCutCameraId &&
    ownedCameraIds.has(input.existingCutCameraId)
  ) {
    return input.existingCutCameraId
  }

  const enabledCameraIds = input.cameras
    .filter((camera) => camera.enabled !== false)
    .map((camera) => camera.id)
  if (enabledCameraIds.length === 0) return null

  const currentIndex = input.currentCameraId
    ? enabledCameraIds.indexOf(input.currentCameraId)
    : -1
  if (currentIndex < 0) return enabledCameraIds[0]!
  return enabledCameraIds[(currentIndex + 1) % enabledCameraIds.length]!
}

/**
 * Whether assigning `targetCameraId` at this frame changes Program output.
 *
 * Same-frame cuts are removed for the comparison so replacement is measured
 * against the camera entering the frame, including a cut at time zero.
 */
export function cameraCutChangesProgram(input: {
  scene: CompositionScene
  playhead: number
  frameRate: number
  cameras: readonly ProgramCameraDescriptor[]
  targetCameraId: CameraId
  fallbackCameraId?: CameraId | null
}): boolean {
  const target = input.cameras.find(
    (camera) => camera.id === input.targetCameraId,
  )
  if (!target || target.enabled === false) return false

  const cutsHere = cameraCutsAtPlayhead(
    input.scene.cameraCuts,
    input.playhead,
    input.scene.duration,
    input.frameRate,
  )
  const replacedIds = new Set(cutsHere.map((cut) => cut.id))
  const comparisonScene: CompositionScene = {
    ...input.scene,
    cameraCuts: Object.fromEntries(
      normalizeCameraCuts(input.scene.cameraCuts, {
        duration: input.scene.duration,
        frameRate: input.frameRate,
      })
        .filter((cut) => !replacedIds.has(cut.id))
        .map((cut) => [cut.id, cut]),
    ),
  }
  const cameraBeforeFrame = resolveProgramCamera({
    scene: comparisonScene,
    localTime: input.playhead,
    frameRate: input.frameRate,
    cameras: input.cameras,
    fallbackCameraId: input.fallbackCameraId,
  }).cameraId

  return cameraBeforeFrame !== input.targetCameraId
}

/**
 * Persist one add/replace plan and reveal the authored result.
 *
 * Keeping this order explicit matters when the editor is fixed to an
 * individual camera: the program view should only change after the cut exists,
 * so the canvas never flashes an intermediate program state.
 */
export function commitCameraCutUpsert(
  plan: CameraCutUpsertPlan,
  actions: CameraCutUpsertActions,
): void {
  for (const cutId of plan.removeCutIds) actions.removeCut(cutId)
  actions.upsertCut(plan.cut)
  actions.revealProgramOutput()
}

/**
 * Retime one existing cut without authoring anything during pointer movement.
 *
 * The dragged cut deterministically owns its destination frame. Any other cut
 * quantized to that frame is omitted from preview and returned for removal on
 * commit, which prevents stacked diamonds and ambiguous program resolution.
 */
export function planCameraCutDrag(input: {
  cuts: CameraCutCollection
  cutId: string
  time: number
  duration: number
  frameRate: number
}): CameraCutDragPlan | null {
  const cuts = normalizeCameraCuts(input.cuts, {
    duration: input.duration,
    frameRate: input.frameRate,
  })
  const source = cuts.find((cut) => cut.id === input.cutId)
  if (!source) return null

  const time = sceneDragFrameTime(
    input.time,
    input.duration,
    input.frameRate,
  )
  const conflicts = cuts.filter(
    (cut) => cut.id !== source.id && cut.time === time,
  )
  const conflictingIds = new Set(conflicts.map((cut) => cut.id))
  const cut = { ...source, time }
  const previewCuts = normalizeCameraCuts(
    [
      ...cuts.filter(
        (candidate) =>
          candidate.id !== source.id && !conflictingIds.has(candidate.id),
      ),
      cut,
    ],
    {
      duration: input.duration,
      frameRate: input.frameRate,
    },
  )

  return {
    cut,
    removeCutIds: conflicts.map((conflict) => conflict.id),
    previewCuts,
    changed: cut.time !== source.time || conflicts.length > 0,
  }
}

/**
 * Find camera cuts that can be removed without changing current Program output.
 *
 * This is intentionally a pure, opt-in edit plan. Persisted authoring data is
 * never normalized away during reads, and a caller can apply every removal in
 * one undoable transaction. Invalid/stale winning targets are retained because
 * they may represent recoverable authoring intent; only a usable same-camera
 * winner is considered redundant.
 */
export function planRedundantCameraCutCleanup(input: {
  scene: CompositionScene
  frameRate: number
  cameras: readonly ProgramCameraDescriptor[]
  fallbackCameraId?: CameraId | null
}): CameraCutCleanupPlan {
  const cuts = normalizeCameraCuts(input.scene.cameraCuts, {
    duration: input.scene.duration,
    frameRate: input.frameRate,
  })
  const removeCutIds: string[] = []

  for (let index = 0; index < cuts.length;) {
    const time = cuts[index]!.time
    let groupEnd = index + 1
    while (groupEnd < cuts.length && cuts[groupEnd]!.time === time) {
      groupEnd += 1
    }

    const sameFrameCuts = cuts.slice(index, groupEnd)
    const winner = sameFrameCuts.at(-1)!
    removeCutIds.push(
      ...sameFrameCuts.slice(0, -1).map((cut) => cut.id),
    )

    const sameFrameIds = new Set(sameFrameCuts.map((cut) => cut.id))
    const sceneBeforeFrame: CompositionScene = {
      ...input.scene,
      cameraCuts: Object.fromEntries(
        cuts
          .filter((cut) => !sameFrameIds.has(cut.id))
          .map((cut) => [cut.id, cut]),
      ),
    }
    const before = resolveProgramCamera({
      scene: sceneBeforeFrame,
      localTime: time,
      frameRate: input.frameRate,
      cameras: input.cameras,
      fallbackCameraId: input.fallbackCameraId,
    })
    const after = resolveProgramCamera({
      scene: input.scene,
      localTime: time,
      frameRate: input.frameRate,
      cameras: input.cameras,
      fallbackCameraId: input.fallbackCameraId,
    })

    if (
      after.requestedCut?.id === winner.id &&
      after.requestedCutFailure === null &&
      before.cameraId === after.cameraId
    ) {
      removeCutIds.push(winner.id)
    }

    index = groupEnd
  }

  return {
    removeCutIds,
    changed: removeCutIds.length > 0,
  }
}

export interface CameraProgramSegment {
  /** Stable enough for React keys; not persisted. */
  id: string
  cameraId: CameraId | null
  /** Scene-local inclusive start. */
  start: number
  /** Scene-local exclusive end. */
  end: number
  /** Authored cut driving this span, or null while the default is active. */
  sourceCutId: string | null
}

/**
 * Resolve the program output into contiguous timeline spans.
 *
 * The cut markers and the keyframe ruler share one coordinate system, while
 * the spans make it possible to read which camera owns the interval between
 * cuts. Invalid or disabled targets follow the same fallback rules as render;
 * they therefore never paint a misleading camera span.
 */
export function cameraProgramSegments(input: {
  scene: CompositionScene
  frameRate: number
  cameras: readonly ProgramCameraDescriptor[]
  fallbackCameraId?: CameraId | null
}): CameraProgramSegment[] {
  const duration =
    Number.isFinite(input.scene.duration) && input.scene.duration > 0
      ? input.scene.duration
      : 0
  if (duration === 0) return []

  const cuts = normalizeCameraCuts(input.scene.cameraCuts, {
    duration,
    frameRate: input.frameRate,
  })
  const boundaries = Array.from(
    new Set([
      0,
      ...cuts
        .map((cut) => cut.time)
        .filter((time) => time > 0 && time < duration),
      duration,
    ]),
  ).sort((left, right) => left - right)

  const segments: CameraProgramSegment[] = []
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]!
    const end = boundaries[index + 1]!
    if (end <= start) continue
    const program = resolveProgramCamera({
      scene: input.scene,
      localTime: start,
      frameRate: input.frameRate,
      cameras: input.cameras,
      fallbackCameraId: input.fallbackCameraId,
    })
    const sourceCutId = program.resolvedCut?.id ?? null
    const previous = segments.at(-1)
    if (
      previous &&
      previous.end === start &&
      previous.cameraId === program.cameraId
    ) {
      previous.end = end
      continue
    }
    segments.push({
      id: `camera-program:${sourceCutId ?? 'default'}:${start}`,
      cameraId: program.cameraId,
      start,
      end,
      sourceCutId,
    })
  }
  return segments
}

/**
 * Find every cut that resolves to the playhead's frame.
 *
 * Cut authoring is frame-based even though persistence uses seconds. Treating
 * near-identical floating-point times as the same edit point prevents stacked
 * cuts that are impossible to distinguish in the timeline.
 */
export function cameraCutsAtPlayhead(
  cuts: CameraCutCollection,
  playhead: number,
  duration: number,
  frameRate: number,
): CameraCut[] {
  const targetTime = sceneFrameTime(playhead, duration, frameRate)
  return normalizeCameraCuts(cuts, { duration, frameRate }).filter(
    (cut) => cut.time === targetTime,
  )
}

/** Build a deterministic add-or-replace edit for one playhead frame. */
export function planCameraCutUpsert(input: {
  cuts: CameraCutCollection
  playhead: number
  duration: number
  frameRate: number
  cameraId: string
  createId: () => string
}): CameraCutUpsertPlan {
  const matches = cameraCutsAtPlayhead(
    input.cuts,
    input.playhead,
    input.duration,
    input.frameRate,
  )
  // normalizeCameraCuts uses (time, id), so the last same-frame cut is the
  // deterministic winner used by program-camera resolution.
  const existing = matches.at(-1)
  return {
    cut: {
      id: existing?.id ?? input.createId(),
      time: sceneFrameTime(input.playhead, input.duration, input.frameRate),
      cameraId: input.cameraId,
    },
    removeCutIds: matches.slice(0, -1).map((cut) => cut.id),
    replaced: matches.length > 0,
  }
}

function sceneFrameTime(
  time: number,
  duration: number,
  frameRate: number,
): number {
  const safeDuration =
    Number.isFinite(duration) && duration > 0 ? duration : 0
  const safeTime = Number.isFinite(time) ? time : 0
  return Math.min(
    safeDuration,
    Math.max(0, quantizeTimeToFrame(safeTime, frameRate)),
  )
}

/** Camera program spans are half-open, so a new boundary stops one frame shy. */
function sceneDragFrameTime(
  time: number,
  duration: number,
  frameRate: number,
): number {
  const safeDuration =
    Number.isFinite(duration) && duration > 0 ? duration : 0
  const lastFrame = quantizeTimeToFrame(
    Math.max(0, safeDuration - 1e-9),
    frameRate,
    'floor',
  )
  const safeTime = Number.isFinite(time) ? time : 0
  return Math.min(
    lastFrame,
    Math.max(0, quantizeTimeToFrame(safeTime, frameRate)),
  )
}
