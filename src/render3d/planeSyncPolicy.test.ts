// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { AnimatedValue } from '@/anim'
import type { CameraNode } from '@/scene'
import { createSceneAPI } from '@/scene/doc'
import { resolveCamera3D } from './scene3d'
import { samePlaneSyncCameraInputs } from './planeSyncPolicy'

const viewport = { width: 960, height: 540 }

function fixture() {
  const camera: CameraNode = {
    ...createSceneAPI().getActiveCamera()!,
    depthOfField: true,
    focusMode: 'spatial',
    focusPlaneX: 480,
    focusPlaneY: 270,
    focusPlaneZ: 0,
    aperture: 1,
    blurLevel: 24,
  }
  return {
    camera,
    resolve: (animated?: AnimatedValue, patch?: Partial<CameraNode>) =>
      resolveCamera3D({ ...camera, ...patch }, animated, viewport),
  }
}

describe('camera inputs for plane synchronization', () => {
  it('reuses records for equivalent resolved cameras despite fresh pose vectors', () => {
    const { resolve } = fixture()
    const first = resolve()
    const second = resolve()
    expect(second.position).not.toBe(first.position)
    expect(second.rotation).not.toBe(first.rotation)
    expect(second.pointOfInterest).not.toBe(first.pointOfInterest)
    expect(samePlaneSyncCameraInputs(first, second)).toBe(true)
  })

  it('reuses records while a spatial focus plane translates and tilts on all axes', () => {
    const { resolve } = fixture()
    const first = resolve()
    const moved = resolve({ focusPlaneX: 620, focusPlaneY: 320, focusPlaneZ: 240, focusPlaneRotationX: 30, focusPlaneRotationY: -25, focusPlaneRotationZ: 45 })
    expect(moved.focusWorld).not.toEqual(first.focusWorld)
    expect(moved.focusPlaneNormal).not.toEqual(first.focusPlaneNormal)
    expect(moved.focusPlaneRight).not.toEqual(first.focusPlaneRight)
    expect(moved.focusPlaneDown).not.toEqual(first.focusPlaneDown)
    expect(moved.focusDistance).not.toBe(first.focusDistance)
    expect(samePlaneSyncCameraInputs(first, moved)).toBe(true)
  })

  it('reuses records while Distance focus is pulled between foreground and background', () => {
    const { resolve } = fixture()
    const near = resolve({ focusDistance: 400 }, { focusMode: 'plane' })
    const far = resolve({ focusDistance: 1400 }, { focusMode: 'plane' })
    expect(far.focusWorld).not.toEqual(near.focusWorld)
    expect(far.focusDistance).toBeCloseTo(1400)
    expect(samePlaneSyncCameraInputs(near, far)).toBe(true)
  })

  it('reuses records when switching focus modes or moving and resizing Point focus', () => {
    const { resolve } = fixture()
    const plane = resolve()
    const point = resolve({ focusX: 200, focusY: 100, focusRadius: 72, focusFalloff: 40 }, { focusMode: 'screen' })
    expect(point.focusScreen).toEqual({ x: 200, y: 100 })
    expect(samePlaneSyncCameraInputs(plane, point)).toBe(true)
  })

  it.each([
    ['pan X', { x: 700 }],
    ['pan Y', { y: 320 }],
    ['dolly', { z: 200 }],
    ['pitch', { rotationX: 25 }],
    ['yaw', { rotationY: -20 }],
    ['roll', { rotation: 30 }],
    ['lens field of view', { fieldOfView: 70 }],
    ['near clip', { nearClip: 20 }],
    ['far clip', { farClip: 200000 }],
  ] satisfies [string, AnimatedValue][])('rebuilds for animated %s changes', (_name, animated) => {
    const { resolve } = fixture()
    expect(samePlaneSyncCameraInputs(resolve(), resolve(animated))).toBe(false)
  })

  it.each([
    ['camera identity', { id: 'another-camera' }],
    ['depth of field toggle', { depthOfField: false }],
    ['aperture', { aperture: 2 }],
    ['f-stop', { fStop: 1.4 }],
    ['maximum blur', { blurLevel: 48 }],
    ['preview quality', { dofPreviewQuality: 'high' }],
    ['export quality', { blurQuality: 48 }],
    ['blade count', { bladeCount: 5 }],
    ['blade rotation', { bladeRotation: 30 }],
    ['bokeh ratio', { bokehRatio: 2 }],
    ['chromatic aberration toggle', { chromaticAberrationEnabled: true }],
    ['chromatic aberration amount', { chromaticAberrationAmount: 20 }],
    ['chromatic aberration angle', { chromaticAberrationAngle: 60 }],
    ['bloom toggle', { bloomEnabled: true }],
    ['bloom strength', { bloomStrength: 2 }],
    ['bloom radius', { bloomRadius: 0.7 }],
    ['bloom threshold', { bloomThreshold: 0.2 }],
    ['VHS toggle', { vhsEnabled: true }],
    ['VHS intensity', { vhsIntensity: 0.9 }],
    ['VHS noise', { vhsNoise: 0.8 }],
    ['VHS scanlines', { vhsScanlines: 0.9 }],
    ['VHS color bleed', { vhsColorBleed: 10 }],
  ] satisfies [string, Partial<CameraNode>][])('rebuilds for %s changes', (_name, patch) => {
    const { resolve } = fixture()
    expect(samePlaneSyncCameraInputs(resolve(), resolve(undefined, patch))).toBe(false)
  })

  it('rebuilds when moving focus also expands the resolved far clipping plane', () => {
    const { resolve } = fixture()
    const first = resolve()
    const farAway = resolve({ focusPlaneZ: 200000 })
    expect(farAway.farClip).toBeGreaterThan(first.farClip)
    expect(samePlaneSyncCameraInputs(first, farAway)).toBe(false)
  })

  it('invalidates unknown non-focus fields rather than silently ignoring future camera inputs', () => {
    const { resolve } = fixture()
    const first = resolve()
    const extended = { ...resolve(), futureLensParameter: 10 }
    expect(samePlaneSyncCameraInputs(first, extended)).toBe(false)
    expect(samePlaneSyncCameraInputs(extended, first)).toBe(false)
  })
})
