// SPDX-License-Identifier: Apache-2.0

export interface ParsedNumberFlowText {
  value: number
  prefix: string
  suffix: string
  decimals: number
  useGrouping: boolean
}

export type NumberFlowTrend = 'auto' | 'up' | 'down' | 'individual'
export type NumberFlowDigitMode = 'together' | 'staggered'
export type NumberFlowDigitOrder = 'forward' | 'backward'

export type NumberFlowVisualTokenKind =
  | 'prefix'
  | 'digit'
  | 'separator'
  | 'suffix'

/**
 * One stable visual column in a Number Flow frame.
 *
 * `key` and array order are deterministic across preview seeks and exports.
 * Missing characters are represented by an empty string so renderers can
 * retain the column while measuring the currently settled text separately.
 */
export interface NumberFlowVisualToken {
  key: string
  kind: NumberFlowVisualTokenKind
  outgoingChar: string
  incomingChar: string
  outgoingOffsetEm: number
  incomingOffsetEm: number
  outgoingOpacity: number
  incomingOpacity: number
  blurRadius: number
  phase: number
  active: boolean
}

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
  digitMode: NumberFlowDigitMode
  digitOrder: NumberFlowDigitOrder
  /** Portion of the authored segment reserved for delays between digits. */
  digitStagger: number
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
  /** Stable display-order columns for independent digit rendering. */
  tokens: NumberFlowVisualToken[]
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
  digitMode: 'together',
  digitOrder: 'forward',
  digitStagger: 0.25,
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
  numberFlowDigitMode?: NumberFlowDigitMode
  numberFlowDigitOrder?: NumberFlowDigitOrder
  numberFlowDigitStagger?: number
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
    digitMode: config.numberFlowDigitMode ?? 'together',
    digitOrder: config.numberFlowDigitOrder ?? 'forward',
    digitStagger: config.numberFlowDigitStagger ?? 0.25,
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
      format,
      [startText, endText],
    )
  }
  if (timelineT >= 1) {
    return settledNumberFlowFrame(
      endText,
      normalized.maskHeight,
      normalized.maskWidth,
      format,
      [startText, endText],
    )
  }

  const transformProgress = channelProgressWithOvershoot(
    easedProgress,
    normalized.transformTimingRatio,
  )
  const transition = numberTransitionAtProgress(
    format,
    startValue,
    endValue,
    transformProgress,
    normalized,
    startText,
    endText,
  )

  const phase = channelProgress(
    transition.rawPhase,
    normalized.spinTimingRatio,
  )
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
    outgoingText: transition.outgoingText,
    incomingText: transition.incomingText,
    outgoingOffsetEm: -direction * phase * normalized.spinDistance,
    incomingOffsetEm:
      direction * (1 - phase) * normalized.spinDistance,
    outgoingOpacity: clamp01(1 - normalized.fadeAmount * outgoingFade),
    incomingOpacity: clamp01(1 - normalized.fadeAmount * incomingFade),
    blurRadius: normalized.blurRadius * Math.max(0, blurEnvelope),
    maskHeightEm: normalized.maskHeight,
    maskWidthEm: normalized.maskWidth,
    phase,
    settledText: transition.settledText,
    tokens: numberFlowVisualTokens(
      format,
      startValue,
      endValue,
      startText,
      endText,
      transformProgress,
      transition,
      normalized,
    ),
  }
}

interface NumberFlowTransition {
  outgoingText: string
  incomingText: string
  rawPhase: number
  settledText: string
}

