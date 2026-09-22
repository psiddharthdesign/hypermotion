// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  cameraWheelStartZ,
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
