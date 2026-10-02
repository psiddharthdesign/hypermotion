// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { add3, mul3, rotateEuler, sub3 } from '@/render3d/math'
import { cameraSpaceDepth, focusPlaneCorners, projectWorldPoint, resolveCamera3D, viewportPointToRay, worldToCamera } from '@/render3d/scene3d'
import { focusPlaneGuideGeometry, moveFocusPlaneDepth, moveFocusPlaneInView, setFocusPlaneDepth } from './focusPlaneGeometry'

const viewport = { width: 960, height: 540 }

function cameraFixture() {
  const camera = createSceneAPI().getActiveCamera()
  if (!camera) throw new Error('Missing default camera')
  return { ...camera, focusMode: 'spatial' as const, focusPlaneInitialized: true, focusPlaneX: 480, focusPlaneY: 270, focusPlaneZ: 0 }
}

describe('independent focus plane guide', () => {
  it('projects the resolved world centre and tilted plane corners', () => {
    const resolved = resolveCamera3D(cameraFixture(), { rotationY: 25 }, viewport)
    const right = rotateEuler({ x: 1, y: 0, z: 0 }, 30, 20, 12)
    const down = rotateEuler({ x: 0, y: 1, z: 0 }, 30, 20, 12)
    const planeCamera = { ...resolved, focusPlaneRight: right, focusPlaneDown: down }
    const result = focusPlaneGuideGeometry(planeCamera, viewport)!
    const firstCorner = focusPlaneCorners(planeCamera, viewport)[0]
    expect(result.worldCenter).toEqual(resolved.focusWorld)
    expect(result.center).toEqual(projectWorldPoint(resolved.focusWorld, resolved, viewport))
    expect(result.corners).toHaveLength(4)
    expect(result.corners[0]).toEqual(projectWorldPoint(firstCorner, resolved, viewport))
    expect(result.corners[0].y).not.toBeCloseTo(result.corners[1].y)
  })

  it('clips a plane crossing the near plane before projecting', () => {
    const resolved = resolveCamera3D(cameraFixture(), undefined, viewport)
    const forward = viewportPointToRay(resolved, 480, 270, viewport).direction
    const planeCamera = {
      ...resolved,
      focusWorld: add3(resolved.position, mul3(forward, 10)),
      focusPlaneRight: rotateEuler({ x: 1, y: 0, z: 0 }, 0, 60, 0),
      focusPlaneDown: { x: 0, y: 1, z: 0 },
    }
    const result = focusPlaneGuideGeometry(planeCamera, viewport)!
    expect(result.corners.length).toBeGreaterThanOrEqual(3)
    expect(result.corners.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
    expect(focusPlaneGuideGeometry({ ...planeCamera, focusWorld: sub3(resolved.position, forward) }, viewport)).toBeNull()
  })

  it('moves exactly with the pointer at fixed depth under an animated orbit and roll', () => {
    const resolved = resolveCamera3D(cameraFixture(), {
      rotationX: 28, rotationY: 31, rotation: -17, z: 90,
    }, viewport)
    const start = resolved.focusWorld
    const before = projectWorldPoint(start, resolved, viewport)
    const moved = moveFocusPlaneInView(resolved, viewport, start, { x: 125, y: -46 })
    const after = projectWorldPoint(moved, resolved, viewport)
    expect(after.x - before.x).toBeCloseTo(125)
    expect(after.y - before.y).toBeCloseTo(-46)
    expect(cameraSpaceDepth(moved, resolved)).toBeCloseTo(cameraSpaceDepth(start, resolved))
    expect(moved.z).not.toBeCloseTo(start.z)
  })

  it('moves in camera depth without changing orientation and clamps at the near plane', () => {
    const resolved = resolveCamera3D(cameraFixture(), { rotationX: 35, rotationY: -25, rotation: 11 }, viewport)
    const start = resolved.focusWorld
    const initialDepth = cameraSpaceDepth(start, resolved)
    const moved = moveFocusPlaneDepth(resolved, viewport, start, -100)
    expect(cameraSpaceDepth(moved, resolved)).toBeCloseTo(initialDepth + 100 * initialDepth / resolved.focalLength)
    const clamped = moveFocusPlaneDepth(resolved, viewport, start, 1e9)
    expect(cameraSpaceDepth(clamped, resolved)).toBeCloseTo(resolved.nearClip)
    expect(resolved.focusWorld).toEqual(start)
  })

  it('sets an absolute distance under camera animation while preserving lateral position and tilt', () => {
    const camera = cameraFixture()
    const resolved = resolveCamera3D(camera, {
      rotationX: 24, rotationY: -32, rotation: 17, z: 150,
      focusPlaneX: 620, focusPlaneY: 200, focusPlaneZ: 150,
      focusPlaneRotationX: 35, focusPlaneRotationY: 28,
    }, viewport)
    const before = worldToCamera(resolved.focusWorld, resolved)
    const moved = setFocusPlaneDepth(resolved, resolved.focusWorld, 1750)
    const after = worldToCamera(moved, resolved)
    expect(after.z).toBeCloseTo(1750)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    const repeated = setFocusPlaneDepth(resolved, moved, 1750)
    expect(repeated.x).toBeCloseTo(moved.x)
    expect(repeated.y).toBeCloseTo(moved.y)
    expect(repeated.z).toBeCloseTo(moved.z)
    const movedCamera = resolveCamera3D({ ...camera,
      focusPlaneX: moved.x, focusPlaneY: moved.y, focusPlaneZ: moved.z,
      focusPlaneRotationX: 35, focusPlaneRotationY: 28,
    }, undefined, viewport)
    expect(movedCamera.focusPlaneNormal).toEqual(resolved.focusPlaneNormal)
  })

  it('keeps numeric distance edits in front of the camera and rejects invalid distances', () => {
    const resolved = resolveCamera3D(cameraFixture(), undefined, viewport)
    const start = resolved.focusWorld
    expect(cameraSpaceDepth(setFocusPlaneDepth(resolved, start, -500), resolved)).toBeCloseTo(resolved.nearClip)
    for (const distance of [NaN, Infinity, -Infinity]) {
      expect(setFocusPlaneDepth(resolved, start, distance)).toEqual(start)
    }
  })
})

describe('orthographic focus plane controls', () => {
  it('moves with the pointer at fixed camera depth under an isometric camera', () => {
    const camera = { ...cameraFixture(), projection: 'orthographic' as const }
    const resolved = resolveCamera3D(camera, { rotationX: -35.264, rotationY: 45, rotation: 8, scaleX: 2, scaleY: 2 }, viewport)
    const before = projectWorldPoint(resolved.focusWorld, resolved, viewport)
    const moved = moveFocusPlaneInView(resolved, viewport, resolved.focusWorld, { x: 75, y: -25 })
    const after = projectWorldPoint(moved, resolved, viewport)
    expect(after.x - before.x).toBeCloseTo(75)
    expect(after.y - before.y).toBeCloseTo(-25)
    expect(cameraSpaceDepth(moved, resolved)).toBeCloseTo(cameraSpaceDepth(resolved.focusWorld, resolved))
  })

  it('uses orthographic zoom for depth drag sensitivity independently of focus distance', () => {
    const camera = { ...cameraFixture(), projection: 'orthographic' as const }
    const resolved = resolveCamera3D(camera, { rotationX: -35.264, rotationY: 45, scaleX: 2, scaleY: 2 }, viewport)
    for (const distance of [300, 1800]) {
      const start = setFocusPlaneDepth(resolved, resolved.focusWorld, distance)
      const moved = moveFocusPlaneDepth(resolved, viewport, start, -40)
      expect(cameraSpaceDepth(moved, resolved)).toBeCloseTo(distance + 40 / resolved.zoomY)
    }
  })

  it('keeps the guide screen size steady while the plane moves in orthographic depth', () => {
    const resolved = resolveCamera3D({ ...cameraFixture(), projection: 'orthographic' as const }, { scaleX: 2, scaleY: 2 }, viewport)
    const near = { ...resolved, focusWorld: setFocusPlaneDepth(resolved, resolved.focusWorld, 400) }
    const far = { ...resolved, focusWorld: setFocusPlaneDepth(resolved, resolved.focusWorld, 1800) }
    const a = focusPlaneGuideGeometry(near, viewport)!
    const b = focusPlaneGuideGeometry(far, viewport)!
    const width = (corners: { x: number; y: number }[]) => Math.max(...corners.map(point => point.x)) - Math.min(...corners.map(point => point.x))
    expect(width(a.corners)).toBeCloseTo(width(b.corners))
  })
})
