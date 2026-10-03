// SPDX-License-Identifier: Apache-2.0
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { defaultLayerMotionPath, evaluateLayerMotionPathSample, normalizeLayerMotionPath, type LayerMotionPath } from '@/anim/layerMotionPath'

export const ARRANGEMENT_NUMBERS = {
  columns: { label: 'Columns', value: 3, min: 1, max: 1000 },
  spacingX: { label: 'Spacing X', value: 160, min: -100000, max: 100000 },
  spacingY: { label: 'Spacing Y', value: 160, min: -100000, max: 100000 },
  radius: { label: 'Radius', value: 240, min: 0, max: 100000 },
  orbit: { label: 'Orbit', value: 0, min: -36000, max: 36000 },
  spread: { label: 'Arc spread', value: 360, min: -3600, max: 3600 },
  rotationX: { label: 'Rotate X', value: 0, min: -36000, max: 36000 },
  rotationY: { label: 'Rotate Y', value: 0, min: -36000, max: 36000 },
  rotation: { label: 'Rotate Z', value: 0, min: -36000, max: 36000 },
  opacity: { label: 'Arrangement opacity', value: 1, min: 0, max: 1 },
  scaleFront: { label: 'Front scale', value: 1, min: 0, max: 100 },
  scaleBack: { label: 'Back scale', value: 1, min: 0, max: 100 },
  scaleDirection: { label: 'Scale direction', value: 90, min: -36000, max: 36000 },
  rippleFocus: { label: 'Ripple focus', value: 0, min: 0, max: 1 },
  scaleFalloff: { label: 'Scale falloff', value: 1, min: 0.01, max: 100 },
  depth: { label: 'Depth', value: 0, min: -100000, max: 100000 },
  depthAnchor: { label: 'Depth anchor', value: 0.5, min: 0, max: 1 },
  pathScaleX: { label: 'Path width scale', value: 1, min: -100, max: 100 },
  pathScaleY: { label: 'Path height scale', value: 1, min: -100, max: 100 },
  polygonPoints: { label: 'Polygon points', value: 5, min: 3, max: 64 },
  trimStart: { label: 'Trim start', value: 0, min: 0, max: 1 },
  trimEnd: { label: 'Trim end', value: 1, min: 0, max: 1 },
  progress: { label: 'Path progress', value: 0, min: -100, max: 100 },
  pathSpread: { label: 'Path spread', value: 1, min: 0, max: 1 },
  pitch: { label: 'Sphere pitch', value: 0, min: -36000, max: 36000 },
  focusTarget: { label: 'Focus member', value: 0, min: 0, max: 10000 },
  shuffle: { label: 'Shuffle', value: 0, min: 0, max: 10000 },
  randomOffset: { label: 'Random offset', value: 0, min: 0, max: 100000 },
  seed: { label: 'Random seed', value: 1, min: 0, max: 2147483647 },
} as const
export type ArrangementNumber = keyof typeof ARRANGEMENT_NUMBERS
export const ARRANGEMENT_CHOICES = {
  mode: { label: 'Pattern', values: ['rectangular', 'radial', 'path', 'spherical'], value: 'rectangular' },
  orientation: { label: 'Orientation', values: ['forward', 'center', 'outward', 'screen', 'path'], value: 'forward' },
  scaleMode: { label: 'Scale by position', values: ['off', 'linear', 'ripple'], value: 'off' },
  shape: { label: 'Path shape', values: ['custom', 'ellipse', 'rectangle', 'polygon', 'star'], value: 'ellipse' },
} as const
export type ArrangementChoice = keyof typeof ARRANGEMENT_CHOICES
export type ArrangementPropertyId = `arrangement.${ArrangementNumber | ArrangementChoice | 'path'}`
export type ArrangementMode = 'rectangular' | 'radial' | 'path' | 'spherical'
export type Arrangement = Record<ArrangementNumber, number> & {
  version: 1
  mode: ArrangementMode
  memberIds: string[]
  orientation: 'forward' | 'center' | 'outward' | 'screen' | 'path'
  scaleMode: 'off' | 'linear' | 'ripple'
  shape: 'custom' | 'ellipse' | 'rectangle' | 'polygon' | 'star'
  path: LayerMotionPath
}
export type ArrangementAnimation = Partial<Omit<Arrangement, 'version' | 'memberIds'>>
const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x))
const rad = Math.PI / 180
export function normalizeArrangement(raw: unknown): Arrangement | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Partial<Arrangement>
  const numbers = {} as Record<ArrangementNumber, number>
  for (const key of Object.keys(ARRANGEMENT_NUMBERS) as ArrangementNumber[]) {
    const d = ARRANGEMENT_NUMBERS[key]
    numbers[key] = typeof r[key] === 'number' && Number.isFinite(r[key]) ? clamp(r[key]!, d.min, d.max) : d.value
  }
  return { ...numbers, version: 1,
    mode: ['rectangular', 'radial', 'path', 'spherical'].includes(r.mode ?? '') ? r.mode! : 'rectangular',
    memberIds: Array.isArray(r.memberIds) ? [...new Set(r.memberIds.filter((id): id is string => typeof id === 'string'))] : [],
    orientation: ['forward', 'center', 'outward', 'screen', 'path'].includes(r.orientation ?? '') ? r.orientation! : 'forward',
    scaleMode: ['off', 'linear', 'ripple'].includes(r.scaleMode ?? '') ? r.scaleMode! : 'off',
    shape: ['custom', 'ellipse', 'rectangle', 'polygon', 'star'].includes(r.shape ?? '') ? r.shape! : 'ellipse',
    path: normalizeLayerMotionPath(r.path) ?? defaultLayerMotionPath(),
  }
}
export function defaultArrangement(mode: ArrangementMode = 'rectangular'): Arrangement {
  return normalizeArrangement({ mode })!
}
export function animatedArrangement(base: Arrangement, values?: ArrangementAnimation): Arrangement {
  if (!values) return base
  // Keep the path object stable so the arc-length lookup table remains cached.
  const merged = { ...base }
  for (const key of Object.keys(values) as ArrangementNumber[]) {
    const d = ARRANGEMENT_NUMBERS[key], value = values[key]
    if (d && typeof value === 'number' && Number.isFinite(value)) merged[key] = clamp(value, d.min, d.max)
  }
  for (const key of Object.keys(ARRANGEMENT_CHOICES) as ArrangementChoice[]) {
    const value = values[key]
    if (typeof value === 'string' && (ARRANGEMENT_CHOICES[key].values as readonly string[]).includes(value)) Object.assign(merged, { [key]: value })
  }
  if (values.path) merged.path = normalizeLayerMotionPath(values.path) ?? base.path
  return merged
}