function numberTransitionAtProgress(
  format: ParsedNumberFlowText,
  startValue: number,
  endValue: number,
  transformProgress: number,
  options: NumberFlowVisualOptions,
  authoredStartText = formatNumberFlowValue(startValue, format),
  authoredEndText = formatNumberFlowValue(endValue, format),
): NumberFlowTransition {
  if (!options.continuous) {
    return {
      outgoingText: authoredStartText,
      incomingText: authoredEndText,
      rawPhase: transformProgress,
      settledText:
        transformProgress < 0.5 ? authoredStartText : authoredEndText,
    }
  }

  const decimalScale = 10 ** Math.max(0, Math.trunc(format.decimals))
  const startTicks = Math.round(startValue * decimalScale)
  const endTicks = Math.round(endValue * decimalScale)
  const distanceTicks = Math.abs(endTicks - startTicks)
  const numericalDirection = endValue >= startValue ? 1 : -1
  const incrementTicks =
    options.increment === null
      ? 1
      : Math.max(
          1,
          Math.min(
            Number.MAX_SAFE_INTEGER,
            Math.round(options.increment * decimalScale),
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
      endTicks + numericalDirection * (index - stepCount) * incrementTicks
    )
  }
  const outgoingScaled = ticksAtStep(outgoingIndex)
  const incomingScaled = ticksAtStep(incomingIndex)

  return {
    outgoingText: formatNumberFlowValue(outgoingScaled / decimalScale, format),
    incomingText: formatNumberFlowValue(incomingScaled / decimalScale, format),
    rawPhase: stepPosition - outgoingIndex,
    settledText: formatNumberFlowValue(
      startValue + (endValue - startValue) * transformProgress,
      format,
    ),
  }
}

interface NumberFlowDisplayParts {
  negative: boolean
  integerDigits: string
  fractionDigits: string
}

type NumberFlowTokenSlot =
  | {
      key: string
      kind: 'prefix' | 'suffix'
      staticChar: string
    }
  | {
      key: string
      kind: 'digit'
      section: 'integer' | 'fraction'
      position: number
    }
  | {
      key: string
      kind: 'separator'
      separator: 'sign' | 'group' | 'decimal'
      place?: number
    }

function numberFlowVisualTokens(
  format: ParsedNumberFlowText,
  startValue: number,
  endValue: number,
  startText: string,
  endText: string,
  transformProgress: number,
  transition: NumberFlowTransition,
  options: NumberFlowVisualOptions,
): NumberFlowVisualToken[] {
  const slots = numberFlowTokenSlots(format, [
    startText,
    endText,
  ])
  const digitSlots = slots.filter(
    (slot): slot is Extract<NumberFlowTokenSlot, { kind: 'digit' }> =>
      slot.kind === 'digit',
  )
  const digitOrder = new Map(
    digitSlots.map((slot, index) => [slot.key, index]),
  )
  const transitionCache = new Map<number, NumberFlowTransition>()
  const transitionForSlot = (
    slotIndex: number,
    slot: NumberFlowTokenSlot,
  ): NumberFlowTransition => {
    if (options.digitMode !== 'staggered' || digitSlots.length <= 1) {
      return transition
    }
    const relatedDigitKey = relatedDigitSlotKey(slots, slotIndex, slot)
    const displayIndex =
      relatedDigitKey === null ? 0 : (digitOrder.get(relatedDigitKey) ?? 0)
    const orderIndex =
      options.digitOrder === 'backward'
        ? digitSlots.length - 1 - displayIndex
        : displayIndex
    const delay =
      digitSlots.length <= 1
        ? 0
        : options.digitStagger * (orderIndex / (digitSlots.length - 1))
    const cached = transitionCache.get(delay)
    if (cached) return cached

    const localProgress = staggeredChannelProgress(
      transformProgress,
      delay,
      options.digitStagger,
    )
    const localTransition = numberTransitionAtProgress(
      format,
      startValue,
      endValue,
      localProgress,
      options,
      startText,
      endText,
    )
    transitionCache.set(delay, localTransition)
    return localTransition
  }

  return slots.map((slot, slotIndex) => {
    if (slot.kind === 'prefix' || slot.kind === 'suffix') {
      return staticNumberFlowToken(slot, slot.staticChar)
    }

    const localTransition = transitionForSlot(slotIndex, slot)
    const outgoingChar = numberFlowCharAtSlot(
      slot,
      localTransition.outgoingText,
      format,
    )
    const incomingChar = numberFlowCharAtSlot(
      slot,
      localTransition.incomingText,
      format,
    )
    if (outgoingChar === incomingChar) {
      return staticNumberFlowToken(slot, outgoingChar)
    }

    const phase = channelProgress(
      localTransition.rawPhase,
      options.spinTimingRatio,
    )
    const outgoingFade = channelProgress(phase, options.opacityTimingRatio)
    const incomingFade = channelProgress(
      1 - phase,
      options.opacityTimingRatio,
    )
    const blurEnvelope = Math.sin(Math.PI * phase)
    const rolls = slot.kind === 'digit'
    const direction = rolls
      ? resolvedTokenDirection(
          options.trend,
          outgoingChar,
          incomingChar,
          startValue,
          endValue,
          format.decimals,
        )
      : 0

    return {
      key: slot.key,
      kind: slot.kind,
      outgoingChar,
      incomingChar,
      outgoingOffsetEm: -direction * phase * options.spinDistance,
      incomingOffsetEm: direction * (1 - phase) * options.spinDistance,
      outgoingOpacity: clamp01(1 - options.fadeAmount * outgoingFade),
      incomingOpacity: clamp01(1 - options.fadeAmount * incomingFade),
      blurRadius: options.blurRadius * Math.max(0, blurEnvelope),
      phase,
      active: true,
    }
  })
}

