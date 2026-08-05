// SPDX-License-Identifier: Apache-2.0

import {
  normalizeTextMotionPath,
  type TextMotionPath,
} from './textMotionPath'
import type { TextAnimationApplyTo } from './textAnimations'

export interface TextMotionRailPoint {
  x: number
  y: number
  z: number
}

export interface TextMotionRailSegment {
  /** Stable slot in the caller's shared output buffer. */
  index: number
  /** Zero is the first segment to enter or leave. */
  sequence: number
  /** Settled segment centre in one shared renderer coordinate system. */
  baseline: TextMotionRailPoint
}

/**
 * Allocation-free working set for a visual line whose segment membership and
 * ordering stay stable during playback. Baseline points may be mutated by a
 * renderer; call `refreshTextMotionRailWorkspace` after doing so.
 */
export interface TextMotionRailWorkspace {
  baselineRail: TextMotionRailSegment[]
  baselineDistances: Float64Array
  baselineLength: number
  requiredOutputLength: number
  sample: TextMotionRailPoint
}

interface CompiledTextMotionPath {
  points: TextMotionRailPoint[]
  distances: Float64Array
  length: number
  hiddenTangent: TextMotionRailPoint
}

const PATH_SUBDIVISIONS_PER_CURVE = 48
const EPSILON = 1e-8

const compiledPathCache = new WeakMap<
  TextMotionPath,
  { lineHeight: number; compiled: CompiledTextMotionPath }
>()

/**
 * Shared spatial rails operate on the natural centres of independently
 * typeset glyphs or words. Lines and whole layers still use the regular
 * per-segment motion-path offset instead.
 */
export function textMotionPathUsesSharedRail(
  applyTo: TextAnimationApplyTo,
): boolean {
  return applyTo === 'letters' || applyTo === 'words'
}

/**
 * Place one visual line of glyph/word centres on a single composite rail.
 *
 * The negative side of the rail is the authored Bézier path (Settled →
 * Hidden), extended past Hidden by its tangent. The positive side is the
 * segment's real typeset baseline. A shared shift moves the complete strip,
 * so every in-flight segment samples the same curve and keeps its natural
 * centre-to-centre spacing instead of following a translated copy.
 *
 * `amount` follows the renderer convention: zero is fully settled and one is
 * fully displaced. IN and OUT choose opposite baseline junctions so sequence
 * zero is the first segment to act in both modes.
 */
export function resolveTextMotionRailOffsets(
  path: TextMotionPath,
  lineHeight: number,
  amount: number,
  mode: 'in' | 'out',
  segments: readonly TextMotionRailSegment[],
  output?: Float64Array,
  workspace?: TextMotionRailWorkspace,
): Float64Array {
  const rail = workspace ?? createTextMotionRailWorkspace(segments, mode)
  const requiredLength = rail.requiredOutputLength
  const offsets = output ?? new Float64Array(requiredLength)
  if (offsets.length < requiredLength) {
    throw new Error('Text motion rail output is smaller than its segment set')
  }
  if (segments.length === 0) return offsets

  const safeAmount = clamp01(amount)
  if (safeAmount <= EPSILON) {
    for (const segment of segments) writeOffset(offsets, segment.index, 0, 0, 0)
    return offsets
  }

  const compiled = compileTextMotionPath(path, lineHeight)
  const baselineRail = rail.baselineRail
  const junction = baselineRail[0]!.baseline
  const baselineDistances = rail.baselineDistances

  const shift = safeAmount * (compiled.length + rail.baselineLength)
  for (let index = 0; index < baselineRail.length; index++) {
    const segment = baselineRail[index]!
    const railDistance = baselineDistances[index]! - shift
    const relative = sampleCompositeRail(
      railDistance,
      compiled,
      baselineRail,
      baselineDistances,
      rail.sample,
    )
    writeOffset(
      offsets,
      segment.index,
      junction.x + relative.x - segment.baseline.x,
      junction.y + relative.y - segment.baseline.y,
      junction.z + relative.z - segment.baseline.z,
    )
  }
  return offsets
}

export function createTextMotionRailWorkspace(
  segments: readonly TextMotionRailSegment[],
  mode: 'in' | 'out',
): TextMotionRailWorkspace {
  const baselineRail = [...segments].sort((left, right) => {
    const sequenceDelta =
      mode === 'in'
        ? right.sequence - left.sequence
        : left.sequence - right.sequence
    return sequenceDelta || left.index - right.index
  })
  const workspace: TextMotionRailWorkspace = {
    baselineRail,
    baselineDistances: new Float64Array(baselineRail.length),
    baselineLength: 0,
    requiredOutputLength:
      segments.reduce(
        (maximum, segment) => Math.max(maximum, segment.index + 1),
        0,
      ) * 3,
    sample: { x: 0, y: 0, z: 0 },
  }
  refreshTextMotionRailWorkspace(workspace)
  return workspace
}

/** Recompute arc distances after a renderer mutates cached baseline points. */
export function refreshTextMotionRailWorkspace(
  workspace: TextMotionRailWorkspace,
): void {
  const { baselineRail, baselineDistances } = workspace
  let baselineLength = 0
  if (baselineDistances.length > 0) baselineDistances[0] = 0
  for (let index = 1; index < baselineRail.length; index++) {
    baselineLength += pointDistance(
      baselineRail[index - 1]!.baseline,
      baselineRail[index]!.baseline,
    )
    baselineDistances[index] = baselineLength
  }
  workspace.baselineLength = baselineLength
}

