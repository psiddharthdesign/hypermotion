// SPDX-License-Identifier: Apache-2.0

import type {
  BuildSequenceTimeMapInput,
  CompositionScene,
  FrameRounding,
  MasterTimeResolution,
  ResolveMasterTimeOptions,
  ResolvedSequenceItem,
  ResolvedSequenceLayer,
  ResolvedSequenceTransition,
  SequenceItem,
  SequenceTimeMap,
  SequenceTimeMapIssue,
} from './types'

const DEFAULT_FRAME_RATE = 60
const TIME_EPSILON = 1e-9

interface ItemTiming {
  item: SequenceItem
  scene: CompositionScene
  sourceIndex: number
  sequenceIndex: number
  sourceStartFrame: number
  sourceEndFrame: number
  durationFrames: number
}

/** Return a usable timebase while keeping this pure layer crash-safe. */
export function normalizeFrameRate(
  frameRate: number,
  fallback = DEFAULT_FRAME_RATE,
): number {
  const safeFallback = Number.isFinite(fallback) && fallback > 0
    ? fallback
    : DEFAULT_FRAME_RATE
  return Number.isFinite(frameRate) && frameRate > 0
    ? frameRate
    : safeFallback
}

/** Convert seconds to an integer frame number using an explicit policy. */
export function secondsToFrames(
  seconds: number,
  frameRate: number,
  rounding: FrameRounding = 'nearest',
): number {
  const value = Number.isFinite(seconds)
    ? seconds * normalizeFrameRate(frameRate)
    : 0
  if (rounding === 'floor') return Math.floor(value + TIME_EPSILON)
  if (rounding === 'ceil') return Math.ceil(value - TIME_EPSILON)
  return Math.round(value)
}

/** Convert an integer or fractional frame position to seconds. */
export function framesToSeconds(frames: number, frameRate: number): number {
  const safeFrames = Number.isFinite(frames) ? frames : 0
  return safeFrames / normalizeFrameRate(frameRate)
}

/** Snap an arbitrary time to the selected frame boundary. */
export function quantizeTimeToFrame(
  time: number,
  frameRate: number,
  rounding: FrameRounding = 'nearest',
): number {
  return framesToSeconds(
    secondsToFrames(time, frameRate, rounding),
    frameRate,
  )
}

/** Clamp a composition-local time and optionally snap it to a frame. */
export function clampSceneLocalTime(
  scene: Pick<CompositionScene, 'duration'>,
  localTime: number,
  frameRate?: number,
  rounding: FrameRounding = 'nearest',
): number {
  const duration = finitePositive(scene.duration)
  const sanitized = Number.isFinite(localTime) ? localTime : 0
  const clamped = clamp(sanitized, 0, duration)
  if (frameRate === undefined) return clamped
  return clamp(
    quantizeTimeToFrame(clamped, frameRate, rounding),
    0,
    quantizedPositiveDuration(duration, frameRate),
  )
}

/**
 * Build the canonical frame-aligned master-timeline map.
 *
 * Invalid collaborative state is reported and omitted instead of throwing.
 * The first occurrence of a duplicate id wins. Transition tails are clamped
 * sequentially so an item's incoming and outgoing overlaps never exceed its
 * visible duration; consequently at most two scenes are active at once.
 */
