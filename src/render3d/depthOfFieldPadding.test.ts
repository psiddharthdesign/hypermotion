// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { resolveCamera3D } from './scene3d'
import { depthOfFieldTexturePadding, retainDepthOfFieldPadding, type DepthOfFieldPadding } from './depthOfFieldPadding'

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

  it('keeps orthographic blur support independent of depth and scales it with zoom', () => {
    const ortho = { ...camera, projection: 'orthographic' as const, zoomX: 1, zoomY: 1 }
    const near = depthOfFieldTexturePadding({ ...plane, center: { x: 0, y: 0, z: -500 } }, ortho, 18)
    const far = depthOfFieldTexturePadding({ ...plane, center: { x: 0, y: 0, z: 1000 } }, ortho, 18)
    expect(far).toEqual(near)
    const zoomedOut = depthOfFieldTexturePadding(plane, { ...ortho, zoomX: 0.5, zoomY: 0.5 }, 18)
    expect(zoomedOut.x).toBeGreaterThan(near.x)
    expect(zoomedOut.y).toBeGreaterThan(near.y)
    // Both gutter sizes cover the same screen-space kernel, within a local 16px bucket.
    for (const [padding, zoom] of [[near, 1], [zoomedOut, 0.5]] as const) {
      expect(padding.x * zoom).toBeGreaterThanOrEqual(38)
      expect(padding.y * zoom).toBeGreaterThanOrEqual(38)
      expect(padding.x * zoom).toBeLessThan(38 + 16 * zoom)
      expect(padding.y * zoom).toBeLessThan(38 + 16 * zoom)
    }
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

describe('realtime depth-of-field padding retention', () => {
  it('keeps the per-axis maximum until paused, without modifying the requests', () => {
    const first = { x: 80, y: 48 }
    const requested = { x: 48, y: 96 }
    const retained = retainDepthOfFieldPadding(requested, first, true)
    expect(retained).toEqual({ x: 80, y: 96 })
    expect(retainDepthOfFieldPadding(first, retained, true)).toEqual({ x: 80, y: 96 })
    expect(retainDepthOfFieldPadding(requested, retained, false)).toBe(requested)
    expect(retainDepthOfFieldPadding(requested, undefined, true)).toBe(requested)
    expect(first).toEqual({ x: 80, y: 48 })
    expect(requested).toEqual({ x: 48, y: 96 })
  })

  it('resets when blur is disabled and starts a fresh realtime session on re-enable', () => {
    const disabled = depthOfFieldTexturePadding(plane, { ...camera, depthOfField: false }, 18)
    const reset = retainDepthOfFieldPadding(disabled, { x: 128, y: 192 }, true)
    expect(reset).toEqual({ x: 0, y: 0 })
    const enabled = depthOfFieldTexturePadding(plane, camera, 18)
    expect(retainDepthOfFieldPadding(enabled, reset, true)).toEqual(enabled)
  })

  it('keeps nearly edge-on support bounded at the existing texture limit', () => {
    const edge = depthOfFieldTexturePadding({ ...plane, scaleX: 0 }, camera, 100)
    const retained = retainDepthOfFieldPadding(edge, { x: 512, y: 1024 }, true)
    expect(retained).toEqual({ x: 1024, y: 1024 })
    expect(retainDepthOfFieldPadding({ x: 48, y: 48 }, retained, true)).toEqual(retained)
  })

  it('reduces actual texture-bound changes during a camera yaw cycle without losing requested support', () => {
    const authored = api.getActiveCamera()!
    const cameraNode = { ...authored, depthOfField: true, transform: { ...authored.transform, x: 0, y: 0 } }
    const yawCycle = [0, 10, 20, 25, 30, 35, 40, 35, 30, 25, 20, 10, 0]
    let previousRequest: DepthOfFieldPadding | undefined
    let retained: DepthOfFieldPadding | undefined
    let requestedChanges = 0
    let retainedChanges = 0
    for (const rotationY of yawCycle) {
      const resolved = resolveCamera3D(cameraNode, { rotationY }, { width: 960, height: 540 })
      const requested = depthOfFieldTexturePadding(plane, resolved, 18)
      const next = retainDepthOfFieldPadding(requested, retained, true)
      if (previousRequest && (requested.x !== previousRequest.x || requested.y !== previousRequest.y)) requestedChanges += 1
      if (retained && (next.x !== retained.x || next.y !== retained.y)) retainedChanges += 1
      expect(next.x).toBeGreaterThanOrEqual(requested.x)
      expect(next.y).toBeGreaterThanOrEqual(requested.y)
      expect(next.x).toBeGreaterThanOrEqual(retained?.x ?? 0)
      expect(next.y).toBeGreaterThanOrEqual(retained?.y ?? 0)
      expect(next.x).toBeLessThanOrEqual(1024)
      expect(next.y).toBeLessThanOrEqual(1024)
      previousRequest = requested
      retained = next
    }
    expect(requestedChanges).toBeGreaterThan(0)
    expect(retainedChanges).toBeLessThan(requestedChanges)
    expect(retainDepthOfFieldPadding(previousRequest!, retained, false)).toEqual(previousRequest)
  })
})
