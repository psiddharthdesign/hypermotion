// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { cameraSpaceDepth, projectWorldPoint, resolveCamera3D } from '@/render3d/scene3d'
import { computeCameraDepthOfField } from './canvasRenderHelpers'

const viewport = { width: 960, height: 540 }

function cameraFixture() {
  const camera = createSceneAPI().getActiveCamera()
  if (!camera) throw new Error('Missing default camera')
  return { ...camera, depthOfField: true, aperture: 1, blurLevel: 24 }
}

describe('focus guide resolution', () => {
  it('ignores saved Point coordinates and target overrides in Distance mode', () => {
    const camera = {
      ...cameraFixture(), focusMode: 'plane' as const,
      focusDistance: 650, focusX: 15, focusY: 25,
      focusWorldX: -300, focusWorldY: 80, focusWorldZ: 900,
    }
    const override = { x: 1000, y: 1200, z: 1500 }
    const result = computeCameraDepthOfField(camera, undefined, 1, 960, 540, override)!
    const resolved = resolveCamera3D(camera, undefined, viewport)
    expect(result.focusDistance).toBeCloseTo(650)
    expect(result.focusWorldX).toBeCloseTo(resolved.focusWorld.x)
    expect(result.focusWorldY).toBeCloseTo(resolved.focusWorld.y)
    expect(result.focusWorldZ).toBeCloseTo(resolved.focusWorld.z)
    expect(result.focusX).toBeCloseTo(viewport.width / 2)
    expect(result.focusY).toBeCloseTo(viewport.height / 2)
  })

  it('uses the animated orbit camera and animated focus distance for the guide', () => {
    const camera = { ...cameraFixture(), focusMode: 'plane' as const }
    const animated = { x: 350, y: 160, z: 120, rotationX: 35, rotationY: -28, rotation: 16, focusDistance: 480 }
    const resolved = resolveCamera3D(camera, animated, viewport)
    const result = computeCameraDepthOfField(camera, animated, 1, 960, 540)!
    const world = { x: result.focusWorldX, y: result.focusWorldY, z: result.focusWorldZ }
    expect(cameraSpaceDepth(world, resolved)).toBeCloseTo(480)
    expect(result.focusDistance).toBeCloseTo(480)
    expect(result.focusX).toBeCloseTo(480)
    expect(result.focusY).toBeCloseTo(270)
  })

  it('uses a resolved animated target position only for Object focus', () => {
    const camera = { ...cameraFixture(), focusMode: 'target' as const }
    const animated = { rotationX: 32, rotationY: 20 }
    const target = { x: 140, y: 310, z: 260 }
    const resolved = resolveCamera3D(camera, animated, viewport, target)
    const projected = projectWorldPoint(target, resolved, viewport)
    const result = computeCameraDepthOfField(camera, animated, 1, 960, 540, target)!
    expect(result.focusWorldX).toEqual(target.x)
    expect(result.focusWorldY).toEqual(target.y)
    expect(result.focusWorldZ).toEqual(target.z)
    expect(result.focusDistance).toBeCloseTo(cameraSpaceDepth(target, resolved))
    expect(result.focusX).toBeCloseTo(projected.x)
    expect(result.focusY).toBeCloseTo(projected.y)
  })

  it('preserves animated Point coordinates in screen space', () => {
    const camera = { ...cameraFixture(), focusMode: 'screen' as const, focusX: 80, focusY: 90 }
    const result = computeCameraDepthOfField(camera, { focusX: 140, focusY: 170, rotationX: 50 }, 1, 960, 540)!
    expect(result.focusX).toEqual(140)
    expect(result.focusY).toEqual(170)
  })

  it('uses an independent animated world centre in Focus plane mode', () => {
    const camera = { ...cameraFixture(), focusMode: 'spatial' as const, focusPlaneInitialized: true, focusPlaneX: 100, focusPlaneY: 120, focusPlaneZ: 200 }
    const animated = { focusPlaneX: 230, focusPlaneY: 180, focusPlaneZ: 50, rotationY: 22 }
    const resolved = resolveCamera3D(camera, animated, viewport)
    const result = computeCameraDepthOfField(camera, animated, 1, 960, 540, { x: 0, y: 0, z: 0 })!
    expect({ x: result.focusWorldX, y: result.focusWorldY, z: result.focusWorldZ }).toEqual({ x: 230, y: 180, z: 50 })
    expect(result.focusDistance).toBeCloseTo(resolved.focusDistance)
  })
})
