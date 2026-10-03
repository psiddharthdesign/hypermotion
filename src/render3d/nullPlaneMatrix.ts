// SPDX-License-Identifier: Apache-2.0
import type { Object3D } from 'three'
import type { Plane3D } from '@/render3d/scene3d'

/** Preserve an affine rig exactly; Euler decomposition would discard shear. */
export function applyNullPlaneMatrix(object: Object3D, plane: Plane3D, texture = false): boolean {
  object.matrixAutoUpdate = !plane.transformMatrix
  if (!plane.transformMatrix) return false
  object.matrix.fromArray(plane.transformMatrix)
  const center = texture ? plane.textureCenter ?? plane.center : plane.center
  object.matrix.setPosition(center.x, center.y, center.z)
  object.matrixWorldNeedsUpdate = true
  return true
}
