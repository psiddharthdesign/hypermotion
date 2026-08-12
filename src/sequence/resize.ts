// SPDX-License-Identifier: Apache-2.0

import type {
  CompositionScene,
  CompositionWorkArea,
  ResolvedSequenceItem,
  SequenceTimeMap,
} from './types'
import {
  framesToSeconds,
  normalizeFrameRate,
  resolveCompositionWorkAreaFrames,
  secondsToFrames,
} from './timeMap'

export interface SequenceOccurrenceSourceWindow {
  trimStart: number
  duration: number
}

export interface SequenceMasterDurationBounds {
  min: number
  /** Missing means the final occurrence may extend with a freeze-frame hold. */
  max?: number
}

export interface SequenceTailDurationEdit {
  itemId: string
  patch: SequenceOccurrenceSourceWindow & { holdDuration: number }
  /** The frame-aligned Master duration produced by this patch. */
  duration: number
  bounds: SequenceMasterDurationBounds
}

/**
 * Resolve the valid source window for occurrence editing.
 *
 * Missing work-area metadata means the complete composition. Malformed
 * collaborative data also falls back to the complete composition; the
 * canonical time-map reports that issue separately.
 */
export function compositionSourceWindow(
  scene: Pick<CompositionScene, 'duration' | 'workArea'>,
): CompositionWorkArea {
  const duration =
    Number.isFinite(scene.duration) && scene.duration > 0
      ? scene.duration
      : 0
  const authored = scene.workArea
  if (!authored) return { start: 0, end: duration }
  const start = clamp(authored.start, 0, duration)
  const end = clamp(authored.end, 0, duration)
  return end > start ? { start, end } : { start: 0, end: duration }
}

/**
 * Ripple-trim a Master occurrence's trailing edge without changing its
 * composition duration. The out-point is frame-aligned and constrained to
 * the owning scene's work area. The returned absolute trim/duration can be
 * passed directly to ProjectAPI.updateSequenceItem.
 */
export function resizeSequenceOccurrenceOut(
  resolved: Pick<
    ResolvedSequenceItem,
    'item' | 'scene' | 'sourceStartFrame'
  >,
  requestedSourceEnd: number,
  frameRate: number,
): SequenceOccurrenceSourceWindow {
  const safeFrameRate = normalizeFrameRate(frameRate)
  const sceneDurationFrames = Math.max(
    1,
    secondsToFrames(resolved.scene.duration, safeFrameRate),
  )
  const sourceWindow = resolveCompositionWorkAreaFrames(
    resolved.scene,
    sceneDurationFrames,
    safeFrameRate,
  )
  const sourceStartFrame = clamp(
    resolved.sourceStartFrame,
    sourceWindow.start,
    Math.max(sourceWindow.start, sourceWindow.end - 1),
  )
  const sourceEndFrame = clamp(
    secondsToFrames(requestedSourceEnd, safeFrameRate),
    sourceStartFrame + 1,
    sourceWindow.end,
  )
  const authoredTrimStart = clamp(
    Number.isFinite(resolved.item.trimStart)
      ? (resolved.item.trimStart ?? 0)
      : 0,
    0,
    resolved.scene.duration,
  )
  const authoredStartFrame = clamp(
    secondsToFrames(authoredTrimStart, safeFrameRate),
    0,
    sceneDurationFrames,
  )
  return {
    trimStart: authoredTrimStart,
    duration: framesToSeconds(
      sourceEndFrame - authoredStartFrame,
      safeFrameRate,
    ),
  }
}

/**
 * Resolve the total-duration range the final sequence occurrence can express.
 *
 * Master duration is derived data: it is the trailing edge of the final
 * occurrence after transition overlap. Keeping the edit on that occurrence
 * preserves every composition's authored duration and local keyframes.
 */
export function sequenceMasterDurationBounds(
  timeMap: Pick<SequenceTimeMap, 'duration' | 'frameRate' | 'items'>,
): SequenceMasterDurationBounds | null {
  const tail = sequenceTailTiming(timeMap)
  if (!tail) return null
  return {
    min: framesToSeconds(tail.masterDurationForTailFrames(1), tail.frameRate),
  }
}

/**
 * Resize only the final occurrence so its trailing edge reaches a requested
 * Master time. The source range remains frame-aligned and clamped to the
 * composition's available source/work-area window. Requests beyond that
 * range append a freeze-frame hold without changing the composition.
 *
 * Crossfades make a short incoming tail fully overlap the preceding scene.
 * The monotonic frame search below handles that flat portion without moving
 * earlier occurrences or rewriting local animation time.
 */
