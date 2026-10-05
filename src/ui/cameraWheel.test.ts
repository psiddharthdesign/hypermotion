// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  cameraWheelStartZ,
  cameraScaleFromWheel,
  cameraZFromWheel,
  normalizedWheelDeltaY,
} from '@/ui/cameraWheel'

const visibleScale = (z: number, focalLength = 1000) =>
  focalLength / (focalLength - z)

describe('camera wheel dolly', () => {
  it('starts from the value that is currently visible instead of stale static Z', () => {
    expect(
      cameraWheelStartZ({
        pendingZ: 475,
        previewZ: 450,
        animatedZ: 400,
        staticZ: 0,
      }),
    ).toBe(475)
    expect(
      cameraWheelStartZ({ previewZ: 450, animatedZ: 400, staticZ: 0 }),
    ).toBe(450)
    expect(cameraWheelStartZ({ animatedZ: 400, staticZ: 0 })).toBe(400)
    expect(cameraWheelStartZ({ staticZ: 125 })).toBe(125)
  })

  it('normalizes wheel units and caps momentum-heavy packets', () => {
    expect(normalizedWheelDeltaY(12, 0, 900)).toBe(12)
    expect(normalizedWheelDeltaY(3, 1, 900)).toBe(48)
    expect(normalizedWheelDeltaY(1, 2, 900)).toBe(48)
    expect(normalizedWheelDeltaY(-200, 0, 900)).toBe(-48)
    expect(normalizedWheelDeltaY(Number.NaN, 0, 900)).toBe(0)
  })

  it('turns a normal trackpad packet into a subtle proportional zoom', () => {
    const z = cameraZFromWheel({
      currentZ: 0,
      focalLength: 1000,
      deltaY: -12,
      deltaMode: 0,
      pageHeight: 900,
    })

    expect(z).toBeCloseTo(14.888, 3)
    expect(visibleScale(z)).toBeCloseTo(1.0151, 4)
  })

  it('uses Alt/Option for fine dolly control', () => {
    const normal = cameraZFromWheel({
      currentZ: 0,
      focalLength: 1000,
      deltaY: -48,
      deltaMode: 0,
      pageHeight: 900,
    })
    const fine = cameraZFromWheel({
      currentZ: 0,
      focalLength: 1000,
      deltaY: -48,
      deltaMode: 0,
      pageHeight: 900,
      fine: true,
    })

    expect(normal).toBeCloseTo(58.235, 3)
    expect(fine).toBeCloseTo(14.888, 3)
  })

  it('applies the persisted per-camera sensitivity multiplier', () => {
    const normal = cameraZFromWheel({
      currentZ: 0,
      focalLength: 1000,
      deltaY: -48,
      deltaMode: 0,
      pageHeight: 900,
      scrollSensitivity: 1,
    })
    const half = cameraZFromWheel({
      currentZ: 0,
      focalLength: 1000,
      deltaY: -48,
      deltaMode: 0,
      pageHeight: 900,
      scrollSensitivity: 0.5,
    })

    expect(normal).toBeCloseTo(58.235, 3)
    expect(half).toBeCloseTo(29.554, 3)
  })

  it('keeps moving monotonically across a long continuous gesture', () => {
    let zoomInZ = 0
    let zoomOutZ = 0
    for (let i = 0; i < 100; i += 1) {
      const previousZoomInZ = zoomInZ
      const previousZoomOutZ = zoomOutZ
      zoomInZ = cameraZFromWheel({
        currentZ: zoomInZ,
        focalLength: 1000,
        deltaY: -100,
        deltaMode: 0,
        pageHeight: 900,
      })
      zoomOutZ = cameraZFromWheel({
        currentZ: zoomOutZ,
        focalLength: 1000,
        deltaY: 100,
        deltaMode: 0,
        pageHeight: 900,
      })
      expect(zoomInZ).toBeGreaterThan(previousZoomInZ)
      expect(zoomOutZ).toBeLessThan(previousZoomOutZ)
    }

    // 100 capped packets represent e^(100 * 48 * .00125) = e^6 of
    // distance change. Neither direction should hit the broad renderer-safe
    // envelope yet, proving sensitivity no longer doubles as a tiny range.
    expect(visibleScale(zoomInZ)).toBeCloseTo(Math.exp(6), 7)
    expect(visibleScale(zoomOutZ)).toBeCloseTo(Math.exp(-6), 10)
  })

  it('only stops at the renderer-safe near and far distance limits', () => {
    let zoomInZ = 0
    let zoomOutZ = 0
    for (let i = 0; i < 300; i += 1) {
      zoomInZ = cameraZFromWheel({
        currentZ: zoomInZ,
        focalLength: 1000,
        deltaY: -100,
        deltaMode: 0,
        pageHeight: 900,
      })
      zoomOutZ = cameraZFromWheel({
        currentZ: zoomOutZ,
        focalLength: 1000,
        deltaY: 100,
        deltaMode: 0,
        pageHeight: 900,
      })
    }

    expect(visibleScale(zoomInZ)).toBeCloseTo(1000, 8)
    expect(visibleScale(zoomOutZ)).toBeCloseTo(0.001, 10)
  })

  it('recovers gradually from an authored distance beyond the far limit', () => {
    const focalLength = 1000
    const authoredDistance = focalLength * 2000
    const currentZ = focalLength - authoredDistance
    const nextZ = cameraZFromWheel({
      currentZ,
      focalLength,
      deltaY: -48,
      deltaMode: 0,
      pageHeight: 900,
    })
    const nextDistance = focalLength - nextZ

    // A zoom-in packet should move 6% logarithmically from the authored pose,
    // not jump straight to the nominal 1000-focal-length boundary.
    expect(nextDistance).toBeCloseTo(
      authoredDistance * Math.exp(-48 * 0.00125),
      6,
    )
    expect(nextDistance).toBeGreaterThan(focalLength * 1000)

    const blockedFartherZ = cameraZFromWheel({
      currentZ,
      focalLength,
      deltaY: 48,
      deltaMode: 0,
      pageHeight: 900,
    })
    expect(blockedFartherZ).toBe(currentZ)
  })
})

