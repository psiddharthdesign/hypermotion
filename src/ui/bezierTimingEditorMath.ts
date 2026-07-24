// SPDX-License-Identifier: Apache-2.0

export type BezierTimingValue = [number, number, number, number]
export type BezierTimingHandle = 1 | 2

export interface BezierTimingGraphBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BezierTimingPoint {
  x: number
  y: number
}

export const BEZIER_TIMING_Y_MIN = -2
export const BEZIER_TIMING_Y_MAX = 3

const DEFAULT_BEZIER_TIMING: BezierTimingValue = [0.42, 0, 0.58, 1]
const NORMAL_RANGE_START = 0.2
const NORMAL_RANGE_END = 0.8

export function clampBezierTiming(
  value: readonly [number, number, number, number],
): BezierTimingValue {
  return [
    finiteOr(value[0], DEFAULT_BEZIER_TIMING[0], 0, 1),
    finiteOr(
      value[1],
      DEFAULT_BEZIER_TIMING[1],
      BEZIER_TIMING_Y_MIN,
      BEZIER_TIMING_Y_MAX,
    ),
    finiteOr(value[2], DEFAULT_BEZIER_TIMING[2], 0, 1),
    finiteOr(
      value[3],
      DEFAULT_BEZIER_TIMING[3],
      BEZIER_TIMING_Y_MIN,
      BEZIER_TIMING_Y_MAX,
    ),
  ]
}

export function updateBezierTimingHandle(
  value: readonly [number, number, number, number],
  handle: BezierTimingHandle,
  x: number,
  y: number,
): BezierTimingValue {
  const next = clampBezierTiming(value)
  const offset = handle === 1 ? 0 : 2
  next[offset] = clamp(finiteOrZero(x), 0, 1)
  next[offset + 1] = clamp(
    finiteOrZero(y),
    BEZIER_TIMING_Y_MIN,
    BEZIER_TIMING_Y_MAX,
  )
  return next
}

/**
 * Projects timing-space coordinates into the editor.
 *
 * The normal 0..1 value band receives most of the vertical space, while the
 * -2..0 and 1..3 overshoot bands are compressed. This keeps ordinary curves
 * legible without preventing expressive overshoot values.
 */
export function projectBezierTimingPoint(
  point: BezierTimingPoint,
  bounds: BezierTimingGraphBounds,
): BezierTimingPoint {
  const x = clamp(finiteOrZero(point.x), 0, 1)
  const y = clamp(
    finiteOrZero(point.y),
    BEZIER_TIMING_Y_MIN,
    BEZIER_TIMING_Y_MAX,
  )
  return {
    x: bounds.x + x * bounds.width,
    y: bounds.y + (1 - compressTimingY(y)) * bounds.height,
  }
}

/**
 * Converts an editor-space pointer into timing-space coordinates. Points
 * outside the graph remain useful while dragging: the result is clamped only
 * at the timing model's supported x/y limits.
 */
export function unprojectBezierTimingPoint(
  point: BezierTimingPoint,
  bounds: BezierTimingGraphBounds,
): BezierTimingPoint {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 }
  const normalizedX = (point.x - bounds.x) / bounds.width
  const normalizedY = 1 - (point.y - bounds.y) / bounds.height
  return {
    x: clamp(normalizedX, 0, 1),
    y: clamp(
      expandTimingY(normalizedY),
      BEZIER_TIMING_Y_MIN,
      BEZIER_TIMING_Y_MAX,
    ),
  }
}

export function evaluateBezierTiming(
  value: readonly [number, number, number, number],
  progress: number,
): BezierTimingPoint {
  const [x1, y1, x2, y2] = clampBezierTiming(value)
  const t = clamp(finiteOrZero(progress), 0, 1)
  const oneMinusT = 1 - t
  const a = 3 * oneMinusT * oneMinusT * t
  const b = 3 * oneMinusT * t * t
  const c = t * t * t
  return {
    x: a * x1 + b * x2 + c,
    y: a * y1 + b * y2 + c,
  }
}

/**
 * Samples the cubic before projection so the compressed overshoot bands do
 * not distort the semantic shape of the curve.
 */
export function buildBezierTimingPath(
  value: readonly [number, number, number, number],
  bounds: BezierTimingGraphBounds,
  segmentCount = 64,
): string {
  const segments = Math.max(8, Math.round(segmentCount))
  const points: string[] = []
  for (let index = 0; index <= segments; index += 1) {
    const timingPoint = evaluateBezierTiming(value, index / segments)
    const point = projectBezierTimingPoint(timingPoint, bounds)
    points.push(
      `${index === 0 ? 'M' : 'L'} ${formatPathNumber(point.x)} ${formatPathNumber(point.y)}`,
    )
  }
  return points.join(' ')
}

function compressTimingY(y: number): number {
  if (y <= 0) {
    return ((y - BEZIER_TIMING_Y_MIN) / -BEZIER_TIMING_Y_MIN) *
      NORMAL_RANGE_START
  }
  if (y <= 1) {
    return NORMAL_RANGE_START +
      y * (NORMAL_RANGE_END - NORMAL_RANGE_START)
  }
  return NORMAL_RANGE_END +
    ((y - 1) / (BEZIER_TIMING_Y_MAX - 1)) *
      (1 - NORMAL_RANGE_END)
}

function expandTimingY(normalized: number): number {
  if (normalized <= NORMAL_RANGE_START) {
    return (
      BEZIER_TIMING_Y_MIN +
      (normalized / NORMAL_RANGE_START) * -BEZIER_TIMING_Y_MIN
    )
  }
  if (normalized <= NORMAL_RANGE_END) {
    return (
      (normalized - NORMAL_RANGE_START) /
      (NORMAL_RANGE_END - NORMAL_RANGE_START)
    )
  }
  return (
    1 +
    ((normalized - NORMAL_RANGE_END) / (1 - NORMAL_RANGE_END)) *
      (BEZIER_TIMING_Y_MAX - 1)
  )
}

function finiteOr(
  value: number,
  fallback: number,
  min: number,
  max: number,
): number {
  return clamp(Number.isFinite(value) ? value : fallback, min, max)
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function formatPathNumber(value: number): string {
  return Number(value.toFixed(3)).toString()
}
