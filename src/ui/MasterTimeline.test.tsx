// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MasterTimeField } from './MasterTimeField'

describe('MasterTimeField', () => {
  it('makes exact Master time editable and keeps its frame cue visible', () => {
    const html = renderToStaticMarkup(
      <MasterTimeField
        value={2.5}
        duration={8}
        frameRate={60}
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('data-master-time-field="1"')
    expect(html).toContain('aria-label="Master time"')
    expect(html).toContain('value="2.5"')
    expect(html).toContain('aria-label="Master frame 150"')
    expect(html).toContain('f150')
  })

  it('clamps an out-of-range display value to the Master duration', () => {
    const html = renderToStaticMarkup(
      <MasterTimeField
        value={12}
        duration={8}
        frameRate={30}
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('value="8"')
    expect(html).toContain('aria-label="Master frame 239"')
  })
})
