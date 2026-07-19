// SPDX-License-Identifier: Apache-2.0

export interface TextStaggerCurvePoint {
  id: string
  x: number
  y: number
  inX: number
  inY: number
  outX: number
  outY: number
}

export interface TextStaggerCurve {
  version: 1
  points: TextStaggerCurvePoint[]
}

export type TextStaggerCurvePreset = 'none' | 'soft' | 'smooth'

export const MAX_TEXT_STAGGER_CURVE_POINTS = 12
const MIN_POINT_GAP = 0.005

/** Create an editable spline that visually matches a simple preset profile. */
export function textStaggerCurveForPreset(
  preset: TextStaggerCurvePreset,
): TextStaggerCurve {
  const handles =
    preset === 'smooth'
      ? [0.18, 0, 0.82, 1]
      : preset === 'soft'
        ? [0.28, 0.12, 0.72, 0.88]
        : [1 / 3, 1 / 3, 2 / 3, 2 / 3]
  return {
    version: 1,
    points: [
      {
        id: 'curve-start',
        x: 0,
        y: 0,
        inX: 0,
        inY: 0,
        outX: handles[0]!,
        outY: handles[1]!,
      },
      {
        id: 'curve-end',
        x: 1,
        y: 1,
        inX: handles[2]!,
        inY: handles[3]!,
        outX: 1,
        outY: 1,
      },
    ],
  }
}

/**
 * Normalize a saved/editor spline into a bounded monotonic function.
 * Anchors and controls progress from (0,0) to (1,1), so letters cannot
 * reverse order, jump outside their authored travel, or produce an
 * uninvertible x-axis during evaluation.
 */
export function normalizeTextStaggerCurve(
  raw: unknown,
): TextStaggerCurve | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as { version?: unknown; points?: unknown }
  if (candidate.version !== 1) return null
  if (!Array.isArray(candidate.points)) return null

  const sorted = candidate.points
    .flatMap((entry, sourceIndex) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const point = entry as Record<string, unknown>
      if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return []
      return [{
        id:
          typeof point.id === 'string' && point.id.trim().length > 0
            ? point.id.trim()
            : `curve-point-${sourceIndex}`,
        x: point.x,
        y: point.y,
        inX: finiteOrNaN(point.inX),
        inY: finiteOrNaN(point.inY),
        outX: finiteOrNaN(point.outX),
        outY: finiteOrNaN(point.outY),
      }]
    })
    .sort((a, b) => a.x - b.x)

  const parsed = capCurvePoints(sorted)

  if (parsed.length < 2) return null

  const usedIds = new Set<string>()
  for (let index = 0; index < parsed.length; index++) {
    const point = parsed[index]!
    let id = point.id
    if (usedIds.has(id)) id = `${id}-${index}`
    usedIds.add(id)
    point.id = id

    if (index === 0) {
      point.x = 0
      point.y = 0
      continue
    }
    if (index === parsed.length - 1) {
      point.x = 1
      point.y = 1
      continue
    }
    const previous = parsed[index - 1]!
    const remaining = parsed.length - index - 1
    point.x = clamp(
      point.x,
      previous.x + MIN_POINT_GAP,
      1 - remaining * MIN_POINT_GAP,
    )
    point.y = clamp(point.y, previous.y, 1)
  }

  for (let index = 0; index < parsed.length - 1; index++) {
    const left = parsed[index]!
    const right = parsed[index + 1]!
    const defaultOutX = left.x + (right.x - left.x) / 3
    const defaultOutY = left.y + (right.y - left.y) / 3
    const defaultInX = left.x + ((right.x - left.x) * 2) / 3
    const defaultInY = left.y + ((right.y - left.y) * 2) / 3
    left.outX = clamp(
      Number.isFinite(left.outX) ? left.outX : defaultOutX,
      left.x,
      right.x,
    )
    left.outY = clamp(
      Number.isFinite(left.outY) ? left.outY : defaultOutY,
      left.y,
      right.y,
    )
    right.inX = clamp(
      Number.isFinite(right.inX) ? right.inX : defaultInX,
      left.outX,
      right.x,
    )
    right.inY = clamp(
      Number.isFinite(right.inY) ? right.inY : defaultInY,
      left.outY,
      right.y,
    )
  }

  const first = parsed[0]!
  first.inX = first.x
  first.inY = first.y
  const last = parsed[parsed.length - 1]!
  last.outX = last.x
  last.outY = last.y

  return { version: 1, points: parsed }
}

/** Allocation-free piecewise cubic evaluation for the per-glyph hot path. */
export function evaluateTextStaggerCurve(
  progress: number,
  curve: TextStaggerCurve | null | undefined,
): number {
  const x = clamp01(Number.isFinite(progress) ? progress : 0)
  const points = curve?.points
  if (!points || points.length < 2) return x
  if (x <= 0) return 0
  if (x >= 1) return 1

  let segmentIndex = points.length - 2
  for (let index = 0; index < points.length - 1; index++) {
    if (x <= points[index + 1]!.x) {
      segmentIndex = index
      break
    }
  }
  const left = points[segmentIndex]!
  const right = points[segmentIndex + 1]!
  if (Math.abs(x - left.x) <= 1e-9) return clamp01(left.y)
  if (Math.abs(x - right.x) <= 1e-9) return clamp01(right.y)
  const t = solveBezierParameter(
    x,
    left.x,
    left.outX,
    right.inX,
    right.x,
  )
  return clamp01(cubicAt(left.y, left.outY, right.inY, right.y, t))
}

