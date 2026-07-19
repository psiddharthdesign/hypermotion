// SPDX-License-Identifier: Apache-2.0

import type { TextMotionPath } from './textMotionPath'
import { evaluateTextMotionPath } from './textMotionPath'
import type { TextAnimationConfig } from './textAnimations'
import { easeTextAnimationProgress } from './textSegmentEnvelope'
import { evaluateTextStaggerCurve } from './textStaggerCurve'
import {
  resolveTextMotionVector,
  type TextMotionVector,
} from './textMotionVector'

/**
 * Resolve the spatial offset for one text segment in renderer-local pixels.
 * A motion path is an explicit trajectory and therefore takes precedence over
 * the older straight XYZ vector. Null keeps every legacy direction/travel
 * branch intact in callers.
 */
export function resolveTextSegmentMotion(
  path: TextMotionPath | null | undefined,
  vector: TextMotionVector | null | undefined,
  lineHeight: number,
  amount: number,
): TextMotionVector | null {
  if (path) {
    const point = evaluateTextMotionPath(amount, path)
    const scale = Number.isFinite(lineHeight) ? Math.max(0, lineHeight) : 0
    return {
      x: point.x * scale,
      y: point.y * scale,
      z: point.z * scale,
    }
  }
  return resolveTextMotionVector(vector, lineHeight, amount)
}

/**
 * Resolve the one shared transport amount used by a visual-line motion rail.
 * Per-segment envelope progress is intentionally not used here: independently
 * delayed path samples would stretch, cross, and leave the common rail.
 */
export function resolveTextMotionRailAmount(
  config: Pick<
    TextAnimationConfig,
    | 'mode'
    | 'duration'
    | 'delay'
    | 'startTime'
    | 'acceleration'
    | 'staggerCurve'
  >,
  playhead: number,
  timelineProgress: number | undefined,
  totalSegmentCount: number,
  firstSequence: number,
  runSegmentCount: number,
): number {
  const totalCount = Math.max(1, Math.floor(totalSegmentCount))
  const runCount = Math.max(1, Math.floor(runSegmentCount))
  const duration = Math.max(
    0.05,
    Number.isFinite(config.duration) ? config.duration : 0.05,
  )
  const delay = Math.max(0, Number.isFinite(config.delay) ? config.delay : 0)
  const totalSpan = duration + Math.max(0, totalCount - 1) * delay
  const globalElapsed =
    timelineProgress === undefined
      ? (Number.isFinite(playhead) ? playhead : 0) - config.startTime
      : clamp01(timelineProgress) * totalSpan
  const runStart = Math.max(0, Math.floor(firstSequence)) * delay
  const runSpan = duration + Math.max(0, runCount - 1) * delay
  const linearProgress = clamp01((globalElapsed - runStart) / runSpan)
  const profiledProgress = evaluateTextStaggerCurve(
    linearProgress,
    config.staggerCurve,
  )
  const progress =
    timelineProgress === undefined
      ? easeTextAnimationProgress(profiledProgress, config.acceleration)
      : profiledProgress
  return config.mode === 'out' ? progress : 1 - progress
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}