/** Morph matching path anchors/handles; topology changes hold until the next key. */
export function interpolateArrangementPath(from: unknown, to: unknown, amount: number, progress = amount): LayerMotionPath | null {
  const a = normalizeLayerMotionPath(from), b = normalizeLayerMotionPath(to)
  if (!a || !b) return a ?? b
  if (a.points.length !== b.points.length) return progress < 1 ? a : b
  const axes = ['t', 'x', 'y', 'z', 'inX', 'inY', 'inZ', 'outX', 'outY', 'outZ'] as const
  return normalizeLayerMotionPath({ ...a, points: a.points.map((point, index) => {
    const next = { ...point }
    for (const key of axes) next[key] = point[key] + (b.points[index]![key] - point[key]) * amount
    return next
  }) })
}
function random(seed: number): () => number {
  let state = seed | 0
  return () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return (state >>> 0) / 4294967296 }
}
function spherePoint(index: number, count: number): Vector3 {
  const y = count <= 1 ? 0 : 1 - 2 * (index + 0.5) / count
  const r = Math.sqrt(1 - y * y), angle = index * Math.PI * (3 - Math.sqrt(5))
  return new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r)
}
function shapePoint(a: Arrangement, t: number): Vector3 {
  const angle = t * Math.PI * 2 - Math.PI / 2
  if (a.shape === 'ellipse') return new Vector3(Math.cos(angle) * a.radius, Math.sin(angle) * a.radius, 0)
  const sides = a.shape === 'rectangle' ? 4 : Math.round(a.polygonPoints) * (a.shape === 'star' ? 2 : 1)
  const wrapped = ((t % 1) + 1) % 1, f = wrapped * sides, i = Math.floor(f)
  const vertex = (j: number) => {
    if (a.shape === 'rectangle') return [new Vector3(-1, -1, 0), new Vector3(1, -1, 0), new Vector3(1, 1, 0), new Vector3(-1, 1, 0)][j % 4]!.multiplyScalar(a.radius)
    const r = a.radius * (a.shape === 'star' && j % 2 ? 0.5 : 1)
    return new Vector3(Math.cos(j / sides * Math.PI * 2 - Math.PI / 2) * r, Math.sin(j / sides * Math.PI * 2 - Math.PI / 2) * r, 0)
  }
  return vertex(i).lerp(vertex((i + 1) % sides), f - i)
}
export interface ArrangementSlot { matrix: Matrix4; position: Vector3; scale: number }
/** Deterministic, scene-time-only placement; does not mutate authored layers. */
export function arrangementSlots(a: Arrangement): Map<string, ArrangementSlot> {
  const ids = [...a.memberIds], count = ids.length, result = new Map<string, ArrangementSlot>()
  if (!count) return result
  if (a.shuffle >= 1) {
    const rng = random(Math.round(a.seed) + Math.round(a.shuffle) * 7919)
    for (let i = count - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j]!, ids[i]!] }
  }
  const points: { id: string; p: Vector3; tangent: Vector3 }[] = []
  const columns = Math.max(1, Math.round(a.columns)), rows = Math.ceil(count / columns)
  const closed = a.shape !== 'custom'
  for (let i = 0; i < count; i++) {
    let p = new Vector3(), tangent = new Vector3(1, 0, 0)
    const u = count <= 1 ? 0 : i / (count - 1)
    if (a.mode === 'rectangular') p.set((i % columns - (Math.min(count, columns) - 1) / 2) * a.spacingX, (Math.floor(i / columns) - (rows - 1) / 2) * a.spacingY, 0)
    if (a.mode === 'radial') {
      const theta = ((Math.abs(a.spread) >= 360 ? i / count : u) * a.spread + a.orbit) * rad - Math.PI / 2
      p.set(Math.cos(theta) * a.radius, Math.sin(theta) * a.radius, 0)
      tangent.set(-Math.sin(theta), Math.cos(theta), 0)
    }
    if (a.mode === 'spherical') p.copy(spherePoint(i, count)).multiplyScalar(a.radius)
    if (a.mode === 'path') {
      const amount = a.progress + (closed ? i / count : u) * a.pathSpread
      const t = a.trimStart + (a.trimEnd - a.trimStart) * (closed ? ((amount % 1) + 1) % 1 : clamp(amount, 0, 1))
      if (a.shape === 'custom') {
        const sample = evaluateLayerMotionPathSample(a.path, t)
        p.set(sample.position.x, sample.position.y, sample.position.z)
        tangent.set(sample.tangent.x, sample.tangent.y, sample.tangent.z)
      } else { p = shapePoint(a, t); tangent = shapePoint(a, t + 0.00001).sub(p).normalize() }
      p.x *= a.pathScaleX; p.y *= a.pathScaleY
      tangent.x *= a.pathScaleX; tangent.y *= a.pathScaleY
    }
    if (a.mode !== 'spherical') p.z += (u - a.depthAnchor) * a.depth
    const rng = random(Math.round(a.seed) + i * 104729)
    p.add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(2 * a.randomOffset))
    points.push({ id: ids[i]!, p, tangent })
  }
  const globalRotation = new Quaternion().setFromEuler(new Euler((a.rotationX + a.pitch) * rad, a.rotationY * rad, a.rotation * rad, 'ZYX'))
  if (a.mode === 'spherical' && a.focusTarget > 0) {
    // 0 disables targeting; fractional 1-based member indices blend on the shortest arc.
    const target = clamp(a.focusTarget - 1, 0, count - 1), lo = Math.floor(target), hi = Math.min(count - 1, lo + 1)
    const direction = (i: number) => spherePoint(ids.indexOf(a.memberIds[i]!), count)
    const front = new Vector3(0, 0, 1)
    const from = new Quaternion().setFromUnitVectors(direction(lo), front)
    const to = new Quaternion().setFromUnitVectors(direction(hi), front)
    globalRotation.multiply(from.slerp(to, target - lo))
  }
  points.forEach(({ p, tangent }) => { p.applyQuaternion(globalRotation); tangent.applyQuaternion(globalRotation) })
  const direction = new Vector3(Math.cos(a.scaleDirection * rad), Math.sin(a.scaleDirection * rad), 0)
  const scores = points.map(({ p }) => a.mode === 'spherical' ? p.z : p.dot(direction))
  const low = Math.min(...scores), high = Math.max(...scores)
  points.forEach(({ id, p, tangent }, i) => {
    let weight = high === low ? 1 : (scores[i]! - low) / (high - low)
    if (a.scaleMode === 'ripple') weight = 1 - Math.abs((count <= 1 ? 0 : i / (count - 1)) - a.rippleFocus)
    weight = Math.pow(clamp(weight, 0, 1), a.scaleFalloff)
    const scale = a.scaleMode === 'off' ? a.scaleFront : a.scaleBack + (a.scaleFront - a.scaleBack) * weight
    let q = globalRotation.clone()
    if (a.orientation === 'center' || a.orientation === 'outward') {
      const facing = p.clone().multiplyScalar(a.orientation === 'center' ? -1 : 1)
      if (facing.lengthSq() > 1e-12) {
        if (a.mode === 'spherical') q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), facing.normalize())
        else {
          // Resolve the heading in the pattern plane, then carry it through its 3D tilt.
          const local = facing.applyQuaternion(globalRotation.clone().invert())
          q = globalRotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.atan2(local.y, local.x)))
        }
      }
    } else if (a.orientation === 'path') q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), tangent.normalize())
    result.set(id, { position: p, scale, matrix: new Matrix4().compose(p, q, new Vector3(scale, scale, scale)) })
  })
  return result
}
export function remapArrangement(a: Arrangement, ids: ReadonlyMap<string, string>): Arrangement {
  return { ...a, memberIds: a.memberIds.flatMap((id) => ids.has(id) ? [ids.get(id)!] : []) }
}
