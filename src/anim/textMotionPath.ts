// SPDX-License-Identifier: Apache-2.0

/**
 * One anchor on a text segment's editable spatial motion path.
 *
 * `t` uses the same amount convention as the text renderers: zero is the
 * settled text position and one is the fully displaced start of an entrance.
 * Spatial values and handles are absolute, local coordinates measured in line
 * heights. Positive X moves right, positive Y moves down, and positive Z moves
 * toward the viewer.
 */
export interface TextMotionPathPoint {
  id: string
  t: number
  x: number
  y: number
  z: number
  inX: number
  inY: number
  inZ: number
  outX: number
  outY: number
  outZ: number
}

export interface TextMotionPath {
  version: 1
  points: TextMotionPathPoint[]
}

export interface TextMotionPathOffset {
  x: number
  y: number
  z: number
}

export const MAX_TEXT_MOTION_PATH_POINTS = 12

const MIN_POINT_GAP = 0.005
const MIN_SPATIAL_VALUE = -10
const MAX_SPATIAL_VALUE = 10

/** A generous left-bowed fall from four line heights above the text. */
export function defaultTextMotionPath(): TextMotionPath {
  return {
    version: 1,
    points: [
      {
        id: 'motion-path-settled',
        t: 0,
        x: 0,
        y: 0,
        z: 0,
        inX: 0,
        inY: 0,
        inZ: 0,
        outX: -1.8,
        outY: -0.2,
        outZ: 0,
      },
      {
        id: 'motion-path-start',
        t: 1,
        x: 0,
        y: -4,
        z: 0,
        inX: -2.2,
        inY: -2.7,
        inZ: 0,
        outX: 0,
        outY: -4,
        outZ: 0,
      },
    ],
  }
}

/**
 * Convert saved or editor-authored data into a bounded piecewise cubic path.
 *
 * Time is monotonic, but the spatial axes deliberately are not. A motion path
 * may bow, loop, or briefly reverse in space. Only the settled anchor is fixed
 * so every animation lands on the text's authored layout exactly.
 */
export function normalizeTextMotionPath(raw: unknown): TextMotionPath | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as { version?: unknown; points?: unknown }
  if (candidate.version !== 1 || !Array.isArray(candidate.points)) return null

  const sorted = candidate.points
    .flatMap((entry, sourceIndex) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const point = entry as Record<string, unknown>
      if (
        !isFiniteNumber(point.t) ||
        !isFiniteNumber(point.x) ||
        !isFiniteNumber(point.y)
      ) {
        return []
      }
      return [{
        id:
          typeof point.id === 'string' && point.id.trim().length > 0
            ? point.id.trim()
            : `motion-path-point-${sourceIndex}`,
        t: point.t,
        x: point.x,
        y: point.y,
        z: finiteOr(point.z, 0),
        inX: finiteOrNaN(point.inX),
        inY: finiteOrNaN(point.inY),
        inZ: finiteOrNaN(point.inZ),
        outX: finiteOrNaN(point.outX),
        outY: finiteOrNaN(point.outY),
        outZ: finiteOrNaN(point.outZ),
      }]
    })
    .sort((a, b) => a.t - b.t)

  const parsed = capPathPoints(sorted)
  if (parsed.length < 2) return null

  const usedIds = new Set<string>()
  for (let index = 0; index < parsed.length; index++) {
    const point = parsed[index]!
    point.id = uniquePointId(point.id, index, usedIds)
    point.x = clampSpatial(point.x)
    point.y = clampSpatial(point.y)
    point.z = clampSpatial(point.z)

    if (index === 0) {
      point.t = 0
      point.x = 0
      point.y = 0
      point.z = 0
      continue
    }
    if (index === parsed.length - 1) {
      point.t = 1
      continue
    }
    const previous = parsed[index - 1]!
    const remaining = parsed.length - index - 1
    point.t = clamp(
      point.t,
      previous.t + MIN_POINT_GAP,
      1 - remaining * MIN_POINT_GAP,
    )
  }

  for (let index = 0; index < parsed.length - 1; index++) {
    const left = parsed[index]!
    const right = parsed[index + 1]!
    left.outX = normalizedHandle(left.outX, lerp(left.x, right.x, 1 / 3))
    left.outY = normalizedHandle(left.outY, lerp(left.y, right.y, 1 / 3))
    left.outZ = normalizedHandle(left.outZ, lerp(left.z, right.z, 1 / 3))
    right.inX = normalizedHandle(right.inX, lerp(left.x, right.x, 2 / 3))
    right.inY = normalizedHandle(right.inY, lerp(left.y, right.y, 2 / 3))
    right.inZ = normalizedHandle(right.inZ, lerp(left.z, right.z, 2 / 3))
  }

  const settled = parsed[0]!
  settled.inX = settled.x
  settled.inY = settled.y
  settled.inZ = settled.z
  const start = parsed[parsed.length - 1]!
  start.outX = start.x
  start.outY = start.y
  start.outZ = start.z

  return { version: 1, points: parsed }
}

