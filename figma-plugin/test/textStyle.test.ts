// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { readFirstTextStyle, type TextStyleSource } from '../src/textStyle'

describe('readFirstTextStyle', () => {
  it('uses node-level styles for empty text without reading an invalid range', () => {
    const rangeRead = vi.fn(() => {
      throw new Error('range outside available characters')
    })
    const node: TextStyleSource = {
      characters: '',
      fontName: { family: 'Bricolage Grotesque', style: 'Medium' },
      fontSize: 24,
      lineHeight: { unit: 'PIXELS', value: 32 },
      letterSpacing: { unit: 'PERCENT', value: 2 },
      getRangeFontName: rangeRead,
      getRangeFontSize: rangeRead,
      getRangeLineHeight: rangeRead,
      getRangeLetterSpacing: rangeRead,
    }

    expect(readFirstTextStyle(node)).toEqual({
      fontName: { family: 'Bricolage Grotesque', style: 'Medium' },
      fontSize: 24,
      lineHeight: { unit: 'PIXELS', value: 32 },
      letterSpacing: { unit: 'PERCENT', value: 2 },
    })
    expect(rangeRead).not.toHaveBeenCalled()
  })

  it('uses the first character style when text is present', () => {
    const node: TextStyleSource = {
      characters: 'Text',
      fontName: Symbol('mixed'),
      fontSize: Symbol('mixed'),
      lineHeight: Symbol('mixed'),
      letterSpacing: Symbol('mixed'),
      getRangeFontName: () => ({ family: 'Inter', style: 'Bold' }),
      getRangeFontSize: () => 18,
      getRangeLineHeight: () => ({ unit: 'AUTO' }),
      getRangeLetterSpacing: () => ({ unit: 'PIXELS', value: 0.5 }),
    }

    expect(readFirstTextStyle(node)).toEqual({
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 18,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0.5 },
    })
  })
})
