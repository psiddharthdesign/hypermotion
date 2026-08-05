// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Transform } from '@/scene'
import { transformForAbsolutePosition } from './positionMode'

const transform: Transform = {
  x: 12.25,
  y: -7.5,
  z: 0,
  rotation: 8,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1.1,
  scaleY: 0.9,
}

describe('flow to absolute position conversion', () => {
  it('preserves an existing free-position transform under Layout: None', () => {
    expect(
      transformForAbsolutePosition(
        transform,
        { x: 80, y: 64, width: 200, height: 48 },
        { x: 80, y: 64, width: 960, height: 540 },
      ),
    ).toEqual(transform)
  })

  it('moves the solved flow slot into the transform without subtracting padding', () => {
    const result = transformForAbsolutePosition(
      transform,
      { x: 250.125, y: 190.375, width: 200, height: 48 },
      { x: 80, y: 50, width: 960, height: 540 },
    )

    expect(result).toMatchObject({ x: 182.38, y: 132.88 })
    expect(result.rotation).toBe(transform.rotation)
    expect(result.scaleX).toBe(transform.scaleX)
  })
})