/** Add an anchor without changing the existing curve's rendered shape. */
export function splitTextStaggerCurveAt(
  curve: TextStaggerCurve,
  progressX: number,
  id: string,
): TextStaggerCurve {
  const normalized = normalizeTextStaggerCurve(curve)
  if (!normalized) return textStaggerCurveForPreset('none')
  const points = normalized.points
  if (points.length >= MAX_TEXT_STAGGER_CURVE_POINTS) return normalized
  const x = clamp(progressX, MIN_POINT_GAP, 1 - MIN_POINT_GAP)

  let segmentIndex = points.length - 2
  for (let index = 0; index < points.length - 1; index++) {
    if (x <= points[index + 1]!.x) {
      segmentIndex = index
      break
    }
  }
  const left = points[segmentIndex]!
  const right = points[segmentIndex + 1]!
  if (
    x - left.x < MIN_POINT_GAP ||
    right.x - x < MIN_POINT_GAP
  ) {
    return normalized
  }

  const t = solveBezierParameter(
    x,
    left.x,
    left.outX,
    right.inX,
    right.x,
  )
  const ax = lerp(left.x, left.outX, t)
  const ay = lerp(left.y, left.outY, t)
  const bx = lerp(left.outX, right.inX, t)
  const by = lerp(left.outY, right.inY, t)
  const cx = lerp(right.inX, right.x, t)
  const cy = lerp(right.inY, right.y, t)
  const dx = lerp(ax, bx, t)
  const dy = lerp(ay, by, t)
  const ex = lerp(bx, cx, t)
  const ey = lerp(by, cy, t)
  const fx = lerp(dx, ex, t)
  const fy = lerp(dy, ey, t)

  const nextPoints = points.map((point) => ({ ...point }))
  nextPoints[segmentIndex]!.outX = ax
  nextPoints[segmentIndex]!.outY = ay
  nextPoints[segmentIndex + 1]!.inX = cx
  nextPoints[segmentIndex + 1]!.inY = cy
  nextPoints.splice(segmentIndex + 1, 0, {
    id,
    x: fx,
    y: fy,
    inX: dx,
    inY: dy,
    outX: ex,
    outY: ey,
  })
  return normalizeTextStaggerCurve({ version: 1, points: nextPoints })!
}

export function removeTextStaggerCurvePoint(
  curve: TextStaggerCurve,
  pointId: string,
): TextStaggerCurve {
  const normalized = normalizeTextStaggerCurve(curve)
  if (!normalized) return textStaggerCurveForPreset('none')
  const index = normalized.points.findIndex((point) => point.id === pointId)
  if (index <= 0 || index >= normalized.points.length - 1) return normalized
  return normalizeTextStaggerCurve({
    version: 1,
    points: normalized.points.filter((point) => point.id !== pointId),
  })!
}

function solveBezierParameter(
  x: number,
  x0: number,
  x1: number,
  x2: number,
  x3: number,
): number {
  const span = Math.max(1e-9, x3 - x0)
  let low = 0
  let high = 1
  let t = clamp01((x - x0) / span)
  // Maintain a bracket for every Newton step. Aggressive but valid handles
  // can make dx/dt almost flat near an endpoint; an unbracketed solve can
  // then jump to a coarser branch and make a monotonic curve shimmer backward.
  for (let iteration = 0; iteration < 22; iteration++) {
    const sampledX = cubicAt(x0, x1, x2, x3, t)
    const error = sampledX - x
    if (Math.abs(error) < 1e-10) return t
    if (sampledX < x) low = t
    else high = t
    const derivative = cubicDerivativeAt(x0, x1, x2, x3, t)
    const newton = t - error / derivative
    t =
      Math.abs(derivative) > 1e-10 && newton > low && newton < high
        ? newton
        : (low + high) / 2
  }
  return t
}

function capCurvePoints(
  sorted: TextStaggerCurvePoint[],
): TextStaggerCurvePoint[] {
  if (sorted.length <= MAX_TEXT_STAGGER_CURVE_POINTS) return sorted
  const lastIndex = sorted.length - 1
  const interiorSlots = MAX_TEXT_STAGGER_CURVE_POINTS - 2
  const capped = [sorted[0]!]
  for (let slot = 0; slot < interiorSlots; slot++) {
    const sourceIndex = 1 + Math.round(
      (slot * (lastIndex - 2)) / Math.max(1, interiorSlots - 1),
    )
    capped.push(sorted[sourceIndex]!)
  }
  capped.push(sorted[lastIndex]!)
  return capped
}

function cubicAt(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const inverse = 1 - t
  return (
    inverse * inverse * inverse * p0 +
    3 * inverse * inverse * t * p1 +
    3 * inverse * t * t * p2 +
    t * t * t * p3
  )
}

function cubicDerivativeAt(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const inverse = 1 - t
  return 3 * (
    inverse * inverse * (p1 - p0) +
    2 * inverse * t * (p2 - p1) +
    t * t * (p3 - p2)
  )
}

function finiteOrNaN(value: unknown): number {
  return isFiniteNumber(value) ? value : Number.NaN
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}
