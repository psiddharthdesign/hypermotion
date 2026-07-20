// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Yoga } from 'yoga-layout/load'
import type { VectorNode } from '@/scene'
import { makeVectorMeasure } from '@/layout/vectorMeasure'

const yoga = {
  MEASURE_MODE_UNDEFINED: 0,
  MEASURE_MODE_EXACTLY: 1,
  MEASURE_MODE_AT_MOST: 2,
} as Yoga

const node = {
  viewBox: { x: 0, y: 0, width: 240, height: 120 },
} as VectorNode

describe('vector intrinsic measurement', () => {
  it('uses the imported viewBox for hug sizing', () => {
    const measure = makeVectorMeasure(yoga, node)
    expect(measure(0, 0, 0, 0)).toEqual({ width: 240, height: 120 })
  })

  it('preserves aspect ratio when one axis is fixed', () => {
    const measure = makeVectorMeasure(yoga, node)
    expect(measure(120, 1, 0, 0)).toEqual({ width: 120, height: 60 })
    expect(measure(0, 0, 80, 1)).toEqual({ width: 160, height: 80 })
  })
})