export function buildSequenceTimeMap(
  input: BuildSequenceTimeMapInput,
): SequenceTimeMap {
  const issues: SequenceTimeMapIssue[] = []
  const frameRate = normalizeFrameRate(input.frameRate)
  if (!Number.isFinite(input.frameRate) || input.frameRate <= 0) {
    issues.push({
      code: 'invalid-frame-rate',
      severity: 'warning',
      message: `Invalid frame rate ${String(input.frameRate)}; using ${frameRate}.`,
    })
  }

  const sceneById = indexScenes(input.scenes, issues)
  validateGlobalNodeReferences(input.scenes, issues)

  const seenItemIds = new Set<string>()
  const timings: ItemTiming[] = []
  for (let sourceIndex = 0; sourceIndex < input.items.length; sourceIndex++) {
    const item = input.items[sourceIndex]!
    if (!validId(item.id)) {
      issues.push({
        code: 'invalid-sequence-item-id',
        severity: 'error',
        message: `Sequence item at index ${sourceIndex} has an empty id.`,
      })
      continue
    }
    if (seenItemIds.has(item.id)) {
      issues.push({
        code: 'duplicate-sequence-item-id',
        severity: 'error',
        itemId: item.id,
        message: `Duplicate sequence item id "${item.id}"; keeping the first occurrence.`,
      })
      continue
    }
    seenItemIds.add(item.id)

    const scene = sceneById.get(item.sceneId)
    if (!scene) {
      issues.push({
        code: 'missing-scene',
        severity: 'error',
        itemId: item.id,
        sceneId: item.sceneId,
        message: `Sequence item "${item.id}" references missing scene "${item.sceneId}".`,
      })
      continue
    }

    const sceneDurationFrames = compositionDurationFrames(
      scene.duration,
      frameRate,
    )
    if (sceneDurationFrames === 0) {
      issues.push({
        code: 'empty-item',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" was omitted because scene "${scene.id}" has no renderable duration.`,
      })
      continue
    }

    const workAreaFrames = resolveWorkAreaFrames(
      scene,
      sceneDurationFrames,
      frameRate,
      issues,
    )
    const rawTrimStart = item.trimStart ?? 0
    const requestedStartFrame = secondsToFrames(
      finiteOr(rawTrimStart, 0),
      frameRate,
    )
    const sourceStartFrame = clamp(
      requestedStartFrame,
      0,
      sceneDurationFrames,
    )
    if (
      !Number.isFinite(rawTrimStart) ||
      sourceStartFrame !== requestedStartFrame
    ) {
      issues.push({
        code: 'trim-clamped',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" trim start was clamped to the scene range.`,
      })
    }

    const availableSceneFrames = sceneDurationFrames - sourceStartFrame
    if (availableSceneFrames <= 0) {
      issues.push({
        code: 'empty-item',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" was omitted because its trim starts at the scene end.`,
      })
      continue
    }

    const durationResolution = resolveItemDurationFrames(
      item.duration,
      availableSceneFrames,
      frameRate,
    )
    if (durationResolution.clamped) {
      issues.push({
        code: 'duration-clamped',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" duration was clamped to ${framesToSeconds(durationResolution.frames, frameRate)} seconds.`,
      })
    }

    const requestedEndFrame =
      sourceStartFrame + durationResolution.frames
    const intersectedStartFrame = Math.max(
      sourceStartFrame,
      workAreaFrames.start,
    )
    const intersectedEndFrame = Math.min(
      requestedEndFrame,
      workAreaFrames.end,
    )
    if (intersectedEndFrame <= intersectedStartFrame) {
      issues.push({
        code: 'empty-item',
        severity: 'warning',
        itemId: item.id,
        sceneId: scene.id,
        message: `Sequence item "${item.id}" was omitted because its source range does not intersect scene "${scene.id}"'s work area.`,
      })
      continue
    }

    timings.push({
      item,
      scene,
      sourceIndex,
      sequenceIndex: timings.length,
      sourceStartFrame: intersectedStartFrame,
      sourceEndFrame: intersectedEndFrame,
      durationFrames: intersectedEndFrame - intersectedStartFrame,
    })
  }

  const transitionFrames = resolveTransitionFrames(
    timings,
    frameRate,
    issues,
  )
  const resolvedItems: ResolvedSequenceItem[] = []
  const transitions: ResolvedSequenceTransition[] = []
  let nextMasterStartFrame = 0

  for (let index = 0; index < timings.length; index++) {
    const timing = timings[index]!
    const transitionInFrames = index > 0
      ? transitionFrames[index - 1] ?? 0
      : 0
    const transitionOutFrames = transitionFrames[index] ?? 0
    const masterStartFrame = nextMasterStartFrame
    const masterEndFrame = masterStartFrame + timing.durationFrames
    const resolved: ResolvedSequenceItem = {
      item: timing.item,
      scene: timing.scene,
      sourceIndex: timing.sourceIndex,
      sequenceIndex: timing.sequenceIndex,
      sourceStartFrame: timing.sourceStartFrame,
      sourceEndFrame: timing.sourceEndFrame,
      durationFrames: timing.durationFrames,
      sourceStart: framesToSeconds(timing.sourceStartFrame, frameRate),
      sourceEnd: framesToSeconds(timing.sourceEndFrame, frameRate),
      duration: framesToSeconds(timing.durationFrames, frameRate),
      masterStartFrame,
      masterEndFrame,
      masterStart: framesToSeconds(masterStartFrame, frameRate),
      masterEnd: framesToSeconds(masterEndFrame, frameRate),
      transitionInFrames,
      transitionOutFrames,
      transitionIn: framesToSeconds(transitionInFrames, frameRate),
      transitionOut: framesToSeconds(transitionOutFrames, frameRate),
    }
    resolvedItems.push(resolved)

    if (transitionOutFrames > 0 && index + 1 < timings.length) {
      const nextTiming = timings[index + 1]!
      const startFrame = masterEndFrame - transitionOutFrames
      transitions.push({
        kind: 'crossfade',
        fromItemId: timing.item.id,
        toItemId: nextTiming.item.id,
        durationFrames: transitionOutFrames,
        startFrame,
        endFrame: masterEndFrame,
        duration: framesToSeconds(transitionOutFrames, frameRate),
        start: framesToSeconds(startFrame, frameRate),
        end: framesToSeconds(masterEndFrame, frameRate),
      })
    }

    nextMasterStartFrame = masterEndFrame - transitionOutFrames
  }

  const durationFrames = resolvedItems.at(-1)?.masterEndFrame ?? 0
  return {
    frameRate,
    durationFrames,
    duration: framesToSeconds(durationFrames, frameRate),
    items: resolvedItems,
    transitions,
    issues,
  }
}

