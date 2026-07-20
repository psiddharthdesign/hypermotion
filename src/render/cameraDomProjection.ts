// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { CameraNode } from '@/scene'
import {
  resolveCamera3D,
  worldToCamera,
  type ViewportSize,
} from '@/render3d/scene3d'
import type { Vec3 } from '@/render3d/math'

export type CameraDomMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export interface CameraDomProjection {
  focalLength: number
  z: number
  scale: number
  matrix: CameraDomMatrix
  transform: string | null
}

const IDENTITY_MATRIX: CameraDomMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

/**
 * Mirrors the canonical WebGL camera projection for DOM-backed scene renders.
 *
 * Text editing temporarily reveals the DOM scene so contenteditable can own
 * the glyphs. The returned matrix maps world coordinates into the exact
 * pre-perspective CSS coordinates which project to the same pixels as WebGL.
 * This remains camera-accurate for dolly, FOV, pitch, yaw, roll, and layer Z.
 */
export function resolveCameraDomProjection(
  camera: CameraNode | null | undefined,
  animated: AnimatedValue | undefined,
  viewport: ViewportSize,
): CameraDomProjection {
  if (!camera) {
    return {
      focalLength: 1000,
      z: 0,
      scale: 1,
      matrix: IDENTITY_MATRIX,
      transform: null,
    }
  }

  const resolved = resolveCamera3D(camera, animated, viewport)
  const z = animated?.z ?? camera.transform.z
  const focalLength = resolved.focalLength
  const origin = { x: viewport.width / 2, y: viewport.height / 2 }

  // CSS perspective projects a transformed point q with
  //   screen = origin + (q.xy - origin) * f / (f - q.z)
  // while the WebGL camera projects camera-space c with
  //   screen = origin + c.xy * f / c.z.
  // Therefore q=(origin.x+c.x, origin.y+c.y, f-c.z) is an exact bridge.
  // worldToCamera is affine, so sampling its origin and unit axes gives the
  // single matrix3d that applies that bridge to every DOM scene point.
  const cameraOrigin = worldToCamera({ x: 0, y: 0, z: 0 }, resolved)
  const cameraX = subtract(
    worldToCamera({ x: 1, y: 0, z: 0 }, resolved),
    cameraOrigin,
  )
  const cameraY = subtract(
    worldToCamera({ x: 0, y: 1, z: 0 }, resolved),
    cameraOrigin,
  )
  const cameraZ = subtract(
    worldToCamera({ x: 0, y: 0, z: 1 }, resolved),
    cameraOrigin,
  )
  const matrix: CameraDomMatrix = [
    cameraX.x,
    cameraX.y,
    -cameraX.z,
    0,
    cameraY.x,
    cameraY.y,
    -cameraY.z,
    0,
    cameraZ.x,
    cameraZ.y,
    -cameraZ.z,
    0,
    origin.x + cameraOrigin.x,
    origin.y + cameraOrigin.y,
    focalLength - cameraOrigin.z,
    1,
  ]
  const targetDepth = worldToCamera(resolved.pointOfInterest, resolved).z

  return {
    focalLength,
    z,
    scale: focalLength / Math.max(1, targetDepth),
    matrix,
    transform: `matrix3d(${matrix.join(',')})`,
  }
}