export function resizeSequenceTailToMasterDuration(
  timeMap: Pick<SequenceTimeMap, 'duration' | 'frameRate' | 'items'>,
  requestedDuration: number,
): SequenceTailDurationEdit | null {
  const tail = sequenceTailTiming(timeMap)
  if (!tail) return null

  const bounds = {
    min: framesToSeconds(tail.masterDurationForTailFrames(1), tail.frameRate),
  }
  const safeRequested = Number.isFinite(requestedDuration)
    ? requestedDuration
    : timeMap.duration
  const requestedMasterFrames = Math.max(
    secondsToFrames(safeRequested, tail.frameRate),
    secondsToFrames(bounds.min, tail.frameRate),
  )

  const currentTailFrames = Math.max(
    tail.last.durationFrames,
    1,
  )
  let selectedTailFrames = currentTailFrames
  if (
    tail.masterDurationForTailFrames(currentTailFrames) !==
    requestedMasterFrames
  ) {
    let low = 1
    let high = Math.max(
      currentTailFrames,
      tail.maxSourceTailFrames,
      requestedMasterFrames,
    )
    while (
      tail.masterDurationForTailFrames(high) < requestedMasterFrames &&
      high < Number.MAX_SAFE_INTEGER / 2
    ) {
      high *= 2
    }
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (tail.masterDurationForTailFrames(mid) <= requestedMasterFrames) {
        low = mid
      } else {
        high = mid - 1
      }
    }
    selectedTailFrames = low
  }

  const selectedSourceTailFrames = Math.min(
    selectedTailFrames,
    tail.maxSourceTailFrames,
  )
  const requestedSourceEnd = framesToSeconds(
    tail.last.sourceStartFrame + selectedSourceTailFrames,
    tail.frameRate,
  )
  const sourcePatch = resizeSequenceOccurrenceOut(
    tail.last,
    requestedSourceEnd,
    tail.frameRate,
  )
  const authoredStartFrame = secondsToFrames(
    sourcePatch.trimStart,
    tail.frameRate,
  )
  const patchedSourceEndFrame =
    authoredStartFrame + secondsToFrames(sourcePatch.duration, tail.frameRate)
  const actualSourceTailFrames = clamp(
    patchedSourceEndFrame - tail.last.sourceStartFrame,
    1,
    tail.maxSourceTailFrames,
  )
  const holdDurationFrames = Math.max(
    0,
    selectedTailFrames - actualSourceTailFrames,
  )
  const actualTailFrames = actualSourceTailFrames + holdDurationFrames
  const patch = {
    ...sourcePatch,
    holdDuration: framesToSeconds(holdDurationFrames, tail.frameRate),
  }
  return {
    itemId: tail.last.item.id,
    patch,
    duration: framesToSeconds(
      tail.masterDurationForTailFrames(actualTailFrames),
      tail.frameRate,
    ),
    bounds,
  }
}

function sequenceTailTiming(
  timeMap: Pick<SequenceTimeMap, 'frameRate' | 'items'>,
): {
  frameRate: number
  last: ResolvedSequenceItem
  maxSourceTailFrames: number
  masterDurationForTailFrames: (tailFrames: number) => number
} | null {
  const last = timeMap.items.at(-1)
  if (!last) return null
  const frameRate = normalizeFrameRate(timeMap.frameRate)
  const sceneDurationFrames = Math.max(
    1,
    secondsToFrames(last.scene.duration, frameRate),
  )
  const sourceWindow = resolveCompositionWorkAreaFrames(
    last.scene,
    sceneDurationFrames,
    frameRate,
  )
  const maxSourceTailFrames = Math.max(
    1,
    sourceWindow.end - last.sourceStartFrame,
  )
  const previous = timeMap.items.at(-2)
  if (!previous) {
    return {
      frameRate,
      last,
      maxSourceTailFrames,
      masterDurationForTailFrames: (tailFrames) =>
        Math.max(1, Math.round(tailFrames)),
    }
  }

  const transition = previous.item.transitionOut
  const requestedOverlapFrames =
    transition?.kind === 'crossfade' &&
    Number.isFinite(transition.duration) &&
    transition.duration > 0
      ? Math.max(1, secondsToFrames(transition.duration, frameRate))
      : 0
  const availableOutgoingFrames = Math.max(
    0,
    previous.durationFrames - previous.transitionInFrames,
  )
  const overlapCapFrames = Math.min(
    requestedOverlapFrames,
    availableOutgoingFrames,
  )
  return {
    frameRate,
    last,
    maxSourceTailFrames,
    masterDurationForTailFrames: (tailFrames) => {
      const safeTailFrames = Math.max(1, Math.round(tailFrames))
      return (
        previous.masterEndFrame -
        Math.min(overlapCapFrames, safeTailFrames) +
        safeTailFrames
      )
    },
  }
}

function clamp(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min
  return Math.max(min, Math.min(max, safe))
}
