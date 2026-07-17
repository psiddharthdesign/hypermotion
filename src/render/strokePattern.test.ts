// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Stroke } from '@/scene'
import { strokePattern } from './strokePattern'

const base: Stroke = {
  color: '#000000',
  width: 3,
  align: 'inside',
  style: 'solid',
  dashLength: 6,
  dashGap: 4,
}

describe('strokePattern', () => {
  it('maps solid, dashed, and dotted stroke styles', () => {
    expect(strokePattern(base)).toEqual({ dash: [], lineCap: 'butt' })
    expect(strokePattern({ ...base, style: 'dashed' })).toEqual({
      dash: [6, 4],
      lineCap: 'butt',
    })
    expect(strokePattern({ ...base, style: 'dotted' })).toEqual({
      dash: [0, 6],
      lineCap: 'round',
    })
  })
})