function numberFlowTokenSlots(
  format: ParsedNumberFlowText,
  texts: readonly string[],
): NumberFlowTokenSlot[] {
  const displays = texts.map((text) => numberFlowDisplayParts(text, format))
  const maxIntegerDigits = Math.max(
    1,
    ...displays.map((display) => display.integerDigits.length),
  )
  const slots: NumberFlowTokenSlot[] = Array.from(format.prefix).map(
    (char, index) => ({
      key: `prefix:${index}`,
      kind: 'prefix' as const,
      staticChar: char,
    }),
  )

  if (displays.some((display) => display.negative)) {
    slots.push({ key: 'separator:sign', kind: 'separator', separator: 'sign' })
  }
  for (let place = maxIntegerDigits - 1; place >= 0; place -= 1) {
    if (
      format.useGrouping &&
      place < maxIntegerDigits - 1 &&
      (place + 1) % 3 === 0
    ) {
      slots.push({
        key: `separator:group:${place}`,
        kind: 'separator',
        separator: 'group',
        place,
      })
    }
    slots.push({
      key: `digit:integer:${place}`,
      kind: 'digit',
      section: 'integer',
      position: place,
    })
  }
  if (format.decimals > 0) {
    slots.push({
      key: 'separator:decimal',
      kind: 'separator',
      separator: 'decimal',
    })
    for (let position = 0; position < format.decimals; position += 1) {
      slots.push({
        key: `digit:fraction:${position}`,
        kind: 'digit',
        section: 'fraction',
        position,
      })
    }
  }
  slots.push(
    ...Array.from(format.suffix).map((char, index) => ({
      key: `suffix:${index}`,
      kind: 'suffix' as const,
      staticChar: char,
    })),
  )
  return slots
}

function numberFlowDisplayParts(
  text: string,
  format: ParsedNumberFlowText,
): NumberFlowDisplayParts {
  const suffixStart = Math.max(format.prefix.length, text.length - format.suffix.length)
  const numericText = text.slice(format.prefix.length, suffixStart)
  const match = /^(-?)([\d,]+)(?:\.(\d+))?$/.exec(numericText)
  if (!match) {
    return { negative: false, integerDigits: '', fractionDigits: '' }
  }
  return {
    negative: match[1] === '-',
    integerDigits: match[2]!.replaceAll(',', ''),
    fractionDigits: match[3] ?? '',
  }
}

