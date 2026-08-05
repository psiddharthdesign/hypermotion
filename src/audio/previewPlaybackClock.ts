// SPDX-License-Identifier: Apache-2.0

export interface PreviewAudioClockInput {
  timelineTime: number
  startTime: number
  trimStart: number
  trimEnd: number
  playbackRate: number
  loop: boolean
}

export interface PreviewAudioClock {
  /** Whether the clip should currently contribute to preview playback. */
  active: boolean
  /** Source-media time corresponding to the current timeline sample. */
  localTime: number
  /** One trimmed source cycle in seconds. */
  sourceClipDuration: number
  /** One trimmed cycle expressed on the timeline clock. */
  timelineClipDuration: number
}

/**
 * Resolve an audio node's source clock from its owning timeline.
 *
 * A one-shot clip becomes inactive after its trimmed source has played once.
 * A looped clip remains active from startTime onward and wraps within the
 * trimmed range, matching Web Audio's loopStart / loopEnd semantics.
 */
export function resolvePreviewAudioClock(
  input: PreviewAudioClockInput,
): PreviewAudioClock {
  const timelineIsFinite = Number.isFinite(input.timelineTime)
  const timelineTime = timelineIsFinite ? input.timelineTime : input.startTime
  const rate = safePlaybackRate(input.playbackRate)
  const sourceClipDuration = Math.max(0, input.trimEnd - input.trimStart)
  const timelineClipDuration = sourceClipDuration / rate
  const timelineOffset = timelineTime - input.startTime
  const hasStarted = timelineIsFinite && timelineOffset >= 0
  const active =
    hasStarted &&
    sourceClipDuration > 0 &&
    (input.loop || timelineOffset < timelineClipDuration)

  let localTime = input.trimStart
  if (hasStarted && sourceClipDuration > 0) {
    const sourceOffset = timelineOffset * rate
    localTime = input.loop
      ? input.trimStart + positiveModulo(sourceOffset, sourceClipDuration)
      : clamp(input.trimStart + sourceOffset, input.trimStart, input.trimEnd)
  }

  return {
    active,
    localTime,
    sourceClipDuration,
    timelineClipDuration,
  }
}

/**
 * Compare source positions while accounting for the loop seam.
 *
 * Web Audio reports elapsed source time monotonically even while the buffer
 * loops, so a linear comparison would falsely detect a large drift after the
 * first cycle and continuously restart the source.
 */
export function previewAudioLocalDrift(input: {
  actualTime: number
  expectedTime: number
  trimStart: number
  trimEnd: number
  loop: boolean
}): number {
  if (
    !Number.isFinite(input.actualTime) ||
    !Number.isFinite(input.expectedTime)
  ) {
    return Number.POSITIVE_INFINITY
  }
  const clipDuration = Math.max(0, input.trimEnd - input.trimStart)
  if (!input.loop || clipDuration <= 0) {
    return Math.abs(input.actualTime - input.expectedTime)
  }
  const actual = positiveModulo(
    input.actualTime - input.trimStart,
    clipDuration,
  )
  const expected = positiveModulo(
    input.expectedTime - input.trimStart,
    clipDuration,
  )
  const direct = Math.abs(actual - expected)
  return Math.min(direct, clipDuration - direct)
}

/**
 * Media-element fallback cannot set a trimmed loop range. Force a seek once
 * its raw source clock leaves that range; otherwise use seam-aware drift so a
 * sample immediately before the loop boundary is not treated as far away from
 * the sample immediately after it.
 */
export function shouldSeekPreviewMediaElement(input: {
  currentTime: number
  expectedTime: number
  trimStart: number
  trimEnd: number
  loop: boolean
  paused: boolean
  tolerance: number
}): boolean {
  if (input.paused) return true
  if (
    input.loop &&
    (input.currentTime < input.trimStart ||
      input.currentTime >= input.trimEnd)
  ) {
    return true
  }
  return (
    previewAudioLocalDrift({
      actualTime: input.currentTime,
      expectedTime: input.expectedTime,
      trimStart: input.trimStart,
      trimEnd: input.trimEnd,
      loop: input.loop,
    }) > Math.max(0, input.tolerance)
  )
}

function safePlaybackRate(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.05, Math.min(16, value))
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