describe('orthographic camera wheel zoom', () => {
  const input = { currentScaleX: 1, currentScaleY: 1, deltaY: -12, deltaMode: 0, pageHeight: 900 }

  it('changes the view extent with the same apparent zoom response as perspective', () => {
    const next = cameraScaleFromWheel(input)
    expect(1 / next.scaleX).toBeCloseTo(visibleScale(cameraZFromWheel({ ...input, currentZ: 0, focalLength: 1000 })))
    expect(next.scaleY).toBe(next.scaleX)
    expect(next).not.toHaveProperty('z')
  })

  it('uses the displayed X zoom uniformly and responds to sensitivity despite legacy Y values', () => {
    const next = cameraScaleFromWheel({ ...input, currentScaleX: 0.5, currentScaleY: 1, scrollSensitivity: 0.5 })
    expect(next.scaleX).toBeCloseTo(0.5 * Math.exp(-12 * 0.00125 * 0.5))
    expect(next.scaleY).toBe(next.scaleX)
  })

  it.each([0, Number.NaN, 0.00001, 100000])('does not let hidden Y scale %s constrain zoom', (currentScaleY) => {
    const next = cameraScaleFromWheel({ ...input, currentScaleX: 0.5, currentScaleY })
    expect(next.scaleX).toBeCloseTo(0.5 * Math.exp(-12 * 0.00125))
    expect(next.scaleY).toBe(next.scaleX)
    const zoomOut = cameraScaleFromWheel({ ...input, currentScaleX: 0.5, currentScaleY, deltaY: 12 })
    expect(zoomOut.scaleX).toBeGreaterThan(0.5)
    expect(zoomOut.scaleY).toBe(zoomOut.scaleX)
  })

  it('stops at safe zoom limits and recovers from older extreme values without jumping', () => {
    expect(cameraScaleFromWheel({ ...input, currentScaleX: 0.001, currentScaleY: 0.001 }).scaleX).toBe(0.001)
    const recover = cameraScaleFromWheel({ ...input, currentScaleX: 2000, currentScaleY: 2000 })
    expect(recover.scaleX).toBeCloseTo(2000 * Math.exp(-12 * 0.00125))
    expect(cameraScaleFromWheel({ ...input, currentScaleX: 2000, currentScaleY: 2000, deltaY: 12 }).scaleX).toBe(2000)
    expect(cameraScaleFromWheel({ ...input, currentScaleX: Number.NaN, currentScaleY: 0 }).scaleX).toBeGreaterThan(0)
  })
})