function compileTextMotionPath(
  path: TextMotionPath,
  lineHeight: number,
): CompiledTextMotionPath {
  const scale = Number.isFinite(lineHeight) ? Math.max(0, lineHeight) : 0
  const cached = compiledPathCache.get(path)
  if (cached && cached.lineHeight === scale) return cached.compiled

  const normalized = normalizeTextMotionPath(path)
  const anchors = normalized?.points ?? []
  const points: TextMotionRailPoint[] = [{ x: 0, y: 0, z: 0 }]
  if (anchors.length >= 2 && scale > 0) {
    for (let curveIndex = 0; curveIndex < anchors.length - 1; curveIndex++) {
      const left = anchors[curveIndex]!
      const right = anchors[curveIndex + 1]!
      for (let step = 1; step <= PATH_SUBDIVISIONS_PER_CURVE; step++) {
        const u = step / PATH_SUBDIVISIONS_PER_CURVE
        points.push({
          x: cubicAt(left.x, left.outX, right.inX, right.x, u) * scale,
          y: cubicAt(left.y, left.outY, right.inY, right.y, u) * scale,
          z: cubicAt(left.z, left.outZ, right.inZ, right.z, u) * scale,
        })
      }
    }
  }

  const distances = new Float64Array(points.length)
  let length = 0
  for (let index = 1; index < points.length; index++) {
    length += pointDistance(points[index - 1]!, points[index]!)
    distances[index] = length
  }
  const hiddenTangent = terminalTangent(points)
  const compiled = { points, distances, length, hiddenTangent }
  compiledPathCache.set(path, { lineHeight: scale, compiled })
  return compiled
}

function sampleCompositeRail(
  signedDistance: number,
  path: CompiledTextMotionPath,
  baseline: readonly TextMotionRailSegment[],
  baselineDistances: Float64Array,
  output: TextMotionRailPoint,
): TextMotionRailPoint {
  if (signedDistance >= 0) {
    return sampleBaseline(signedDistance, baseline, baselineDistances, output)
  }

  const pathDistance = -signedDistance
  if (pathDistance <= path.length || path.length <= EPSILON) {
    return sampleCompiledPath(
      Math.min(pathDistance, path.length),
      path,
      output,
    )
  }
  const hidden = path.points[path.points.length - 1]!
  const extension = pathDistance - path.length
  output.x = hidden.x + path.hiddenTangent.x * extension
  output.y = hidden.y + path.hiddenTangent.y * extension
  output.z = hidden.z + path.hiddenTangent.z * extension
  return output
}

function sampleBaseline(
  distance: number,
  baseline: readonly TextMotionRailSegment[],
  distances: Float64Array,
  output: TextMotionRailPoint,
): TextMotionRailPoint {
  const origin = baseline[0]!.baseline
  if (baseline.length === 1 || distance <= EPSILON) {
    output.x = 0
    output.y = 0
    output.z = 0
    return output
  }
  const total = distances[distances.length - 1]!
  if (distance >= total) {
    const end = baseline[baseline.length - 1]!.baseline
    output.x = end.x - origin.x
    output.y = end.y - origin.y
    output.z = end.z - origin.z
    return output
  }
  const upper = upperBound(distances, distance)
  const lower = Math.max(0, upper - 1)
  const startDistance = distances[lower]!
  const endDistance = distances[upper]!
  const u =
    endDistance - startDistance <= EPSILON
      ? 0
      : (distance - startDistance) / (endDistance - startDistance)
  const start = baseline[lower]!.baseline
  const end = baseline[upper]!.baseline
  output.x = lerp(start.x, end.x, u) - origin.x
  output.y = lerp(start.y, end.y, u) - origin.y
  output.z = lerp(start.z, end.z, u) - origin.z
  return output
}

function sampleCompiledPath(
  distance: number,
  path: CompiledTextMotionPath,
  output: TextMotionRailPoint,
): TextMotionRailPoint {
  if (path.points.length === 1 || distance <= EPSILON) {
    const point = path.points[0]!
    output.x = point.x
    output.y = point.y
    output.z = point.z
    return output
  }
  if (distance >= path.length) {
    const point = path.points[path.points.length - 1]!
    output.x = point.x
    output.y = point.y
    output.z = point.z
    return output
  }
  const upper = upperBound(path.distances, distance)
  const lower = Math.max(0, upper - 1)
  const startDistance = path.distances[lower]!
  const endDistance = path.distances[upper]!
  const u =
    endDistance - startDistance <= EPSILON
      ? 0
      : (distance - startDistance) / (endDistance - startDistance)
  const start = path.points[lower]!
  const end = path.points[upper]!
  output.x = lerp(start.x, end.x, u)
  output.y = lerp(start.y, end.y, u)
  output.z = lerp(start.z, end.z, u)
  return output
}

function terminalTangent(points: readonly TextMotionRailPoint[]): TextMotionRailPoint {
  const end = points[points.length - 1]!
  for (let index = points.length - 2; index >= 0; index--) {
    const previous = points[index]!
    const dx = end.x - previous.x
    const dy = end.y - previous.y
    const dz = end.z - previous.z
    const length = Math.hypot(dx, dy, dz)
    if (length > EPSILON) {
      return { x: dx / length, y: dy / length, z: dz / length }
    }
  }
  return { x: 0, y: -1, z: 0 }
}

function upperBound(values: Float64Array, target: number): number {
  let low = 0
  let high = values.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]! < target) low = middle + 1
    else high = middle
  }
  return low
}

function writeOffset(
  output: Float64Array,
  index: number,
  x: number,
  y: number,
  z: number,
): void {
  const offset = index * 3
  output[offset] = x
  output[offset + 1] = y
  output[offset + 2] = z
}

function pointDistance(left: TextMotionRailPoint, right: TextMotionRailPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z)
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const inv = 1 - t
  return (
    inv * inv * inv * p0 +
    3 * inv * inv * t * p1 +
    3 * inv * t * t * p2 +
    t * t * t * p3
  )
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}
