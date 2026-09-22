// SPDX-License-Identifier: Apache-2.0
import type { AnimatedValue } from '@/anim/engine'
import type { CameraNode } from '@/scene/types'
import { add3, focalLengthToFov, fovToFocalLength, mul3, rotateEuler, sub3 } from './math'

/** Local camera pose before a Null's world transform is applied. */
export function resolveCameraPose(camera: CameraNode, animated: AnimatedValue | undefined, viewport: { height: number }) {
  const fieldOfView = animated?.fieldOfView ?? camera.fieldOfView ?? Math.max(1, Math.min(175,
    focalLengthToFov(animated?.focalLength ?? camera.focalLength ?? 1000, viewport.height)))
  const focalLength = Math.max(1, fovToFocalLength(fieldOfView, viewport.height))
  const translation = { x: animated?.x ?? camera.transform.x, y: animated?.y ?? camera.transform.y, z: animated?.z ?? camera.transform.z }
  const rotation = { x: animated?.rotationX ?? camera.transform.rotationX, y: animated?.rotationY ?? camera.transform.rotationY, z: animated?.rotation ?? camera.transform.rotation }
  if (camera.positionMode === 'free') {
    const forward = rotateEuler({ x: 0, y: 0, z: 1 }, -rotation.x, rotation.y, 0)
    const planeDistance = Math.abs(forward.z) > 1e-8 ? -translation.z / forward.z : 0
    const distance = planeDistance > 0 ? planeDistance : focalLength
    return { fieldOfView, focalLength, rotation, position: translation, pointOfInterest: add3(translation, mul3(forward, distance)) }
  }
  const pointOfInterest = { x: translation.x, y: translation.y, z: 0 }
  const basePosition = { x: translation.x, y: translation.y, z: -Math.max(1, focalLength - translation.z) }
  const orbitOffset = rotateEuler(sub3(basePosition, pointOfInterest), -rotation.x, rotation.y, 0)
  return { fieldOfView, focalLength, rotation, position: add3(pointOfInterest, orbitOffset), pointOfInterest }
}
