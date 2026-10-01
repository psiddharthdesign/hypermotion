// SPDX-License-Identifier: Apache-2.0

import { Matrix4, Vector3 } from 'three'
import type { Ray3, Vec3 } from './math'
import { extrusionOutline, type ExtrusionGeometryOptions } from './extrusionGeometry'
import { normalizeExtrusionDepth } from '@/scene/extrusion'

export interface ExtrusionHit {
  /** Ray parameter, so hits can be compared even when the ray is not normalized. */
  t: number
  point: Vec3
  /** Centered local XY and Z in [0, depth]. */
  localPoint: Vec3
  surface: 'front' | 'back' | 'side'
}

/**
 * Intersects the actual convex, tessellated solid, including sides and back.
 * The column-major affine matrix is the rendered mesh's world matrix. Local
 * ray direction stays unnormalized so inherited scale, reflection and shear
 * preserve the same world-ray parameter when choosing the nearest object.
 */
export function intersectExtrusion(
  ray: Ray3,
  options: ExtrusionGeometryOptions,
  worldMatrix: readonly number[],
): ExtrusionHit | null {
  const depth = normalizeExtrusionDepth(options.depth)
  const outline = extrusionOutline(options)
  if (depth === 0 || outline.length < 3 || worldMatrix.length !== 16 || !worldMatrix.every(Number.isFinite)) return null
  const matrix = new Matrix4().fromArray(worldMatrix)
  if (Math.abs(matrix.determinant()) < 1e-15) return null
  const inverse = matrix.invert()
  const origin = new Vector3(ray.origin.x, ray.origin.y, ray.origin.z).applyMatrix4(inverse)
  const e = inverse.elements
  const d = ray.direction
  const direction = new Vector3(
    e[0]! * d.x + e[4]! * d.y + e[8]! * d.z,
    e[1]! * d.x + e[5]! * d.y + e[9]! * d.z,
    e[2]! * d.x + e[6]! * d.y + e[10]! * d.z,
  )
  if (![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z].every(Number.isFinite) || direction.lengthSq() === 0) return null
  let enter = -Infinity
  let exit = Infinity
  let enterSurface: ExtrusionHit['surface'] = 'front'
  let exitSurface: ExtrusionHit['surface'] = 'back'
  const clip = (nx: number, ny: number, nz: number, limit: number, surface: ExtrusionHit['surface']) => {
    const numerator = limit - nx * origin.x - ny * origin.y - nz * origin.z
    const denominator = nx * direction.x + ny * direction.y + nz * direction.z
    if (Math.abs(denominator) < 1e-12) return numerator >= -1e-8
    const t = numerator / denominator
    if (denominator < 0 && t > enter) { enter = t; enterSurface = surface }
    if (denominator > 0 && t < exit) { exit = t; exitSurface = surface }
    return enter <= exit + 1e-8
  }
  if (!clip(0, 0, -1, 0, 'front') || !clip(0, 0, 1, depth, 'back')) return null
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const nx = (b.y - a.y) / length
    const ny = (a.x - b.x) / length
    if (!clip(nx, ny, 0, nx * a.x + ny * a.y, 'side')) return null
  }
  const t = enter > 1e-8 ? enter : exit
  if (!Number.isFinite(t) || t <= 1e-8) return null
  return {
    t,
    point: { x: ray.origin.x + d.x * t, y: ray.origin.y + d.y * t, z: ray.origin.z + d.z * t },
    localPoint: { x: origin.x + direction.x * t, y: origin.y + direction.y * t, z: origin.z + direction.z * t },
    surface: enter > 1e-8 ? enterSurface : exitSurface,
  }
}
