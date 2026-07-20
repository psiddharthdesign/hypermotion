// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSceneAPI } from '@/scene/doc'
import {
  resolveCameraDomProjection,
  type CameraDomProjection,
} from '@/render/cameraDomProjection'
import {
  depthBlurAmount,
  effectiveApertureStrength,
  projectWorldPoint,
  resolveCamera3D,
  type ResolvedCamera3D,
} from './scene3d'
import type { Vec3 } from './math'

function projectWithDomCamera(
  point: Vec3,
  projection: CameraDomProjection,
  viewport: { width: number; height: number },
) {
  const m = projection.matrix
  const transformed = {
    x: m[0] * point.x + m[4] * point.y + m[8] * point.z + m[12],
    y: m[1] * point.x + m[5] * point.y + m[9] * point.z + m[13],
    z: m[2] * point.x + m[6] * point.y + m[10] * point.z + m[14],
  }
  const origin = { x: viewport.width / 2, y: viewport.height / 2 }
  const perspectiveScale =
    projection.focalLength /
    (projection.focalLength - transformed.z)
  return {
    x: origin.x + (transformed.x - origin.x) * perspectiveScale,
    y: origin.y + (transformed.y - origin.y) * perspectiveScale,
  }
}

function projectWithThreeCamera(
  point: Vec3,
  resolved: ResolvedCamera3D,
  viewport: { width: number; height: number },
) {
  const camera = new THREE.PerspectiveCamera(
    resolved.fieldOfView,
    viewport.width / viewport.height,
    resolved.nearClip,
    resolved.farClip,
  )
  camera.position.set(
    resolved.position.x,
    resolved.position.y,
    resolved.position.z,
  )
  camera.up.set(0, -1, 0)
  camera.lookAt(
    resolved.pointOfInterest.x,
    resolved.pointOfInterest.y,
    resolved.pointOfInterest.z,
  )
  camera.rotateZ(THREE.MathUtils.degToRad(-resolved.rotation.z))
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera)
  return {
    x: ((projected.x + 1) / 2) * viewport.width,
    y: ((1 - projected.y) / 2) * viewport.height,
  }
}

describe('physical camera focus resolution', () => {
  it('keeps the animated point-focus center in composition screen space', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolved = resolveCamera3D(
      { ...camera, focusMode: 'screen', focusX: 100, focusY: 80 },
      { focusX: 320, focusY: 190 },
      { width: 960, height: 540 },
    )

    expect(resolved.focusScreen).toEqual({ x: 320, y: 190 })
  })

  it('resolves distance focus as a camera-space plane', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolved = resolveCamera3D(
      { ...camera, focusMode: 'plane', focusDistance: 400 },
      undefined,
      { width: 960, height: 540 },
    )

    expect(resolved.focusMode).toBe('plane')
    expect(resolved.focusDistance).toBeCloseTo(400)
    expect(resolved.focusWorld.z).toBeCloseTo(resolved.position.z + 400)
  })

  it('falls back to the look-at depth for a legacy zero distance', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolved = resolveCamera3D(
      { ...camera, focusMode: 'plane', focusDistance: 0 },
      undefined,
      { width: 960, height: 540 },
    )

    expect(resolved.focusDistance).toBeCloseTo(
      Math.abs(resolved.position.z - resolved.pointOfInterest.z),
    )
  })

  it('uses radius/falloff only for point focus, not distance/object planes', () => {
    const args = [
      1000,
      { x: 1000, y: 1000, z: 0 },
      { x: 0, y: 0, z: 0 },
      1000,
      10,
      10,
      1,
      20,
      1000,
      true,
    ] as const

    expect(depthBlurAmount(...args, true)).toBeGreaterThan(0)
    expect(depthBlurAmount(...args, false)).toBe(0)
  })

  it('keeps f/2.8 neutral and preserves aperture zero as disabled', () => {
    expect(effectiveApertureStrength(1, 2.8)).toBeCloseTo(1)
    expect(effectiveApertureStrength(1, 1.4)).toBeCloseTo(2)
    expect(effectiveApertureStrength(0, 0.4)).toBe(0)
  })

  it('lets a wide aperture reach, but never exceed, Max Blur', () => {
    const maxBlur = 3.1
    const blur = depthBlurAmount(
      2000,
      { x: 0, y: 0, z: 2000 },
      { x: 0, y: 0, z: 0 },
      100,
      10,
      10,
      effectiveApertureStrength(1, 0.1),
      maxBlur,
      1000,
      true,
      false,
    )

    expect(blur).toBeLessThanOrEqual(maxBlur)
    expect(blur).toBeCloseTo(maxBlur)
  })
})

