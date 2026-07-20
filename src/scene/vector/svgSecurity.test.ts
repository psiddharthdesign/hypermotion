// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { namespaceSvgLocalReferences } from './svg'

describe('SVG local-reference namespacing', () => {
  const ids = new Map([
    ['paint', 'import-a-paint'],
    ['mask', 'import-a-mask'],
  ])

  it('rewrites href fragments and every quoted url form', () => {
    expect(namespaceSvgLocalReferences('#mask', ids)).toBe('#import-a-mask')
    expect(
      namespaceSvgLocalReferences(
        'fill:url(#paint);clip-path:url("#mask");stroke:url(\'#paint\')',
        ids,
      ),
    ).toBe(
      'fill:url(#import-a-paint);clip-path:url(#import-a-mask);stroke:url(#import-a-paint)',
    )
  })

  it('leaves unknown and non-local values unchanged', () => {
    expect(namespaceSvgLocalReferences('url(#unknown)', ids)).toBe('url(#unknown)')
    expect(namespaceSvgLocalReferences('none', ids)).toBe('none')
  })
})
