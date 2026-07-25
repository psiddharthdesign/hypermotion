// SPDX-License-Identifier: Apache-2.0

/**
 * One editable anchor on a layer motion path.
 *
 * Coordinates and controls are absolute positions in layer-local pixels.
 * Positive X moves right, positive Y moves down, and positive Z moves toward
 * the viewer. `t` is the authored parametric amount in the range 0..1.
 */
export interface LayerMotionPathPoint {
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

export type LayerMotionPathParameterization = 'parametric' | 'arc-length'

/**
 * Generic spatial rail that may be attached to any scene node.
 *
 * The first point is always normalized to the local origin, so the node's
 * authored transform remains its path origin. `progress` is the static value
 * used when no `motionPath.progress` track is active.
 */
export interface LayerMotionPath {
  version: 1
  points: LayerMotionPathPoint[]
  progress: number
  autoOrient: boolean
  rotationOffset: number
  parameterization: LayerMotionPathParameterization
}

export interface LayerMotionPathPosition {
  x: number
  y: number
  z: number
}

export interface LayerMotionPathSample {
  position: LayerMotionPathPosition
  /** Unit tangent in the same screen-oriented XYZ coordinate system. */
  tangent: LayerMotionPathPosition
}

export const MAX_LAYER_MOTION_PATH_POINTS = 64
export const DEFAULT_LAYER_MOTION_PATH_PARAMETERIZATION: LayerMotionPathParameterization =
  'arc-length'

const MIN_POINT_GAP = 0.0001
const MAX_ABS_COORDINATE = 1_000_000
const ARC_LENGTH_SAMPLES_PER_SEGMENT = 32
const TANGENT_EPSILON = 1e-8
const FINITE_DIFFERENCE_AMOUNT = 1e-4

interface ArcLengthEntry {
  amount: number
  distance: number
}

interface ArcLengthTable {
  entries: ArcLengthEntry[]
  total: number
}

const arcLengthCache = new WeakMap<LayerMotionPath, ArcLengthTable>()

/** A useful, constant-speed S-curve extending 240 pixels to the right. */
export function defaultLayerMotionPath(): LayerMotionPath {
  return {
    version: 1,
    points: [
      {
        id: 'layer-motion-path-start',
        t: 0,
        x: 0,
        y: 0,
        z: 0,
        inX: 0,
        inY: 0,
        inZ: 0,
        outX: 80,
        outY: -80,
        outZ: 0,
      },
      {
        id: 'layer-motion-path-end',
        t: 1,
        x: 240,
        y: 0,
        z: 0,
        inX: 160,
        inY: 80,
        inZ: 0,
        outX: 240,
        outY: 0,
        outZ: 0,
      },
    ],
    progress: 0,
    autoOrient: false,
    rotationOffset: 0,
    parameterization: DEFAULT_LAYER_MOTION_PATH_PARAMETERIZATION,
  }
}

/**
 * Convert saved or editor-authored input into a bounded piecewise cubic path.
 *
 * The earliest point becomes the local origin and the complete path is
 * translated with it, preserving the authored curve. Missing controls become
 * linear one-third handles. Spatial axes may loop or reverse freely.
 */
export function normalizeLayerMotionPath(raw: unknown): LayerMotionPath | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
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
        sourceIndex,
        id:
          typeof point.id === 'string' && point.id.trim().length > 0
            ? point.id.trim()
            : `layer-motion-path-point-${sourceIndex}`,
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
    .sort((left, right) => left.t - right.t || left.sourceIndex - right.sourceIndex)

  const parsed = capPathPoints(sorted)
  if (parsed.length < 2) return null

  // Keep the layer's authored transform as the rail origin. Translating every
  // anchor and finite handle preserves the input curve while pinning t=0 to 0.
  const origin = {
    x: parsed[0]!.x,
    y: parsed[0]!.y,
    z: parsed[0]!.z,
  }
  for (const point of parsed) {
    point.x -= origin.x
    point.y -= origin.y
    point.z -= origin.z
    if (Number.isFinite(point.inX)) point.inX -= origin.x
    if (Number.isFinite(point.inY)) point.inY -= origin.y
    if (Number.isFinite(point.inZ)) point.inZ -= origin.z
    if (Number.isFinite(point.outX)) point.outX -= origin.x
    if (Number.isFinite(point.outY)) point.outY -= origin.y
    if (Number.isFinite(point.outZ)) point.outZ -= origin.z
  }