describe('DOM camera projection parity', () => {
  it('matches WebGL field of view and direct Z during text-edit handoff', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const viewport = { width: 960, height: 540 }
    const authored = {
      ...camera,
      fieldOfView: 35,
      transform: { ...camera.transform, z: 400 },
    }

    const webgl = resolveCamera3D(authored, undefined, viewport)
    const dom = resolveCameraDomProjection(authored, undefined, viewport)
    const webglTargetDepth = Math.hypot(
      webgl.position.x - webgl.pointOfInterest.x,
      webgl.position.y - webgl.pointOfInterest.y,
      webgl.position.z - webgl.pointOfInterest.z,
    )

    expect(dom.focalLength).toBeCloseTo(webgl.focalLength)
    expect(dom.z).toBe(400)
    expect(dom.scale).toBeCloseTo(webgl.focalLength / webglTargetDepth)
    expect(dom.scale).toBeGreaterThan(1.8)
  })

  it('tracks animated field of view and Z instead of static camera values', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const viewport = { width: 960, height: 540 }
    const animated = { fieldOfView: 70, z: -250 }

    const webgl = resolveCamera3D(camera, animated, viewport)
    const dom = resolveCameraDomProjection(camera, animated, viewport)

    expect(dom.focalLength).toBeCloseTo(webgl.focalLength)
    expect(dom.z).toBe(-250)
    expect(dom.scale).toBeCloseTo(
      webgl.focalLength / (webgl.focalLength + 250),
    )
  })

  it('projects DOM pixels exactly like WebGL for every camera axis and layer depth', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const viewport = { width: 960, height: 540 }
    const authored = {
      ...camera,
      fieldOfView: 46,
      transform: {
        ...camera.transform,
        x: 510,
        y: 248,
        z: 210,
        rotationX: 18,
        rotationY: -27,
        rotation: 13,
      },
    }
    const animated = {
      fieldOfView: 58,
      x: 472,
      y: 292,
      z: -135,
      rotationX: -16,
      rotationY: 31,
      rotation: -21,
    }
    const points: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 960, y: 0, z: 0 },
      { x: 960, y: 540, z: 0 },
      { x: 0, y: 540, z: 0 },
      { x: 480, y: 270, z: 140 },
      { x: 315, y: 184, z: -90 },
    ]

    for (const values of [undefined, animated]) {
      const webgl = resolveCamera3D(authored, values, viewport)
      const dom = resolveCameraDomProjection(authored, values, viewport)
      for (const point of points) {
        const expected = projectWorldPoint(point, webgl, viewport)
        const actual = projectWithDomCamera(point, dom, viewport)
        for (const workspaceZoom of [0.17, 1, 2]) {
          expect(actual.x * workspaceZoom).toBeCloseTo(
            expected.x * workspaceZoom,
            7,
          )
          expect(actual.y * workspaceZoom).toBeCloseTo(
            expected.y * workspaceZoom,
            7,
          )
        }
      }
    }
  })

  it('matches the real Three.js camera for positive and negative roll', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const viewport = { width: 960, height: 540 }
    const points: Vec3[] = [
      { x: 120, y: 80, z: 0 },
      { x: 840, y: 460, z: 0 },
      { x: 520, y: 210, z: 175 },
    ]

    for (const roll of [-30, 30]) {
      const authored = {
        ...camera,
        fieldOfView: 44,
        transform: {
          ...camera.transform,
          x: 480,
          y: 270,
          z: 185,
          rotationX: 17,
          rotationY: -24,
          rotation: roll,
        },
      }
      const resolved = resolveCamera3D(authored, undefined, viewport)
      const dom = resolveCameraDomProjection(authored, undefined, viewport)

      for (const point of points) {
        const three = projectWithThreeCamera(point, resolved, viewport)
        const analytic = projectWorldPoint(point, resolved, viewport)
        const css = projectWithDomCamera(point, dom, viewport)
        expect(analytic.x).toBeCloseTo(three.x, 7)
        expect(analytic.y).toBeCloseTo(three.y, 7)
        expect(css.x).toBeCloseTo(three.x, 7)
        expect(css.y).toBeCloseTo(three.y, 7)
      }
    }
  })
})