function resolveWorkAreaFrames(
  scene: CompositionScene,
  sceneDurationFrames: number,
  frameRate: number,
  issues: SequenceTimeMapIssue[],
): { start: number; end: number } {
  const raw = scene.workArea
  if (!raw) return { start: 0, end: sceneDurationFrames }

  const rawStart = raw.start
  const rawEnd = raw.end
  const requestedStart = secondsToFrames(
    finiteOr(rawStart, 0),
    frameRate,
    'floor',
  )
  const requestedEnd = secondsToFrames(
    finiteOr(rawEnd, scene.duration),
    frameRate,
    'ceil',
  )
  const start = clamp(requestedStart, 0, sceneDurationFrames)
  const end = clamp(requestedEnd, 0, sceneDurationFrames)
  if (
    !Number.isFinite(rawStart) ||
    !Number.isFinite(rawEnd) ||
    start !== requestedStart ||
    end !== requestedEnd ||
    end <= start
  ) {
    issues.push({
      code: 'work-area-clamped',
      severity: 'warning',
      sceneId: scene.id,
      message:
        end > start
          ? `Scene "${scene.id}" work area was clamped to its composition range.`
          : `Scene "${scene.id}" has an invalid work area; using the complete composition.`,
    })
  }
  return end > start
    ? { start, end }
    : { start: 0, end: sceneDurationFrames }
}

/**
 * Resolve master time to one composition or the two sides of a transition.
 *
 * Sequence intervals are half-open. Seeking exactly to total duration is the
 * single exception: it resolves the final composition at its source out point
 * so the editor has a stable end-state preview.
 */
export function resolveMasterTime(
  timeMap: SequenceTimeMap,
  masterTime: number,
  options: ResolveMasterTimeOptions = {},
): MasterTimeResolution {
  const shouldClamp = options.clamp ?? true
  let resolvedTime = Number.isFinite(masterTime) ? masterTime : 0
  if (shouldClamp) {
    resolvedTime = clamp(resolvedTime, 0, timeMap.duration)
  }
  const quantize = options.quantize ?? 'none'
  if (quantize !== 'none') {
    resolvedTime = quantizeTimeToFrame(
      resolvedTime,
      timeMap.frameRate,
      quantize,
    )
    if (shouldClamp) {
      resolvedTime = clamp(resolvedTime, 0, timeMap.duration)
    }
  }

  const masterFrame = secondsToFrames(
    resolvedTime,
    timeMap.frameRate,
    'nearest',
  )
  if (timeMap.items.length === 0) {
    return {
      masterTime: resolvedTime,
      masterFrame,
      transition: null,
      layers: [],
    }
  }

  if (
    shouldClamp &&
    approximatelyEqual(resolvedTime, timeMap.duration)
  ) {
    const finalItem = timeMap.items.at(-1)!
    return {
      masterTime: timeMap.duration,
      masterFrame: timeMap.durationFrames,
      transition: null,
      layers: [sequenceLayer(finalItem, 'single', finalItem.sourceEnd, 1, null)],
    }
  }

  const transition = timeMap.transitions.find((candidate) =>
    resolvedTime >= candidate.start - TIME_EPSILON &&
    resolvedTime < candidate.end - TIME_EPSILON
  ) ?? null
  if (transition) {
    const outgoing = timeMap.items.find(
      (item) => item.item.id === transition.fromItemId,
    )
    const incoming = timeMap.items.find(
      (item) => item.item.id === transition.toItemId,
    )
    if (outgoing && incoming) {
      const progress = clamp(
        (resolvedTime - transition.start) / transition.duration,
        0,
        1,
      )
      return {
        masterTime: resolvedTime,
        masterFrame,
        transition,
        layers: [
          sequenceLayerAtMasterTime(
            outgoing,
            resolvedTime,
            'outgoing',
            1 - progress,
            progress,
          ),
          sequenceLayerAtMasterTime(
            incoming,
            resolvedTime,
            'incoming',
            progress,
            progress,
          ),
        ],
      }
    }
  }

  const item = timeMap.items.find((candidate) =>
    resolvedTime >= candidate.masterStart - TIME_EPSILON &&
    resolvedTime < candidate.masterEnd - TIME_EPSILON
  )
  return {
    masterTime: resolvedTime,
    masterFrame,
    transition: null,
    layers: item
      ? [sequenceLayerAtMasterTime(item, resolvedTime, 'single', 1, null)]
      : [],
  }
}

