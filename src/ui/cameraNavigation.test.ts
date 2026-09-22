// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  cameraDollyFromWheel,
  cameraOrbitFromPointer,
  cameraOrbitFromWheel,
  cameraPanFromPointer,
  cameraPanFromWheel,
  cameraZFromPointerDrag,
  normalizedWheelDeltas,
  resolveCameraPointerNavigation,
  resolveCameraWheelNavigation,
} from '@/ui/cameraNavigation'

describe('camera navigation policy', () => {
  it('uses Blender-style middle-mouse chords', () => {
    expect(resolveCameraPointerNavigation({ button: 1 })).toBe('orbit')
    expect(
      resolveCameraPointerNavigation({ button: 1, shiftKey: true }),
    ).toBe('pan')
    expect(
      resolveCameraPointerNavigation({ button: 1, ctrlKey: true }),
    ).toBe('dolly')
    expect(
      resolveCameraPointerNavigation({
        button: 1,
        shiftKey: true,
        ctrlKey: true,
      }),
    ).toBe('dolly')
  })

  it('emulates middle-mouse with Option/Alt plus primary drag', () => {
    expect(
      resolveCameraPointerNavigation({ button: 0, altKey: true }),
    ).toBe('orbit')
    expect(
      resolveCameraPointerNavigation({
        button: 0,
        altKey: true,
        shiftKey: true,
      }),
    ).toBe('pan')
    expect(
      resolveCameraPointerNavigation({
        button: 0,
        altKey: true,
        ctrlKey: true,
      }),
    ).toBe('dolly')
    expect(resolveCameraPointerNavigation({ button: 0 })).toBeNull()
    expect(
      resolveCameraPointerNavigation({ button: 2, altKey: true }),
    ).toBeNull()
  })

  it('keeps editor zoom ahead of wheel camera navigation', () => {
    expect(resolveCameraWheelNavigation({})).toBe('dolly')
    expect(resolveCameraWheelNavigation({ shiftKey: true })).toBe('pan')
    expect(resolveCameraWheelNavigation({ altKey: true })).toBe('orbit')
    expect(
      resolveCameraWheelNavigation({ shiftKey: true, altKey: true }),
    ).toBe('pan')
    expect(resolveCameraWheelNavigation({ ctrlKey: true })).toBeNull()
    expect(resolveCameraWheelNavigation({ metaKey: true })).toBeNull()
  })
})

describe('camera orbit navigation', () => {
  it('maps horizontal motion to yaw and vertical motion to pitch', () => {
    expect(
      cameraOrbitFromPointer({
        startRotationX: 10,
        startRotationY: 20,
        deltaX: 25,
        deltaY: -50,
      }),
    ).toEqual({ rotationX: 18, rotationY: 24 })
  })

  it('clamps pitch without limiting continuous yaw', () => {
    expect(
      cameraOrbitFromPointer({
        startRotationX: 80,
        startRotationY: 0,
        deltaX: 10_000,
        deltaY: -100,
      }),
    ).toEqual({ rotationX: 89, rotationY: 1600 })
  })

  it('normalizes and caps both axes for wheel orbit', () => {
    expect(
      normalizedWheelDeltas({
        deltaX: 4,
        deltaY: -4,
        deltaMode: 1,
        pageWidth: 1200,
        pageHeight: 800,
      }),
    ).toEqual({ x: 48, y: -48 })

    expect(
      cameraOrbitFromWheel({
        currentRotationX: 0,
        currentRotationY: 0,
        deltaX: 100,
        deltaY: -100,
        deltaMode: 0,
        pageWidth: 1200,
        pageHeight: 800,
      }),
    ).toEqual({ rotationX: 3.84, rotationY: 3.84 })
  })
})

describe('camera pan navigation', () => {
  it('scales pointer pan by workspace zoom and visible camera scale', () => {
    expect(
      cameraPanFromPointer({
        startX: 100,
        startY: 200,
        deltaX: 40,
        deltaY: -20,
        workspaceZoom: 2,
        cameraApparentScale: 0.5,
      }),
    ).toEqual({ x: 60, y: 220 })
  })

  it('uses scroll direction and the same zoom-aware scale for wheel pan', () => {
    expect(
      cameraPanFromWheel({
        currentX: 100,
        currentY: 200,
        deltaX: 24,
        deltaY: -12,
        deltaMode: 0,
        pageWidth: 1200,
        pageHeight: 800,
        workspaceZoom: 2,
        cameraApparentScale: 2,
      }),
    ).toEqual({ x: 106, y: 197 })
  })

  it('stays finite when a transient scale is invalid', () => {
    expect(
      cameraPanFromPointer({
        startX: 0,
        startY: 0,
        deltaX: 10,
        deltaY: 10,
        workspaceZoom: Number.NaN,
        cameraApparentScale: 0,
      }),
    ).toEqual({ x: -100, y: -100 })
  })
})

describe('camera dolly navigation', () => {
  it('uses proportional pointer dolly without capping the total drag', () => {
    const z = cameraZFromPointerDrag({
      startZ: 0,
      focalLength: 1000,
      deltaY: -100,
    })

    expect(z).toBeCloseTo(393.469, 3)
  })

  it('applies camera sensitivity and clamps at the lens safety limits', () => {
    const halfSpeedZ = cameraZFromPointerDrag({
      startZ: 0,
      focalLength: 1000,
      deltaY: -100,
      scrollSensitivity: 0.5,
    })
    const nearLimitZ = cameraZFromPointerDrag({
      startZ: 0,
      focalLength: 1000,
      deltaY: -1_000_000,
    })

    expect(halfSpeedZ).toBeCloseTo(221.199, 3)
    expect(nearLimitZ).toBe(999)
  })

  it('returns a Z-only patch for wheel dolly', () => {
    expect(
      cameraDollyFromWheel({
        currentZ: 0,
        focalLength: 1000,
        deltaY: -12,
        deltaMode: 0,
        pageHeight: 800,
      }),
    ).toEqual({ z: expect.closeTo(14.888, 3) })
  })
})
