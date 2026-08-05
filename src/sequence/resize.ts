// SPDX-License-Identifier: Apache-2.0

import type {
  CompositionScene,
  CompositionWorkArea,
  ResolvedSequenceItem,
} from './types'
import {
  normalizeFrameRate,
  quantizeTimeToFrame,
} from './timeMap'

export interface SequenceOccurrenceSourceWindow {
  trimStart: number
  duration: number
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
  resolved: Pick<ResolvedSequenceItem, 'scene' | 'sourceStart'>,
  requestedSourceEnd: number,
  frameRate: number,
): SequenceOccurrenceSourceWindow {
  const sourceWindow = compositionSourceWindow(resolved.scene)
  const safeFrameRate = normalizeFrameRate(frameRate)
  const frameStep = 1 / safeFrameRate
  const sourceStart = clamp(
    quantizeTimeToFrame(resolved.sourceStart, safeFrameRate),
    sourceWindow.start,
    Math.max(sourceWindow.start, sourceWindow.end - frameStep),
  )
  const sourceEnd = clamp(
    quantizeTimeToFrame(requestedSourceEnd, safeFrameRate),
    sourceStart + frameStep,
    sourceWindow.end,
  )
  return {
    trimStart: sourceStart,
    duration: sourceEnd - sourceStart,
  }
}

function clamp(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min
  return Math.max(min, Math.min(max, safe))
}
