// SPDX-License-Identifier: Apache-2.0

export interface ParsedNumberFlowText {
  value: number
  prefix: string
  suffix: string
  decimals: number
  useGrouping: boolean
}

export type NumberFlowTrend = 'auto' | 'up' | 'down' | 'individual'

export interface NumberFlowVisualOptions {
  trend: NumberFlowTrend
  continuous: boolean
  /** Numeric increment between visible rolls; null uses display precision. */
  increment: number | null
  spinDistance: number
  fadeAmount: number
  maskHeight: number
  maskWidth: number
  transformTimingRatio: number
  spinTimingRatio: number
  opacityTimingRatio: number
  blurRadius: number
}

export interface NumberFlowVisualFrame {
  outgoingText: string
  incomingText: string
  outgoingOffsetEm: number
  incomingOffsetEm: number
  outgoingOpacity: number
  incomingOpacity: number
  blurRadius: number
  maskHeightEm: number
  maskWidthEm: number
  phase: number
  settledText: string
}

export const DEFAULT_NUMBER_FLOW_VISUAL_OPTIONS: NumberFlowVisualOptions = {
  trend: 'auto',
  continuous: true,
  increment: null,
  spinDistance: 1,
  fadeAmount: 1,
  maskHeight: 0.25,
  maskWidth: 0.5,
  transformTimingRatio: 1,
  spinTimingRatio: 1,
  opacityTimingRatio: 0.5,
  blurRadius: 8,
}

export function numberFlowVisualOptionsFromConfig(config: {
  numberFlowTrend: NumberFlowTrend
  numberFlowContinuous: boolean
  numberFlowIncrement: number | null
  numberFlowSpinDistance: number
  numberFlowFadeAmount: number
  numberFlowMaskHeight: number
  numberFlowMaskWidth: number
  numberFlowTransformTimingRatio: number
  numberFlowSpinTimingRatio: number
  numberFlowOpacityTimingRatio: number
  blurRadius: number
}): NumberFlowVisualOptions {
  return {
    trend: config.numberFlowTrend,
    continuous: config.numberFlowContinuous,
    increment: config.numberFlowIncrement,
    spinDistance: config.numberFlowSpinDistance,
    fadeAmount: config.numberFlowFadeAmount,
    maskHeight: config.numberFlowMaskHeight,
    maskWidth: config.numberFlowMaskWidth,
    transformTimingRatio: config.numberFlowTransformTimingRatio,
    spinTimingRatio: config.numberFlowSpinTimingRatio,
    opacityTimingRatio: config.numberFlowOpacityTimingRatio,
    blurRadius: config.blurRadius,
  }
}

// A number-flow target deliberately accepts only ordinary decimal notation.
// Dates, ranges, and other strings containing multiple numbers are ambiguous,
// while malformed grouping must not be partially interpreted as a valid value.
const NUMBER_TOKEN =
  /(?<![\d.,+-])-?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?![\d.,])/g

const formatterCache = new Map<string, Intl.NumberFormat>()

/**
 * Find the one ordinary number embedded in a text layer.
 *
 * Everything before and after the number is retained so labels such as
 * `Revenue: $1,250.00 USD` can flow without changing their authored copy.
 */
export function parseNumberFlowText(
  text: string,
): ParsedNumberFlowText | null {
  const matches = Array.from(text.matchAll(NUMBER_TOKEN))
  if (matches.length !== 1) return null

  const match = matches[0]!
  const token = match[0]
  const index = match.index
  if (index === undefined) return null

  const value = Number(token.replaceAll(',', ''))
  if (!Number.isFinite(value)) return null

  const decimalPoint = token.indexOf('.')
  return {
    value: Object.is(value, -0) ? 0 : value,
    prefix: text.slice(0, index),
    suffix: text.slice(index + token.length),
    decimals: decimalPoint === -1 ? 0 : token.length - decimalPoint - 1,
    useGrouping: token.includes(','),
  }
}

/** Format a numeric frame using the target text's stable en-US presentation. */
export function formatNumberFlowValue(
  value: number,
  format: ParsedNumberFlowText,
): string {
  const decimals = Math.max(0, Math.trunc(format.decimals))
  const finiteValue = Number.isFinite(value) ? value : 0
  const displayValue = roundsToZero(finiteValue, decimals) ? 0 : finiteValue
  const formatter = numberFormatter(decimals, format.useGrouping)
  return `${format.prefix}${formatter.format(displayValue)}${format.suffix}`
}

/** Smallest numeric increment that can be shown by the authored format. */
export function numberFlowDisplayUnit(
  format: ParsedNumberFlowText | null,
): number {
  return format ? 10 ** -Math.max(0, Math.trunc(format.decimals)) : 1
}

/**
 * Snap a custom increment to a value every selected target can display.
 *
 * A shared Count by control must not promise 0.25 when one selected layer is
 * authored with a single decimal place and can only show tenths. Choosing the
 * coarsest display unit also keeps the stored inspector value identical to the
 * increment used by every renderer.
 */
