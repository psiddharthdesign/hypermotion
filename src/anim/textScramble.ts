// SPDX-License-Identifier: Apache-2.0

import type { TextAnimationConfig } from './textAnimations'
import {
  textSegmentEnvelopeProgress,
  textSegmentLinearProgress,
  textSegmentStartOffset,
} from './textSegmentEnvelope'

export const SCRAMBLE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&'

/**
 * Deterministic per-segment Scramble shared by DOM, WebGL preview, and export.
 * The seed time clamps to the segment range, so scenes are stable before the
 * animation and after it finishes instead of repainting forever while idle.
 */
export function scrambleTextForSegment(
  text: string,
  config: TextAnimationConfig,
  playhead: number,
  progress: number | undefined,
  orderIndex: number,
  count: number,
): string {
  if (config.id !== 'scramble') return text
  const totalSpan =
    config.duration + Math.max(0, count - 1) * config.delay
  const timelineProgress =
    progress === undefined
      ? undefined
      : Math.max(0, Math.min(1, progress))
  const globalElapsed =
    timelineProgress === undefined
      ? playhead - config.startTime
      : timelineProgress * totalSpan
  const duration = Math.max(0.05, config.duration)
  const envelopeProgress = textSegmentEnvelopeProgress(
    globalElapsed,
    duration,
    config.delay,
    orderIndex,
    count,
    config.smoothing,
    config.staggerCurve,
  )
  const localProgress = envelopeProgress
  if (
    (config.mode === 'in' && localProgress >= 0.85) ||
    (config.mode === 'out' && localProgress <= 0.15)
  ) {
    return text
  }
  const seedProgress = textSegmentLinearProgress(
    globalElapsed,
    duration,
    config.delay,
    orderIndex,
    count,
  )
  const segmentStartOffset = textSegmentStartOffset(
    config.delay,
    orderIndex,
    count,
  )
  const seedTime =
    config.startTime +
    segmentStartOffset +
    seedProgress * duration
  // Scramble glyphs intentionally refresh at 30 Hz. Keeping the quantization
  // here (rather than only in the atlas renderer) gives DOM preview, WebGL,
  // and export identical replacement glyphs on every frame while transforms
  // and opacity continue to interpolate at the full timeline frame rate.
  const quantizedSeedTime = Math.floor(seedTime * 30 + 1e-6) / 30
  return Array.from(text)
    .map((character, characterIndex) => {
      if (/\s/.test(character)) return character
      const noise = Math.abs(
        Math.sin(
          (orderIndex + 1) * 17.17 +
            characterIndex * 9.91 +
            quantizedSeedTime * 24,
        ),
      )
      return SCRAMBLE_GLYPHS[
        Math.floor(noise * SCRAMBLE_GLYPHS.length) % SCRAMBLE_GLYPHS.length
      ]!
    })
    .join('')
}
