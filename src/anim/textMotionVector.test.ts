// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  resolveTextMotionVector,
  textMotionPerspectiveDistance,
} from './textMotionVector'

describe('text motion vectors', () => {
  it('keeps an absent vector distinct so renderers can use legacy travel', () => {
    expect(resolveTextMotionVector(null, 48, 0.5)).toBeNull()
    expect(resolveTextMotionVector(undefined, 48, 0.5)).toBeNull()
  })

  it('resolves every axis from line-height units at the local amount', () => {
    expect(
      resolveTextMotionVector({ x: 1, y: -0.5, z: 2 }, 40, 0.25),
    ).toEqual({ x: 10, y: -5, z: 20 })
  })

  it('reaches the authored vector at amount one and rests at amount zero', () => {
    const vector = { x: -1.25, y: 0.75, z: -0.5 }

    expect(resolveTextMotionVector(vector, 32, 1)).toEqual({
      x: -40,
      y: 24,
      z: -16,
    })
    expect(resolveTextMotionVector(vector, 32, 0)).toEqual({
      x: 0,
      y: 0,
      z: 0,
    })
  })

  it('keeps the maximum positive Z safely in front of the DOM viewpoint', () => {
    expect(textMotionPerspectiveDistance(40)).toBe(1000)

    const lineHeight = 120
    const maximumPositiveZ = lineHeight * 10
    const perspective = textMotionPerspectiveDistance(lineHeight)
    expect(perspective).toBe(2400)
    expect(maximumPositiveZ).toBeLessThan(perspective)
    expect(maximumPositiveZ).toBe(perspective / 2)
  })

})