export function normalizeNumberFlowIncrementForTargets(
  value: number | null,
  formats: readonly (ParsedNumberFlowText | null)[],
): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null
  const unit = Math.max(1e-15, ...formats.map(numberFlowDisplayUnit))
  const snapped = Math.max(1, Math.round(value / unit)) * unit
  return Number(snapped.toPrecision(15))
}

/**
 * Resolve the deterministic text for one animation frame.
 *
 * Entrances count from the authored `from` value to the number in `text`;
 * exits run the same path backwards. The original target endpoint is returned
 * directly so its exact authored formatting is never canonicalized away.
 */
export function numberFlowTextAtProgress(
  text: string,
  from: number,
  mode: 'in' | 'out',
  progress: number,
  continuous = true,
): string {
  const format = parseNumberFlowText(text)
  if (!format) return text

  const t = clampProgress(progress)
  if ((mode === 'in' && t === 1) || (mode === 'out' && t === 0)) {
    return text
  }

  const safeFrom = Number.isFinite(from) ? from : 0
  const start = mode === 'in' ? safeFrom : format.value
  const end = mode === 'in' ? format.value : safeFrom
  if (!continuous) {
    return t < 0.5
      ? formatNumberFlowValue(start, format)
      : formatNumberFlowValue(end, format)
  }
  const value = start + (end - start) * t
  return formatNumberFlowValue(value, format)
}

/**
 * Resolve the two deterministic visual layers used by preview and export.
 *
 * The installed Number Flow package uses Web Animations, which cannot be
 * scrubbed or rendered frame-by-frame. This pure resolver preserves its
 * useful authoring semantics without depending on wall-clock animation.
 */
export function numberFlowVisualFrameAtProgress(
  text: string,
  from: number,
  mode: 'in' | 'out',
  progress: number,
  options: Partial<NumberFlowVisualOptions> = {},
  timelineProgress = progress,
): NumberFlowVisualFrame {
  const format = parseNumberFlowText(text)
  if (!format) return settledNumberFlowFrame(text, 0, 0)

  const normalized = normalizeVisualOptions(options)
  const timelineT = clampProgress(timelineProgress)
  const easedProgress = finite(progress, timelineT)
  const safeFrom = Number.isFinite(from) ? from : 0
  const startValue = mode === 'in' ? safeFrom : format.value
  const endValue = mode === 'in' ? format.value : safeFrom
  const startText = formatNumberFlowValue(startValue, format)
  const endText =
    mode === 'in'
      ? text
      : formatNumberFlowValue(endValue, format)

  if (timelineT <= 0) {
    return settledNumberFlowFrame(
      startText,
      normalized.maskHeight,
      normalized.maskWidth,
    )
  }
  if (timelineT >= 1) {
    return settledNumberFlowFrame(
      endText,
      normalized.maskHeight,
      normalized.maskWidth,
    )
  }

  const transformProgress = channelProgressWithOvershoot(
    easedProgress,
    normalized.transformTimingRatio,
  )
  let outgoingText = startText
  let incomingText = endText
  let rawPhase = transformProgress

  if (normalized.continuous) {
    const decimalScale = 10 ** Math.max(0, Math.trunc(format.decimals))
    const startTicks = Math.round(startValue * decimalScale)
    const endTicks = Math.round(endValue * decimalScale)
    const distanceTicks = Math.abs(endTicks - startTicks)
    const numericalDirection = endValue >= startValue ? 1 : -1
    const incrementTicks =
      normalized.increment === null
        ? 1
        : Math.max(
            1,
            Math.min(
              Number.MAX_SAFE_INTEGER,
              Math.round(normalized.increment * decimalScale),
            ),
          )
    const stepCount = Math.max(1, Math.ceil(distanceTicks / incrementTicks))
    const stepPosition = transformProgress * stepCount
    const outgoingIndex = Math.floor(stepPosition)
    const incomingIndex = outgoingIndex + 1
    const ticksAtStep = (index: number): number => {
      if (distanceTicks === 0) return startTicks
      if (index <= 0) {
        return startTicks + numericalDirection * index * incrementTicks
      }
      if (index < stepCount) {
        return (
          startTicks +
          numericalDirection * Math.min(distanceTicks, index * incrementTicks)
        )
      }
      if (index === stepCount) return endTicks
      return (
        endTicks +
        numericalDirection * (index - stepCount) * incrementTicks
      )
    }
    const outgoingScaled = ticksAtStep(outgoingIndex)
    const incomingScaled = ticksAtStep(incomingIndex)
    rawPhase = stepPosition - outgoingIndex
    outgoingText = formatNumberFlowValue(
      outgoingScaled / decimalScale,
      format,
    )
    incomingText = formatNumberFlowValue(
      incomingScaled / decimalScale,
      format,
    )
  }

  const phase = channelProgress(rawPhase, normalized.spinTimingRatio)
  const direction = resolvedTrendDirection(
    normalized.trend,
    startValue,
    endValue,
    format.decimals,
  )
  const outgoingFade = channelProgress(
    phase,
    normalized.opacityTimingRatio,
  )
  const incomingFade = channelProgress(
    1 - phase,
    normalized.opacityTimingRatio,
  )
  const blurEnvelope = Math.sin(Math.PI * phase)

  return {
    outgoingText,
    incomingText,
    outgoingOffsetEm: -direction * phase * normalized.spinDistance,
    incomingOffsetEm:
      direction * (1 - phase) * normalized.spinDistance,
    outgoingOpacity: clamp01(1 - normalized.fadeAmount * outgoingFade),
    incomingOpacity: clamp01(1 - normalized.fadeAmount * incomingFade),
    blurRadius: normalized.blurRadius * Math.max(0, blurEnvelope),
    maskHeightEm: normalized.maskHeight,
    maskWidthEm: normalized.maskWidth,
    phase,
    settledText: normalized.continuous
      ? formatNumberFlowValue(
          startValue + (endValue - startValue) * transformProgress,
          format,
        )
      : transformProgress < 0.5
        ? startText
        : endText,
  }
}

