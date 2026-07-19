// SPDX-License-Identifier: Apache-2.0

import type {
  TextAnimationAcceleration,
  TextAnimationSmoothing,
} from './textAnimations'
import {
  evaluateTextStaggerCurve,
  type TextStaggerCurve,
} from './textStaggerCurve'

/**
 * Resolve one segment's progress on the live curve formed across the text.
 *
 * A custom curve is the profile of a flexible strip moving across the ordered
 * text: every segment samples the same curve at its delayed local progress.
 * One delay later the profile has advanced by exactly one segment, so a long
 * authored slope travels intact instead of being pinned to particular letters.
 *
 * Soft and Smooth optionally blur samples of that profile across neighbours.
 * With an identity profile they remain bit-for-bit equivalent to the legacy
 * neighbour blend; with a custom profile they soften the authored bend.
 *
 * The scalar signature deliberately avoids allocating in the per-glyph render
 * hot path shared by DOM, Canvas2D, WebGL preview, and export.
 */
export function textSegmentEnvelopeProgress(
  globalElapsed: number,
  duration: number,
  delay: number,
  orderIndex: number,
  count: number,
  smoothing: TextAnimationSmoothing,
  staggerCurve?: TextStaggerCurve | null,
): number {
  const safeDuration = Math.max(
    0.05,
    Number.isFinite(duration) ? duration : 0.05,
  )
  const safeDelay = Math.max(0, Number.isFinite(delay) ? delay : 0)
  const safeCount = Math.max(
    1,
    Number.isFinite(count) ? Math.floor(count) : 1,
  )
  const safeIndex = clampIndex(orderIndex, safeCount)
  const center = profileAtOffset(
    globalElapsed,
    safeDuration,
    textSegmentStartOffset(safeDelay, safeIndex, safeCount),
    staggerCurve,
  )

  if (smoothing === 'soft' && safeCount > 1 && safeDelay > 0) {
    return (
      profileAtOffset(
        globalElapsed,
        safeDuration,
        textSegmentStartOffset(
          safeDelay,
          clampIndex(safeIndex - 1, safeCount),
          safeCount,
        ),
        staggerCurve,
      ) +
      center * 2 +
      profileAtOffset(
        globalElapsed,
        safeDuration,
        textSegmentStartOffset(
          safeDelay,
          clampIndex(safeIndex + 1, safeCount),
          safeCount,
        ),
        staggerCurve,
      )
    ) / 4
  }

  if (smoothing === 'smooth' && safeCount > 1 && safeDelay > 0) {
    return (
      profileAtOffset(
        globalElapsed,
        safeDuration,
        textSegmentStartOffset(
          safeDelay,
          clampIndex(safeIndex - 2, safeCount),
          safeCount,
        ),
        staggerCurve,
      ) +
      profileAtOffset(
        globalElapsed,
        safeDuration,
        textSegmentStartOffset(
          safeDelay,
          clampIndex(safeIndex - 1, safeCount),
          safeCount,
        ),
        staggerCurve,
      ) * 4 +
      center * 6 +
      profileAtOffset(
        globalElapsed,
        safeDuration,
        textSegmentStartOffset(
          safeDelay,
          clampIndex(safeIndex + 1, safeCount),
          safeCount,
        ),
        staggerCurve,
      ) * 4 +
      profileAtOffset(
        globalElapsed,
        safeDuration,
        textSegmentStartOffset(
          safeDelay,
          clampIndex(safeIndex + 2, safeCount),
          safeCount,
        ),
        staggerCurve,
      )
    ) / 16
  }

  return center
}

/** Original, unsmoothed local progress used by phase-based effects. */
export function textSegmentLinearProgress(
  globalElapsed: number,
  duration: number,
  delay: number,
  orderIndex: number,
  count: number,
): number {
  const safeCount = Math.max(
    1,
    Number.isFinite(count) ? Math.floor(count) : 1,
  )
  return progressAtOffset(
    globalElapsed,
    Math.max(0.05, Number.isFinite(duration) ? duration : 0.05),
    textSegmentStartOffset(
      delay,
      clampIndex(orderIndex, safeCount),
      safeCount,
    ),
  )
}

/** Original linear stagger start. The traveling profile never retimes it. */
export function textSegmentStartOffset(
  delay: number,
  orderIndex: number,
  count: number,
): number {
  const safeDelay = Math.max(0, Number.isFinite(delay) ? delay : 0)
  const safeCount = Math.max(
    1,
    Number.isFinite(count) ? Math.floor(count) : 1,
  )
  const safeIndex = clampIndex(orderIndex, safeCount)
  if (safeCount <= 1 || safeDelay <= 0 || safeIndex <= 0) return 0
  return safeIndex * safeDelay
}

/** Legacy node-only easing shared by every text renderer. */
export function easeTextAnimationProgress(
  progress: number,
  acceleration: TextAnimationAcceleration,
): number {
  const u = clamp01(Number.isFinite(progress) ? progress : 0)
  if (acceleration === 'linear') return u
  if (acceleration === 'speed-up') return u * u
  if (acceleration === 'spring') {
    return Math.min(1, 1 - Math.cos(u * Math.PI * 2.4) * Math.exp(-5 * u))
  }
  if (acceleration === 'smooth') return u * u * (3 - 2 * u)
  return 1 - Math.pow(1 - u, 3)
}

function progressAtOffset(
  elapsed: number,
  duration: number,
  offset: number,
): number {
  const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0
  return clamp01((safeElapsed - offset) / duration)
}

function profileAtOffset(
  elapsed: number,
  duration: number,
  offset: number,
  curve: TextStaggerCurve | null | undefined,
): number {
  return evaluateTextStaggerCurve(
    progressAtOffset(elapsed, duration, offset),
    curve,
  )
}

function clampIndex(index: number, count: number): number {
  const safeIndex = Number.isFinite(index) ? Math.floor(index) : 0
  return Math.max(0, Math.min(count - 1, safeIndex))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