/** Evaluate the spatial displacement at a text animation amount. */
export function evaluateTextMotionPath(
  amount: number,
  path: TextMotionPath | null | undefined,
): TextMotionPathOffset {
  const points = path?.points
  if (!points || points.length < 2) return { x: 0, y: 0, z: 0 }

  const t = clamp01(Number.isFinite(amount) ? amount : 0)
  if (t <= points[0]!.t) return pointOffset(points[0]!)
  if (t >= points[points.length - 1]!.t) {
    return pointOffset(points[points.length - 1]!)
  }

  let segmentIndex = points.length - 2
  for (let index = 0; index < points.length - 1; index++) {
    if (t <= points[index + 1]!.t) {
      segmentIndex = index
      break
    }
  }
  const left = points[segmentIndex]!
  const right = points[segmentIndex + 1]!
  const localT = clamp01((t - left.t) / Math.max(1e-9, right.t - left.t))
  return {
    x: cubicAt(left.x, left.outX, right.inX, right.x, localT),
    y: cubicAt(left.y, left.outY, right.inY, right.y, localT),
    z: cubicAt(left.z, left.outZ, right.inZ, right.z, localT),
  }
}

/** The fully displaced start offset represented by a motion path. */
export function textMotionPathDistance(
  path: TextMotionPath | null | undefined,
): TextMotionPathOffset {
  const normalized = normalizeTextMotionPath(path)
  const start = normalized?.points.at(-1)
  return start ? pointOffset(start) : { x: 0, y: 0, z: 0 }
}

/**
 * Set the path's overall XYZ distance without flattening its authored curve.
 *
 * The distance is the hidden/start endpoint. Changing it adds a straight
 * displacement ramp across every anchor and Bezier handle; the curve's local
 * bows, loops, and curvature therefore stay intact within the path's spatial
 * bounds while the complete rail is stretched to the requested endpoint.
 */
export function setTextMotionPathDistance(
  path: TextMotionPath | null | undefined,
  distance: TextMotionPathOffset,
): TextMotionPath {
  const normalized = normalizeTextMotionPath(path) ?? defaultTextMotionPath()
  const start = normalized.points.at(-1)!
  const target = {
    x: finiteOr(distance.x, start.x),
    y: finiteOr(distance.y, start.y),
    z: finiteOr(distance.z, start.z),
  }
  const delta = {
    x: target.x - start.x,
    y: target.y - start.y,
    z: target.z - start.z,
  }
  if (delta.x === 0 && delta.y === 0 && delta.z === 0) return normalized

  const points = normalized.points.map((point, index, source) => {
    const previous = source[index - 1]
    const next = source[index + 1]
    const inT = previous ? lerp(previous.t, point.t, 2 / 3) : point.t
    const outT = next ? lerp(point.t, next.t, 1 / 3) : point.t
    return {
      ...point,
      x: point.x + delta.x * point.t,
      y: point.y + delta.y * point.t,
      z: point.z + delta.z * point.t,
      inX: point.inX + delta.x * inT,
      inY: point.inY + delta.y * inT,
      inZ: point.inZ + delta.z * inT,
      outX: point.outX + delta.x * outT,
      outY: point.outY + delta.y * outT,
      outZ: point.outZ + delta.z * outT,
    }
  })

  return normalizeTextMotionPath({ version: 1, points }) ?? normalized
}