function numberFlowCharAtSlot(
  slot: NumberFlowTokenSlot,
  text: string,
  format: ParsedNumberFlowText,
): string {
  if ('staticChar' in slot) {
    return slot.staticChar
  }
  const display = numberFlowDisplayParts(text, format)
  if (slot.kind === 'digit') {
    if (slot.section === 'fraction') {
      return display.fractionDigits[slot.position] ?? ''
    }
    return (
      display.integerDigits[
        display.integerDigits.length - 1 - slot.position
      ] ?? ''
    )
  }
  if (slot.separator === 'sign') return display.negative ? '-' : ''
  if (slot.separator === 'decimal') return format.decimals > 0 ? '.' : ''
  const place = slot.place ?? 0
  return display.integerDigits.length > place + 1 ? ',' : ''
}

function relatedDigitSlotKey(
  slots: readonly NumberFlowTokenSlot[],
  slotIndex: number,
  slot: NumberFlowTokenSlot,
): string | null {
  if (slot.kind === 'digit') return slot.key
  if (slot.kind !== 'separator') return null

  for (let index = slotIndex + 1; index < slots.length; index += 1) {
    if (slots[index]!.kind === 'digit') return slots[index]!.key
  }
  for (let index = slotIndex - 1; index >= 0; index -= 1) {
    if (slots[index]!.kind === 'digit') return slots[index]!.key
  }
  return null
}

function staticNumberFlowToken(
  slot: NumberFlowTokenSlot,
  char: string,
): NumberFlowVisualToken {
  return {
    key: slot.key,
    kind: slot.kind,
    outgoingChar: char,
    incomingChar: char,
    outgoingOffsetEm: 0,
    incomingOffsetEm: 0,
    outgoingOpacity: 1,
    incomingOpacity: 0,
    blurRadius: 0,
    phase: 0,
    active: false,
  }
}

function staggeredChannelProgress(
  progress: number,
  delay: number,
  maximumDelay: number,
): number {
  const safeProgress = finite(progress, 0)
  const clampedProgress = clampProgress(safeProgress)
  const activeSpan = Math.max(0.1, 1 - maximumDelay)
  return (
    clampProgress((clampedProgress - delay) / activeSpan) +
    safeProgress -
    clampedProgress
  )
}

function resolvedTokenDirection(
  trend: NumberFlowTrend,
  outgoingChar: string,
  incomingChar: string,
  start: number,
  end: number,
  decimals: number,
): 1 | -1 {
  if (trend !== 'individual') {
    return resolvedTrendDirection(trend, start, end, decimals)
  }
  if (/^\d$/.test(outgoingChar) && /^\d$/.test(incomingChar)) {
    const outgoingDigit = Number(outgoingChar)
    const incomingDigit = Number(incomingChar)
    const upward = positiveModulo(incomingDigit - outgoingDigit, 10)
    const downward = positiveModulo(outgoingDigit - incomingDigit, 10)
    return upward <= downward ? 1 : -1
  }
  return end >= start ? 1 : -1
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
    digitMode:
      options.digitMode === 'staggered' ? 'staggered' : 'together',
    digitOrder:
      options.digitOrder === 'backward' ? 'backward' : 'forward',
    digitStagger: clamp(finite(options.digitStagger, 0.25), 0, 0.9),
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
  format = parseNumberFlowText(text),
  layoutTexts: readonly string[] = [text],
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
    tokens: settledNumberFlowTokens(text, format, layoutTexts),
  }
}

function settledNumberFlowTokens(
  text: string,
  format: ParsedNumberFlowText | null,
  layoutTexts: readonly string[],
): NumberFlowVisualToken[] {
  if (!format) {
    return Array.from(text).map((char, index) =>
      staticNumberFlowToken(
        { key: `prefix:${index}`, kind: 'prefix', staticChar: char },
        char,
      ),
    )
  }
  return numberFlowTokenSlots(format, layoutTexts).map((slot) =>
    staticNumberFlowToken(slot, numberFlowCharAtSlot(slot, text, format)),
  )
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
