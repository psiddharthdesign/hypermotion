// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CheckboxField } from './CheckboxField'

describe('CheckboxField', () => {
  it('exposes a mixed multi-selection state without pretending it is false', () => {
    const html = renderToStaticMarkup(
      <CheckboxField value={false} mixed onCommit={() => undefined} />,
    )

    expect(html).toContain('aria-checked="mixed"')
    expect(html).not.toContain('checked=""')
  })
})
