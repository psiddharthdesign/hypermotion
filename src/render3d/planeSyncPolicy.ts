// SPDX-License-Identifier: Apache-2.0

import type { Vec3 } from './math'
import type { ResolvedCamera3D } from './scene3d'

const FOCUS_UNIFORM_PROPERTIES = new Set<keyof ResolvedCamera3D>([
  'focusMode',
  'focusScreen',
  'focusWorld',
  'focusDistance',
  'focusPlaneNormal',
  'focusPlaneRight',
  'focusPlaneDown',
  'focusRadius',
  'focusFalloff',
])

function sameVector(left: Vec3 | undefined, right: Vec3 | undefined): boolean {
  if (left === right) return true
  return !!left && !!right &&
    Object.is(left.x, right.x) &&
    Object.is(left.y, right.y) &&
    Object.is(left.z, right.z)
}

/**
 * Whether existing layer records can be reused while focus uniforms change.
 * All other camera inputs must match: pose and lens changes can affect texture
 * resolution, padding, and layer transforms. Compare fresh resolved vectors by
 * value, and include every other field so future inputs invalidate safely.
 */
export function samePlaneSyncCameraInputs(left: ResolvedCamera3D, right: ResolvedCamera3D): boolean {
  if (left === right) return true
  const properties = new Set([...Object.keys(left), ...Object.keys(right)] as (keyof ResolvedCamera3D)[])
  for (const property of properties) {
    if (FOCUS_UNIFORM_PROPERTIES.has(property)) continue
    switch (property) {
      case 'position':
      case 'rotation':
      case 'pointOfInterest':
      case 'rigDown':
        if (!sameVector(left[property], right[property])) return false
        break
      default:
        if (!Object.is(left[property], right[property])) return false
    }
  }
  return true
}