function normalizeVisualOptions(
  options: Partial<NumberFlowVisualOptions>,
): NumberFlowVisualOptions {
  return {
    trend:
      options.trend === 'up' ||
      options.trend === 'down' ||
      options.trend === 'individual'
        ? options.trend
        : 'auto',
    continuous: options.continuous ?? true,
    increment: normalizeIncrement(options.increment),
    spinDistance: clamp(finite(options.spinDistance, 1), 0.25, 2),
    fadeAmount: clamp01(finite(options.fadeAmount, 1)),
    maskHeight: clamp(finite(options.maskHeight, 0.25), 0, 1),
    maskWidth: clamp(finite(options.maskWidth, 0.5), 0, 2),
    transformTimingRatio: clamp(
      finite(options.transformTimingRatio, 1),
      0.05,
      1,
    ),
    spinTimingRatio: clamp(finite(options.spinTimingRatio, 1), 0.05, 1),
    opacityTimingRatio: clamp(
      finite(options.opacityTimingRatio, 0.5),
      0.05,
      1,
    ),
    blurRadius: clamp(finite(options.blurRadius, 8), 0, 32),
  }
}

function normalizeIncrement(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.min(value, 1_000_000_000_000_000)
}

function settledNumberFlowFrame(
  text: string,
  maskHeightEm: number,
  maskWidthEm: number,
): NumberFlowVisualFrame {
  return {
    outgoingText: text,
    incomingText: text,
    outgoingOffsetEm: 0,
    incomingOffsetEm: 0,
    outgoingOpacity: 1,
    incomingOpacity: 0,
    blurRadius: 0,
    maskHeightEm,
    maskWidthEm,
    phase: 0,
    settledText: text,
  }
}

/** Ratios describe how much of the authored segment a channel consumes. */
function channelProgress(progress: number, ratio: number): number {
  const safeRatio = clamp(finite(ratio, 1), 0.05, 1)
  return clampProgress(progress / safeRatio)
}

/**
 * Keep authored channel timing inside the 0→1 span while preserving easing
 * overshoot outside it. This lets a bounce roll beyond the target without
 * mistaking that early crossing for the actual destination keyframe.
 */
function channelProgressWithOvershoot(
  progress: number,
  ratio: number,
): number {
  const safeProgress = finite(progress, 0)
  const clampedProgress = clampProgress(safeProgress)
  return (
    channelProgress(clampedProgress, ratio) +
    safeProgress -
    clampedProgress
  )
}

function resolvedTrendDirection(
  trend: NumberFlowTrend,
  start: number,
  end: number,
  decimals: number,
): 1 | -1 {
  if (trend === 'up') return 1
  if (trend === 'down') return -1
  if (trend !== 'individual') return end >= start ? 1 : -1

  const scale = 10 ** Math.max(0, Math.trunc(decimals))
  const startDigit = positiveModulo(Math.round(start * scale), 10)
  const endDigit = positiveModulo(Math.round(end * scale), 10)
  const upward = positiveModulo(endDigit - startDigit, 10)
  const downward = positiveModulo(startDigit - endDigit, 10)
  return upward <= downward ? 1 : -1
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function numberFormatter(decimals: number, useGrouping: boolean): Intl.NumberFormat {
  const key = `${useGrouping ? 1 : 0}:${decimals}`
  const cached = formatterCache.get(key)
  if (cached) return cached

  const formatter = new Intl.NumberFormat('en-US', {
    useGrouping,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  formatterCache.set(key, formatter)
  return formatter
}

function roundsToZero(value: number, decimals: number): boolean {
  if (value === 0 || Object.is(value, -0)) return true
  // Intl would otherwise expose values such as -0.004 as "-0.00". Use the
  // same half-unit threshold as decimal rounding and keep exact half values.
  const halfUnit = 0.5 * 10 ** -decimals
  return halfUnit > 0 && Math.abs(value) < halfUnit
}

function clampProgress(progress: number): number {
  if (Number.isNaN(progress) || progress <= 0) return 0
  if (progress >= 1) return 1
  return progress
}
