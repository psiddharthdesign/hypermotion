// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { splitDomTextAnimationSegments } from './textAnimationSegments'

describe('DOM text animation segmentation', () => {
  it('keeps a layer effect in the authored wrapping box', () => {
    expect(splitDomTextAnimationSegments('Pricing that scales', 'layer')).toEqual([
      { text: 'Pricing that scales', animate: true, kind: 'layer' },
    ])
  })

  it('models authored newlines once without synthetic newline segments', () => {
    expect(splitDomTextAnimationSegments('Pricing\nthat scales', 'lines')).toEqual([
      { text: 'Pricing', animate: true, kind: 'line', breakAfter: true },
      { text: 'that scales', animate: true, kind: 'line', breakAfter: false },
    ])
  })

  it('preserves whitespace as non-animated text flow between words', () => {
    expect(splitDomTextAnimationSegments('one  two', 'words')).toEqual([
      { text: 'one', animate: true, kind: 'inline' },
      { text: '  ', animate: false, kind: 'inline' },
      { text: 'two', animate: true, kind: 'inline' },
    ])
  })
})
