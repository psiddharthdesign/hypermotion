// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Transform } from '@/scene'
import { pivotPreservingTransformPatch } from './pivotTransform'

const base: Transform = {
  x: 300,
  y: 180,
  z: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
  anchorX: 0,
  anchorY: 0,
  anchorZ: 0,
}

describe('pivot-preserving transform', () => {
  it('does not translate an identity transform', () => {
    expect(
      pivotPreservingTransformPatch(base, 200, 80, {
        anchorX: 0.5,
        anchorY: 0.5,
        anchorZ: 0,
      }),
    ).toEqual({
      x: 300,
      y: 180,
      z: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      anchorZ: 0,
    })
  })

  it('compensates scale when moving the pivot to center', () => {
    expect(
      pivotPreservingTransformPatch(
        { ...base, scaleX: 2, scaleY: 3 },
        200,
        80,
        { anchorX: 0.5, anchorY: 0.5, anchorZ: 0 },
      ),
    ).toMatchObject({ x: 400, y: 260 })
  })

  it('compensates rotation when moving the pivot to center', () => {
    const patch = pivotPreservingTransformPatch(
      { ...base, rotation: 90 },
      200,
      80,
      { anchorX: 0.5, anchorY: 0.5, anchorZ: 0 },
    )
    expect(patch.x).toBeCloseTo(160)
    expect(patch.y).toBeCloseTo(240)
  })
})