/** Map a local source time in one sequence item back onto master time. */
export function masterTimeForLocalTime(
  timeMap: SequenceTimeMap,
  itemId: string,
  localTime: number,
): number | null {
  const item = timeMap.items.find((candidate) => candidate.item.id === itemId)
  if (!item) return null
  const safeLocalTime = Number.isFinite(localTime)
    ? localTime
    : item.sourceStart
  const clampedLocalTime = clamp(
    safeLocalTime,
    item.sourceStart,
    item.sourceEnd,
  )
  return item.masterStart + clampedLocalTime - item.sourceStart
}

/**
 * Map master time to a specific item's local source time.
 *
 * Returns null when the item is not active unless `clampToItem` is true.
 */
export function localTimeForMasterTime(
  timeMap: SequenceTimeMap,
  itemId: string,
  masterTime: number,
  clampToItem = false,
): number | null {
  const item = timeMap.items.find((candidate) => candidate.item.id === itemId)
  if (!item) return null
  const safeMasterTime = Number.isFinite(masterTime)
    ? masterTime
    : item.masterStart
  if (
    !clampToItem &&
    (
      safeMasterTime < item.masterStart - TIME_EPSILON ||
      safeMasterTime > item.masterEnd + TIME_EPSILON
    )
  ) {
    return null
  }
  const itemTime = clamp(
    safeMasterTime,
    item.masterStart,
    item.masterEnd,
  )
  return clamp(
    item.sourceStart + itemTime - item.masterStart,
    item.sourceStart,
    item.sourceEnd,
  )
}

function indexScenes(
  scenes: readonly CompositionScene[],
  issues: SequenceTimeMapIssue[],
): Map<string, CompositionScene> {
  const result = new Map<string, CompositionScene>()
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index]!
    if (!validId(scene.id)) {
      issues.push({
        code: 'invalid-scene-id',
        severity: 'error',
        message: `Composition scene at index ${index} has an empty id.`,
      })
      continue
    }
    if (result.has(scene.id)) {
      issues.push({
        code: 'duplicate-scene-id',
        severity: 'error',
        sceneId: scene.id,
        message: `Duplicate composition scene id "${scene.id}"; keeping the first occurrence.`,
      })
      continue
    }
    result.set(scene.id, scene)
    if (!Number.isFinite(scene.duration) || scene.duration <= 0) {
      issues.push({
        code: 'invalid-scene-duration',
        severity: 'error',
        sceneId: scene.id,
        message: `Composition scene "${scene.id}" has no positive finite duration.`,
      })
    }
  }
  return result
}

function validateGlobalNodeReferences(
  scenes: readonly CompositionScene[],
  issues: SequenceTimeMapIssue[],
): void {
  const ownerByNodeId = new Map<string, string>()
  for (const scene of scenes) {
    if (!validId(scene.id)) continue
    if (!validId(scene.rootNodeId)) {
      issues.push({
        code: 'invalid-root-node-id',
        severity: 'error',
        sceneId: scene.id,
        message: `Composition scene "${scene.id}" has an empty root node id.`,
      })
    } else {
      recordGlobalNodeOwner(
        scene.rootNodeId,
        scene.id,
        ownerByNodeId,
        issues,
      )
    }

    const ownedCameraIds = new Set<string>()
    for (const cameraId of scene.cameraIds) {
      if (!validId(cameraId)) {
        issues.push({
          code: 'invalid-camera-id',
          severity: 'error',
          sceneId: scene.id,
          message: `Composition scene "${scene.id}" contains an empty camera id.`,
        })
        continue
      }
      if (ownedCameraIds.has(cameraId)) {
        issues.push({
          code: 'duplicate-camera-id',
          severity: 'error',
          sceneId: scene.id,
          cameraId,
          message: `Composition scene "${scene.id}" lists camera "${cameraId}" more than once.`,
        })
        continue
      }
      ownedCameraIds.add(cameraId)
      recordGlobalNodeOwner(cameraId, scene.id, ownerByNodeId, issues)
    }

    if (
      scene.defaultCameraId !== null &&
      !ownedCameraIds.has(scene.defaultCameraId)
    ) {
      issues.push({
        code: 'default-camera-not-owned',
        severity: 'warning',
        sceneId: scene.id,
        cameraId: scene.defaultCameraId,
        message: `Default camera "${scene.defaultCameraId}" is not owned by composition scene "${scene.id}".`,
      })
    }

    for (const cut of Object.values(scene.cameraCuts)) {
      if (!ownedCameraIds.has(cut.cameraId)) {
        issues.push({
          code: 'camera-cut-target-not-owned',
          severity: 'warning',
          sceneId: scene.id,
          cameraId: cut.cameraId,
          cameraCutId: cut.id,
          message: `Camera cut "${cut.id}" targets camera "${cut.cameraId}", which is not owned by composition scene "${scene.id}".`,
        })
      }
    }
  }
}

