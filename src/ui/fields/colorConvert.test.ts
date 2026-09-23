// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { oklchToHex, parsePickerColor } from './colorConvert'

describe('Color picker input', () => {
  it('initializes from custom Beam hex swatches and accepts typed hex colors', () => {
    for (const [input, expected] of [['#288cff', '#288cff'], ['#fff', '#ffffff'], ['ff3264', '#ff3264']]) {
      const color = parsePickerColor(input)
      expect(color).not.toBeNull()
      expect(oklchToHex(color!)).toBe(expected)
    }
  })
  it('keeps edited OKLCH colors and rejects absent or malformed input', () => {
    expect(parsePickerColor('oklch(0.7 0.2 222)')).toEqual({ l: .7, c: .2, h: 222 })
    for (const input of [null, undefined, '', '#garbage']) expect(parsePickerColor(input)).toBeNull()
  })
})
