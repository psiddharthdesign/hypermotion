// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { DEFAULT_EXTRUSION_SIDE_COLOR, MAX_EXTRUSION_DEPTH, normalizeExtrusion } from './extrusion'

describe('extrusion settings', () => {
  it('preserves legacy absence and explicit zero-depth settings', () => {
    for (const value of [undefined, null, false, 4, []]) expect(normalizeExtrusion(value)).toBeUndefined()
    expect(normalizeExtrusion({ depth: 0, sideColor: '#123456' })).toEqual({ depth: 0, sideColor: '#123456' })
  })
  it('sanitizes untrusted dimensions without rejecting CSS colors', () => {
    expect(normalizeExtrusion({ depth: -3, sideColor: ' ' })).toEqual({ depth: 0, sideColor: DEFAULT_EXTRUSION_SIDE_COLOR })
    expect(normalizeExtrusion({ depth: 1e10, sideColor: ' oklch(0.5 0.1 260) ' })).toEqual({ depth: MAX_EXTRUSION_DEPTH, sideColor: 'oklch(0.5 0.1 260)' })
    for (const depth of [NaN, Infinity, '12', null]) expect(normalizeExtrusion({ depth })?.depth).toBe(0)
  })
})
