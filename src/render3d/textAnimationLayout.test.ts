// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  layoutCanvasTextAnimationSegments,
  layoutCanvasTextLines,
} from './textAnimationLayout'

const measure = (text: string) => Array.from(text).length * 10

describe('canvas text animation layout', () => {
  it('wraps like static text while one authored line remains one segment', () => {
    expect(layoutCanvasTextLines('Pricing that scales', 80, measure)).toEqual([
      { text: 'Pricing', canJustify: false },
      { text: 'that', canJustify: false },
      { text: 'scales', canJustify: false },
    ])

    const segments = layoutCanvasTextAnimationSegments({
      text: 'Pricing that scales',
      applyTo: 'lines',
      x: 5,
      y: 7,
      maxWidth: 80,
      lineHeightPx: 24,
      align: 'start',
      measure,
    })
    expect(
      segments.map(({ text, x, y, width, height, order }) => ({
        text,
        x,
        y,
        width,
        height,
        order,
      })),
    ).toEqual([
      {
        text: 'Pricing that scales',
        x: 5,
        y: 7,
        width: 80,
        height: 72,
        order: 0,
      },
    ])
  })

  it('preserves centre and end alignment for animated words', () => {
    const centered = layoutCanvasTextAnimationSegments({
      text: 'one two',
      applyTo: 'words',
      x: 10,
      y: 0,
      maxWidth: 100,
      lineHeightPx: 20,
      align: 'center',
      measure,
    })
    expect(centered[0]?.x).toBe(25)
    expect(centered.find((segment) => segment.text === 'two')?.x).toBe(65)
    expect(centered[0]?.trackingAlignment).toBe(0.5)

    const ended = layoutCanvasTextAnimationSegments({
      text: 'one two',
      applyTo: 'words',
      x: 10,
      y: 0,
      maxWidth: 100,
      lineHeightPx: 20,
      align: 'end',
      measure,
    })
    expect(ended[0]?.x).toBe(40)
    expect(ended[0]?.trackingAlignment).toBe(1)
  })

  it('keeps glyph positions on their authored line-height and tracks spaces', () => {
    const segments = layoutCanvasTextAnimationSegments({
      text: 'AB\nC D',
      applyTo: 'letters',
      x: 0,
      y: 3,
      maxWidth: 100,
      lineHeightPx: 30,
      align: 'start',
      measure,
    })
    expect(segments.find((segment) => segment.text === 'C')?.y).toBe(33)
    expect(segments.find((segment) => segment.text === 'D')?.trackingIndex).toBe(2)
  })
})
