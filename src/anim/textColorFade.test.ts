// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { textColorFadePaint } from './textColorFade'

describe('text color fade alpha fallback', () => {
  it('reveals an In animation continuously', () => {
    expect(textColorFadePaint('in', 0).opacity).toBe(0)
    expect(textColorFadePaint('in', 0.5).opacity).toBe(0.5)
    expect(textColorFadePaint('in', 1).opacity).toBe(1)
  })

  it('remains visible when a clipped fill makes the glyph color transparent', () => {
    const style = {
      background: 'linear-gradient(#fff, #000)',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      ...textColorFadePaint('in', 0.5),
    }

    expect(style.WebkitTextFillColor).toBe('transparent')
    expect(style.opacity).toBe(0.5)
    expect(style.color).toContain('color-mix')
  })

  it('hides an Out animation continuously and clamps malformed progress', () => {
    expect(textColorFadePaint('out', 0.25).opacity).toBe(0.75)
    expect(textColorFadePaint('out', 2).opacity).toBe(0)
    expect(textColorFadePaint('in', Number.NaN).opacity).toBe(0)
  })
})