function recordGlobalNodeOwner(
  nodeId: string,
  sceneId: string,
  ownerByNodeId: Map<string, string>,
  issues: SequenceTimeMapIssue[],
): void {
  const existingOwner = ownerByNodeId.get(nodeId)
  if (existingOwner !== undefined) {
    issues.push({
      code: 'duplicate-global-node-id',
      severity: 'error',
      sceneId,
      message: `Global node id "${nodeId}" is referenced by both "${existingOwner}" and "${sceneId}".`,
    })
    return
  }
  ownerByNodeId.set(nodeId, sceneId)
}

function resolveItemDurationFrames(
  requestedDuration: number | undefined,
  availableFrames: number,
  frameRate: number,
): { frames: number; clamped: boolean } {
  if (requestedDuration === undefined) {
    return { frames: availableFrames, clamped: false }
  }
  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    return { frames: Math.min(1, availableFrames), clamped: true }
  }
  const requestedFrames = Math.max(
    1,
    secondsToFrames(requestedDuration, frameRate),
  )
  const frames = Math.min(requestedFrames, availableFrames)
  return {
    frames,
    clamped: frames !== requestedFrames,
  }
}

function resolveTransitionFrames(
  timings: readonly ItemTiming[],
  frameRate: number,
  issues: SequenceTimeMapIssue[],
): number[] {
  const result: number[] = []
  for (let index = 0; index + 1 < timings.length; index++) {
    const current = timings[index]!
    const next = timings[index + 1]!
    const transition = current.item.transitionOut
    if (!transition || transition.kind === 'cut') {
      result.push(0)
      continue
    }

    const rawDuration = transition.duration
    const requestedFrames = Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.max(1, secondsToFrames(rawDuration, frameRate))
      : 0
    const incomingFrames = index > 0 ? result[index - 1] ?? 0 : 0
    const availableOutgoingTail = Math.max(
      0,
      current.durationFrames - incomingFrames,
    )
    const maximumFrames = Math.min(
      availableOutgoingTail,
      next.durationFrames,
    )
    const frames = Math.min(requestedFrames, maximumFrames)
    result.push(frames)

    if (
      !Number.isFinite(rawDuration) ||
      rawDuration < 0 ||
      frames !== requestedFrames
    ) {
      issues.push({
        code: 'transition-clamped',
        severity: 'warning',
        itemId: current.item.id,
        sceneId: current.scene.id,
        message: `Transition leaving sequence item "${current.item.id}" was clamped to ${framesToSeconds(frames, frameRate)} seconds.`,
      })
    }
  }
  return result
}

function sequenceLayerAtMasterTime(
  item: ResolvedSequenceItem,
  masterTime: number,
  role: ResolvedSequenceLayer['role'],
  weight: number,
  transitionProgress: number | null,
): ResolvedSequenceLayer {
  const localTime = clamp(
    item.sourceStart + masterTime - item.masterStart,
    item.sourceStart,
    item.sourceEnd,
  )
  return sequenceLayer(
    item,
    role,
    localTime,
    clamp(weight, 0, 1),
    transitionProgress,
  )
}

function sequenceLayer(
  item: ResolvedSequenceItem,
  role: ResolvedSequenceLayer['role'],
  localTime: number,
  weight: number,
  transitionProgress: number | null,
): ResolvedSequenceLayer {
  return {
    item,
    role,
    localTime,
    weight,
    transitionProgress,
  }
}

function compositionDurationFrames(
  duration: number,
  frameRate: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.max(1, secondsToFrames(duration, frameRate))
}

function quantizedPositiveDuration(
  duration: number,
  frameRate: number,
): number {
  return framesToSeconds(
    compositionDurationFrames(duration, frameRate),
    frameRate,
  )
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function validId(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= TIME_EPSILON
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
