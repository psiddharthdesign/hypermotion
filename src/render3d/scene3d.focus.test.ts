// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import {
  depthBlurAmount,
  effectiveApertureStrength,
  resolveCamera3D,
} from './scene3d'

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
