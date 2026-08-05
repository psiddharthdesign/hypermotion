// SPDX-License-Identifier: Apache-2.0

export function sliderFillPercent(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0
  }
  if (max <= min) return 0
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
}

export interface SliderDomain {
  min: number
  max: number
}

/**
 * A track is only meaningful when the property owns a real, finite range.
 * One-sided constraints such as width >= 0 are validation rules, not a
 * useful visual domain, so those values belong in the ordinary NumberField.
 */
export function hasBoundedSliderDomain(
  min?: number,
  max?: number,
): boolean {
  return (
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    max! > min!
  )
}

export interface SliderFrameQueue {
  /** Keep only the latest raw pointer value until the next display frame. */
  queue: (value: number) => void
  /** Publish the latest queued value immediately, if one exists. */
  flush: () => number | null
  /** Drop queued work without publishing it. */
  cancel: () => void
}

/**
 * Coalesce pointer hardware packets to the display rate.
 *
 * Trackpads and high-polling-rate mice can dispatch several pointer events
 * inside one frame. Publishing every packet made the Inspector rebuild the
 * scene more quickly than Chromium could paint it. This queue deliberately
 * retains only the most recent value and is dependency-injected so its
 * scheduling semantics can be covered without a browser.
 */
export function createSliderFrameQueue(
  publish: (value: number) => void,
  scheduleFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (frameId: number) => void,
): SliderFrameQueue {
  let frameId: number | null = null
  let pendingValue: number | null = null

  const publishPending = (): number | null => {
    if (pendingValue === null) return null
    const next = pendingValue
    pendingValue = null
    publish(next)
    return next
  }

  return {
    queue: (value) => {
      pendingValue = value
      if (frameId !== null) return
      frameId = scheduleFrame(() => {
        frameId = null
        publishPending()
      })
    },
    flush: () => {
      if (frameId !== null) cancelFrame(frameId)
      frameId = null
      return publishPending()
    },
    cancel: () => {
      if (frameId !== null) cancelFrame(frameId)
      frameId = null
      pendingValue = null
    },
  }
}

/**
 * Map a horizontal pointer position to a slider value. The mapping is kept
 * outside the component so pointer scrubbing and tests share the same clamp
 * behaviour instead of relying on browser-specific range geometry. Pointer
 * motion is deliberately continuous: `step` belongs to keyboard and typed
 * edits, not to the track itself.
 */
export function sliderValueFromPointer({
  clientX,
  left,
  width,
  min,
  max,
}: {
  clientX: number
  left: number
  width: number
  min: number
  max: number
}): number {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(left) ||
    !Number.isFinite(width) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    width <= 0 ||
    max <= min
  ) {
    return min
  }

  const progress = Math.max(0, Math.min(1, (clientX - left) / width))
  const raw = min + progress * (max - min)

  // Keep genuinely intermediate values while filtering binary floating-point
  // noise. This is precision stabilization, not a snapping grid.
  return Math.max(min, Math.min(max, Number(raw.toFixed(6))))
}

/**
 * Resolve a slider domain. Fully bounded properties always keep their authored
 * min/max, even if an older call site still supplies `adaptiveSpan`. The
 * adaptive fallback is retained only for backwards-compatible pure helpers;
 * KeyframeSliderRow no longer renders a track for an unbounded property.
 */
export function resolveSliderDomain({
  value,
  min,
  max,
  step = 1,
  adaptiveSpan,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  adaptiveSpan?: number
}): SliderDomain {
  const safeValue = Number.isFinite(value) ? value : 0
  const safeStep = Math.max(Math.abs(step), 0.0001)

  if (hasBoundedSliderDomain(min, max)) {
    return { min: min!, max: max! }
  }

  const requestedSpan = Number.isFinite(adaptiveSpan)
    ? Math.abs(adaptiveSpan!)
    : 0
  const span =
    requestedSpan > 0
      ? Math.max(requestedSpan, safeStep * 20)
      : Math.max(safeStep * 20, Math.abs(safeValue) * 2, 100)

  let domainMin = safeValue - span / 2
  let domainMax = safeValue + span / 2

  if (Number.isFinite(min) && domainMin < min!) {
    const shift = min! - domainMin
    domainMin += shift
    domainMax += shift
  }
  if (Number.isFinite(max) && domainMax > max!) {
    const shift = domainMax - max!
    domainMin -= shift
    domainMax -= shift
  }
  if (Number.isFinite(min)) domainMin = Math.max(domainMin, min!)
  if (Number.isFinite(max)) domainMax = Math.min(domainMax, max!)

  // Keep adaptive endpoints aligned to the property step. Native range
  // inputs otherwise introduce hard-to-read fractional endpoints.
  domainMin = Math.floor(domainMin / safeStep) * safeStep
  domainMax = Math.ceil(domainMax / safeStep) * safeStep
  if (Number.isFinite(min)) domainMin = Math.max(domainMin, min!)
  if (Number.isFinite(max)) domainMax = Math.min(domainMax, max!)
  if (domainMax <= domainMin) {
    domainMin = Number.isFinite(min) ? min! : safeValue - safeStep / 2
    domainMax = Number.isFinite(max) ? max! : domainMin + safeStep
  }

  return { min: domainMin, max: domainMax }
}
