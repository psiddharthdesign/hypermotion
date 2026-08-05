// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/scene', () => ({
  defaultFill: () => ({ kind: 'solid', color: '#000000' }),
  fillToCss: (fill: { color?: string } | null) => fill?.color ?? '',
  imageBackgroundStyle: () => null,
}))

import { FillField } from './FillField'

describe('FillField inspector grammar', () => {
  it('keeps the paint value inside one full control surface before the keyframe action', () => {
    const html = renderToStaticMarkup(
      <FillField
        value={{ kind: 'solid', color: '#f4f4f5' }}
        onCommit={() => undefined}
        keyframe={<button>Keyframe</button>}
      />,
    )

    expect(html).toContain('data-inspector-row="1"')
    expect(html).toContain('data-fill-control="1"')
    expect(html).toContain('data-inspector-keyframe="1"')
    expect(html.indexOf('Fill')).toBeLessThan(html.indexOf('#f4f4f5'))
    expect(html.indexOf('#f4f4f5')).toBeLessThan(html.indexOf('Keyframe'))
  })

  it('fills a parent value slot when embedded without its own label', () => {
    const html = renderToStaticMarkup(
      <FillField
        label=""
        value={null}
        onCommit={() => undefined}
      />,
    )

    expect(html).toContain('relative min-w-0 w-full')
    expect(html).toContain('data-fill-control="1"')
    expect(html).toContain('None')
  })
})
