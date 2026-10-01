// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import type { ResolvedCamera3D } from './scene3d'

export type SceneThreeCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera

export function createThreeCamera(projection: ResolvedCamera3D['projection']): SceneThreeCamera {
  return projection === 'orthographic'
    ? new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 100000)
    : new THREE.PerspectiveCamera(35, 1, 1, 100000)
}

export function syncThreeCamera(
  camera: SceneThreeCamera,
  resolved: ResolvedCamera3D,
  width: number,
  height: number,
) {
  if (camera instanceof THREE.OrthographicCamera) {
    camera.left = -width / (2 * resolved.zoomX)
    camera.right = width / (2 * resolved.zoomX)
    camera.top = height / (2 * resolved.zoomY)
    camera.bottom = -height / (2 * resolved.zoomY)
  } else {
    camera.fov = resolved.fieldOfView
    camera.aspect = width / Math.max(1, height)
  }
  camera.near = resolved.nearClip
  camera.far = resolved.farClip
  camera.position.set(resolved.position.x, resolved.position.y, resolved.position.z)
  camera.up.set(0, -1, 0)
  camera.lookAt(resolved.pointOfInterest.x, resolved.pointOfInterest.y, resolved.pointOfInterest.z)
  if (resolved.rotation.z !== 0) {
    camera.rotateZ(THREE.MathUtils.degToRad(-resolved.rotation.z))
  }
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
}