/** Add an editable anchor without changing the rendered path. */
export function splitTextMotionPathAt(
  path: TextMotionPath,
  amount: number,
  id: string,
): TextMotionPath {
  const normalized = normalizeTextMotionPath(path)
  if (!normalized) return defaultTextMotionPath()
  const points = normalized.points
  if (points.length >= MAX_TEXT_MOTION_PATH_POINTS) return normalized

  const t = clamp(
    Number.isFinite(amount) ? amount : 0,
    MIN_POINT_GAP,
    1 - MIN_POINT_GAP,
  )
  let segmentIndex = points.length - 2
  for (let index = 0; index < points.length - 1; index++) {
    if (t <= points[index + 1]!.t) {
      segmentIndex = index
      break
    }
  }
  const left = points[segmentIndex]!
  const right = points[segmentIndex + 1]!
  if (t - left.t < MIN_POINT_GAP || right.t - t < MIN_POINT_GAP) {
    return normalized
  }

  const localT = (t - left.t) / (right.t - left.t)
  const x = splitAxis(left.x, left.outX, right.inX, right.x, localT)
  const y = splitAxis(left.y, left.outY, right.inY, right.y, localT)
  const z = splitAxis(left.z, left.outZ, right.inZ, right.z, localT)

  const nextPoints = points.map((point) => ({ ...point }))
  const nextLeft = nextPoints[segmentIndex]!
  const nextRight = nextPoints[segmentIndex + 1]!
  nextLeft.outX = x.firstControl
  nextLeft.outY = y.firstControl
  nextLeft.outZ = z.firstControl
  nextRight.inX = x.lastControl
  nextRight.inY = y.lastControl
  nextRight.inZ = z.lastControl
  nextPoints.splice(segmentIndex + 1, 0, {
    id:
      typeof id === 'string' && id.trim().length > 0
        ? id.trim()
        : `motion-path-point-${nextPoints.length}`,
    t,
    x: x.anchor,
    y: y.anchor,
    z: z.anchor,
    inX: x.inControl,
    inY: y.inControl,
    inZ: z.inControl,
    outX: x.outControl,
    outY: y.outControl,
    outZ: z.outControl,
  })
  return normalizeTextMotionPath({ version: 1, points: nextPoints })!
}

/** Remove an editable anchor while protecting the settled and start points. */
export function removeTextMotionPathPoint(
  path: TextMotionPath,
  pointId: string,
): TextMotionPath {
  const normalized = normalizeTextMotionPath(path)
  if (!normalized) return defaultTextMotionPath()
  const index = normalized.points.findIndex((point) => point.id === pointId)
  if (index <= 0 || index >= normalized.points.length - 1) return normalized
  return normalizeTextMotionPath({
    version: 1,
    points: normalized.points.filter((point) => point.id !== pointId),
  })!
}

interface SplitAxisResult {
  firstControl: number
  inControl: number
  anchor: number
  outControl: number
  lastControl: number
}

function splitAxis(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): SplitAxisResult {
  const a = lerp(p0, p1, t)
  const b = lerp(p1, p2, t)
  const c = lerp(p2, p3, t)
  const d = lerp(a, b, t)
  const e = lerp(b, c, t)
  return {
    firstControl: a,
    inControl: d,
    anchor: lerp(d, e, t),
    outControl: e,
    lastControl: c,
  }
}

function pointOffset(point: TextMotionPathPoint): TextMotionPathOffset {
  return { x: point.x, y: point.y, z: point.z }
}

function capPathPoints(points: TextMotionPathPoint[]): TextMotionPathPoint[] {
  if (points.length <= MAX_TEXT_MOTION_PATH_POINTS) return points
  const lastIndex = points.length - 1
  const interiorSlots = MAX_TEXT_MOTION_PATH_POINTS - 2
  const capped = [points[0]!]
  for (let slot = 0; slot < interiorSlots; slot++) {
    const sourceIndex = 1 + Math.round(
      (slot * (lastIndex - 2)) / Math.max(1, interiorSlots - 1),
    )
    capped.push(points[sourceIndex]!)
  }
  capped.push(points[lastIndex]!)
  return capped
}

function uniquePointId(
  requested: string,
  sourceIndex: number,
  used: Set<string>,
): string {
  const base = requested.trim() || `motion-path-point-${sourceIndex}`
  let candidate = base
  let suffix = 1
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix++
  }
  used.add(candidate)
  return candidate
}

function normalizedHandle(value: number, fallback: number): number {
  return clampSpatial(Number.isFinite(value) ? value : fallback)
}

function clampSpatial(value: number): number {
  return clamp(value, MIN_SPATIAL_VALUE, MAX_SPATIAL_VALUE)
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

function finiteOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback
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