  const usedIds = new Set<string>()
  for (let index = 0; index < parsed.length; index++) {
    const point = parsed[index]!
    point.id = uniquePointId(point.id, index, usedIds)
    point.x = clampCoordinate(point.x)
    point.y = clampCoordinate(point.y)
    point.z = clampCoordinate(point.z)
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

  const first = parsed[0]!
  first.inX = first.x
  first.inY = first.y
  first.inZ = first.z
  const last = parsed[parsed.length - 1]!
  last.outX = last.x
  last.outY = last.y
  last.outZ = last.z

  return {
    version: 1,
    points: parsed.map(({ sourceIndex, ...point }) => {
      void sourceIndex
      return point
    }),
    progress: clamp01(finiteOr(candidate.progress, 0)),
    autoOrient: candidate.autoOrient === true,
    rotationOffset: finiteOr(candidate.rotationOffset, 0),
    parameterization:
      candidate.parameterization === 'parametric' ||
      candidate.parameterization === 'arc-length'
        ? candidate.parameterization
        : DEFAULT_LAYER_MOTION_PATH_PARAMETERIZATION,
  }
}

/** Evaluate only the layer-local XYZ offset at a normalized progress. */
export function evaluateLayerMotionPath(
  path: LayerMotionPath | null | undefined,
  progress: number,
): LayerMotionPathPosition {
  return evaluateLayerMotionPathSample(path, progress).position
}

/**
 * Sample the authored cubic at its raw parametric amount.
 *
 * Canvas path editors need the curve's geometric `t` so inserting a point
 * splits the exact segment under the pointer. Playback continues to use
 * `evaluateLayerMotionPath`, which may remap progress for constant speed.
 */
export function evaluateLayerMotionPathAtAmount(
  path: LayerMotionPath | null | undefined,
  amount: number,
): LayerMotionPathPosition {
  if (!path || path.points.length < 2) return { x: 0, y: 0, z: 0 }
  return sampleAtAmount(path, amount).position
}

/**
 * Evaluate layer-local position and tangent.
 *
 * Arc-length mode remaps progress through a cached distance table before
 * sampling the cubic rail. Tangents are normalized and remain stable at cubic
 * endpoints with collapsed handles through a finite-difference fallback.
 */
export function evaluateLayerMotionPathSample(
  path: LayerMotionPath | null | undefined,
  progress: number,
): LayerMotionPathSample {
  if (!path || path.points.length < 2) {
    return {
      position: { x: 0, y: 0, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
    }
  }

  const normalizedProgress = clamp01(Number.isFinite(progress) ? progress : 0)
  const amount =
    path.parameterization === 'arc-length'
      ? arcLengthAmount(path, normalizedProgress)
      : normalizedProgress
  const raw = sampleAtAmount(path, amount)
  let tangent = raw.tangent

  if (lengthSquared(tangent) <= TANGENT_EPSILON) {
    const before = positionAtAmount(
      path,
      Math.max(0, amount - FINITE_DIFFERENCE_AMOUNT),
    )
    const after = positionAtAmount(
      path,
      Math.min(1, amount + FINITE_DIFFERENCE_AMOUNT),
    )
    tangent = subtract(after, before)
  }
  if (lengthSquared(tangent) <= TANGENT_EPSILON) {
    tangent = firstNonZeroChord(path) ?? { x: 1, y: 0, z: 0 }
  }

  return {
    position: raw.position,
    tangent: normalizeVector(tangent),
  }
}

interface ParsedLayerMotionPathPoint extends LayerMotionPathPoint {
  sourceIndex: number
}

function sampleAtAmount(
  path: LayerMotionPath,
  amount: number,
): LayerMotionPathSample {
  const points = path.points
  const clampedAmount = clamp01(amount)
  if (clampedAmount <= points[0]!.t) {
    const first = points[0]!
    const next = points[1]!
    return sampleSegment(first, next, 0)
  }
  if (clampedAmount >= points[points.length - 1]!.t) {
    const left = points[points.length - 2]!
    const right = points[points.length - 1]!
    return sampleSegment(left, right, 1)
  }

  let segmentIndex = points.length - 2
  for (let index = 0; index < points.length - 1; index++) {
    if (clampedAmount <= points[index + 1]!.t) {
      segmentIndex = index
      break
    }
  }
  const left = points[segmentIndex]!
  const right = points[segmentIndex + 1]!
  const localAmount = clamp01(
    (clampedAmount - left.t) / Math.max(1e-9, right.t - left.t),
  )
  return sampleSegment(left, right, localAmount)
}

function sampleSegment(
  left: LayerMotionPathPoint,
  right: LayerMotionPathPoint,
  amount: number,
): LayerMotionPathSample {
  return {
    position: {
      x: cubicAt(left.x, left.outX, right.inX, right.x, amount),
      y: cubicAt(left.y, left.outY, right.inY, right.y, amount),
      z: cubicAt(left.z, left.outZ, right.inZ, right.z, amount),
    },
    tangent: {
      x: cubicDerivative(left.x, left.outX, right.inX, right.x, amount),
      y: cubicDerivative(left.y, left.outY, right.inY, right.y, amount),
      z: cubicDerivative(left.z, left.outZ, right.inZ, right.z, amount),
    },
  }
}

function positionAtAmount(
  path: LayerMotionPath,
  amount: number,
): LayerMotionPathPosition {
  return sampleAtAmount(path, amount).position
}

function arcLengthAmount(path: LayerMotionPath, progress: number): number {
  let table = arcLengthCache.get(path)
  if (!table) {
    table = buildArcLengthTable(path)
    arcLengthCache.set(path, table)
  }
  if (table.total <= TANGENT_EPSILON) return progress

  const target = progress * table.total
  let low = 0
  let high = table.entries.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (table.entries[middle]!.distance < target) low = middle + 1
    else high = middle
  }
  const right = table.entries[low]!
  const left = table.entries[Math.max(0, low - 1)]!
  const span = right.distance - left.distance
  if (span <= TANGENT_EPSILON) return right.amount
  return lerp(left.amount, right.amount, (target - left.distance) / span)
}

function buildArcLengthTable(path: LayerMotionPath): ArcLengthTable {
  const entries: ArcLengthEntry[] = [{ amount: 0, distance: 0 }]
  let total = 0
  let previous = positionAtAmount(path, 0)

  for (let segmentIndex = 0; segmentIndex < path.points.length - 1; segmentIndex++) {
    const left = path.points[segmentIndex]!
    const right = path.points[segmentIndex + 1]!
    for (let step = 1; step <= ARC_LENGTH_SAMPLES_PER_SEGMENT; step++) {
      const amount = lerp(
        left.t,
        right.t,
        step / ARC_LENGTH_SAMPLES_PER_SEGMENT,
      )
      const current = positionAtAmount(path, amount)
      total += distance(previous, current)
      entries.push({ amount, distance: total })
      previous = current
    }
  }

  return { entries, total }
}

function firstNonZeroChord(
  path: LayerMotionPath,
): LayerMotionPathPosition | null {
  for (let index = 0; index < path.points.length - 1; index++) {
    const chord = subtract(path.points[index + 1]!, path.points[index]!)
    if (lengthSquared(chord) > TANGENT_EPSILON) return chord
  }
  return null
}

function capPathPoints(
  points: ParsedLayerMotionPathPoint[],
): ParsedLayerMotionPathPoint[] {
  if (points.length <= MAX_LAYER_MOTION_PATH_POINTS) return points
  const lastIndex = points.length - 1
  const interiorSlots = MAX_LAYER_MOTION_PATH_POINTS - 2
  const capped = [points[0]!]
  for (let slot = 0; slot < interiorSlots; slot++) {
    const sourceIndex =
      1 +
      Math.round(
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
  const base = requested.trim() || `layer-motion-path-point-${sourceIndex}`
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
  return clampCoordinate(Number.isFinite(value) ? value : fallback)
}

function clampCoordinate(value: number): number {
  return clamp(value, -MAX_ABS_COORDINATE, MAX_ABS_COORDINATE)
}

function cubicAt(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  amount: number,
): number {
  const inverse = 1 - amount
  return (
    inverse * inverse * inverse * p0 +
    3 * inverse * inverse * amount * p1 +
    3 * inverse * amount * amount * p2 +
    amount * amount * amount * p3
  )
}

function cubicDerivative(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  amount: number,
): number {
  const inverse = 1 - amount
  return (
    3 * inverse * inverse * (p1 - p0) +
    6 * inverse * amount * (p2 - p1) +
    3 * amount * amount * (p3 - p2)
  )
}

function normalizeVector(
  value: LayerMotionPathPosition,
): LayerMotionPathPosition {
  const magnitude = Math.sqrt(lengthSquared(value))
  if (magnitude <= TANGENT_EPSILON) return { x: 1, y: 0, z: 0 }
  return {
    x: value.x / magnitude,
    y: value.y / magnitude,
    z: value.z / magnitude,
  }
}

function subtract(
  left: Pick<LayerMotionPathPosition, 'x' | 'y' | 'z'>,
  right: Pick<LayerMotionPathPosition, 'x' | 'y' | 'z'>,
): LayerMotionPathPosition {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  }
}

function distance(
  left: LayerMotionPathPosition,
  right: LayerMotionPathPosition,
): number {
  return Math.sqrt(lengthSquared(subtract(left, right)))
}

function lengthSquared(value: LayerMotionPathPosition): number {
  return value.x * value.x + value.y * value.y + value.z * value.z
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

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}
