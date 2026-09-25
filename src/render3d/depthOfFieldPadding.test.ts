// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { resolveCamera3D } from './scene3d'
import { depthOfFieldTexturePadding } from './depthOfFieldPadding'

const api = createSceneAPI()
const camera = {
  ...resolveCamera3D(api.getActiveCamera()!, undefined, { width: 960, height: 540 }),
  position: { x: 0, y: 0, z: -1000 },
  pointOfInterest: { x: 0, y: 0, z: 0 },
  focalLength: 1000,
  depthOfField: true,
  bokehRatio: 1,
}
const plane = {
  rect: { x: -64, y: -64, width: 128, height: 128 },
  center: { x: 0, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  down: { x: 0, y: 1, z: 0 },
  scaleX: 1,
  scaleY: 1,
}

describe('depth-of-field texture support', () => {
  it('leaves room for the aperture and prefilter outside a filled card', () => {
    const padding = depthOfFieldTexturePadding(plane, camera, 18)
    expect(padding.x).toBeGreaterThan(36)
    expect(padding.y).toBeGreaterThan(36)
    expect(padding.x).toBeLessThanOrEqual(52)
    expect(plane.rect).toEqual({ x: -64, y: -64, width: 128, height: 128 })
  })

  it('skips texture growth when depth of field or blur is disabled', () => {
    expect(depthOfFieldTexturePadding(plane, { ...camera, depthOfField: false }, 18)).toEqual({ x: 0, y: 0 })
    expect(depthOfFieldTexturePadding(plane, camera, 0)).toEqual({ x: 0, y: 0 })
    expect(depthOfFieldTexturePadding(plane, camera, NaN)).toEqual({ x: 0, y: 0 })
  })

  it('gives distant cards more local support for the same screen-space blur', () => {
    const near = depthOfFieldTexturePadding({ ...plane, center: { x: 0, y: 0, z: -500 } }, camera, 18)
    const far = depthOfFieldTexturePadding({ ...plane, center: { x: 0, y: 0, z: 1000 } }, camera, 18)
    expect(far.x).toBeGreaterThan(near.x * 2)
    expect(far.y).toBeGreaterThan(near.y * 2)
  })

  it('accounts for non-uniform scale and card tilt', () => {
    const front = depthOfFieldTexturePadding(plane, camera, 18)
    const scaled = depthOfFieldTexturePadding({ ...plane, scaleX: 0.25 }, camera, 18)
    const tilted = depthOfFieldTexturePadding({ ...plane, right: { x: 0.5, y: 0, z: Math.sqrt(0.75) } }, camera, 18)
    expect(scaled.x).toBeGreaterThan(front.x * 2)
    expect(scaled.y).toBe(front.y)
    expect(tilted.x).toBeGreaterThan(front.x)
  })

  it('supports anamorphic aperture extremes without truncating the long axis', () => {
    const round = depthOfFieldTexturePadding(plane, camera, 18)
    for (const bokehRatio of [0.25, 4]) {
      const stretched = depthOfFieldTexturePadding(plane, { ...camera, bokehRatio }, 18)
      expect(stretched.x).toBeGreaterThan(round.x)
      expect(stretched.y).toBeGreaterThan(round.y)
    }
  })

  it('reuses a bucket during small camera or orbital depth changes', () => {
    expect(depthOfFieldTexturePadding(plane, camera, 18)).toEqual(
      depthOfFieldTexturePadding({ ...plane, center: { x: 0, y: 0, z: 5 } }, camera, 18),
    )
  })

  it('bounds nearly edge-on and zero-scale support', () => {
    for (const edge of [
      { ...plane, right: { x: 0.00001, y: 0, z: 1 } },
      { ...plane, scaleX: 0 },
    ]) {
      const padding = depthOfFieldTexturePadding(edge, camera, 100)
      expect(Number.isFinite(padding.x + padding.y)).toBe(true)
      expect(padding.x).toBeLessThanOrEqual(1024)
      expect(padding.y).toBeLessThanOrEqual(1024)
    }
  })
})
