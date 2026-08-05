// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FieldRow } from './FieldRow'

describe('FieldRow inspector grid', () => {
  it('keeps label, value, and keyframe in one stable order', () => {
    const html = renderToStaticMarkup(
      <FieldRow label="Rotation" keyframe={<button>Keyframe</button>}>
        <input aria-label="Rotation value" />
      </FieldRow>,
    )

    expect(html.indexOf('Rotation')).toBeLessThan(
      html.indexOf('Rotation value'),
    )
    expect(html.indexOf('Rotation value')).toBeLessThan(
      html.indexOf('Keyframe'),
    )
    expect(html).toContain('data-inspector-keyframe="1"')
  })

  it('lets a compound value use the full width beneath its label', () => {
    const html = renderToStaticMarkup(
      <FieldRow label="Position" layout="compound">
        <div aria-label="Position channels" />
      </FieldRow>,
    )

    expect(html).toContain('grid-cols-1')
    expect(html).toContain('text-[10px]')
    expect(html.indexOf('Position')).toBeLessThan(
      html.indexOf('Position channels'),
    )
    expect(html).not.toContain('data-inspector-keyframe="1"')
  })

  it('reserves the action column only when a keyframe action exists', () => {
    const staticHtml = renderToStaticMarkup(
      <FieldRow label="Name">
        <input aria-label="Name value" />
      </FieldRow>,
    )
    const animatedHtml = renderToStaticMarkup(
      <FieldRow label="Opacity" keyframe={<button>Keyframe</button>}>
        <input aria-label="Opacity value" />
      </FieldRow>,
    )

    expect(staticHtml).toContain('grid-cols-1')
    expect(staticHtml).not.toContain('data-inspector-keyframe="1"')
    expect(animatedHtml).toContain('grid-cols-[minmax(0,1fr)_28px]')
  })

  it('can reserve the aligned action guide without inventing an action', () => {
    const html = renderToStaticMarkup(
      <FieldRow label="Stroke" reserveAction>
        <input aria-label="Stroke value" />
      </FieldRow>,
    )

    expect(html).toContain('grid-cols-[minmax(0,1fr)_28px]')
    expect(html).toContain('gap-x-2')
    expect(html).toContain('data-inspector-action="1"')
    expect(html).not.toContain('data-inspector-keyframe="1"')
  })
})
