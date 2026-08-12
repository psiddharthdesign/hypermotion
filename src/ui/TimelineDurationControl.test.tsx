// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TimelineDurationControl } from './TimelineDurationControl'

describe('TimelineDurationControl', () => {
  it('exposes the same direct duration controls for Master', () => {
    const html = renderToStaticMarkup(
      <TimelineDurationControl
        duration={8.5}
        onChange={() => undefined}
        min={2}
        max={12}
        ariaLabel="Master duration"
      />,
    )

    expect(html).toContain('data-timeline-duration-control="1"')
    expect(html).toContain('aria-label="Master duration"')
    expect(html).toContain(
      'aria-label="Decrease Master duration by 1 second"',
    )
    expect(html).toContain(
      'aria-label="Increase Master duration by 1 second"',
    )
    expect(html).toContain('value="8.5"')
  })

  it('disables every affordance when no sequence can be resized', () => {
    const html = renderToStaticMarkup(
      <TimelineDurationControl
        duration={0}
        onChange={() => undefined}
        disabled
        ariaLabel="Master duration"
      />,
    )

    expect(html.match(/disabled=""/g)).toHaveLength(4)
  })

  it('disables only the nudge that would cross a duration bound', () => {
    const atMinimum = renderToStaticMarkup(
      <TimelineDurationControl
        duration={4}
        onChange={() => undefined}
        min={4}
        max={12}
        ariaLabel="Master duration"
      />,
    )
    const atMaximum = renderToStaticMarkup(
      <TimelineDurationControl
        duration={12}
        onChange={() => undefined}
        min={4}
        max={12}
        ariaLabel="Master duration"
      />,
    )

    const buttonTag = (html: string, label: string) =>
      html.match(
        new RegExp(`<button(?=[^>]*aria-label="${label}")[^>]*>`),
      )?.[0]

    expect(
      buttonTag(atMinimum, 'Decrease Master duration by 1 second'),
    ).toContain('disabled=""')
    expect(
      buttonTag(atMinimum, 'Increase Master duration by 1 second'),
    ).not.toContain('disabled=""')
    expect(
      buttonTag(atMaximum, 'Decrease Master duration by 1 second'),
    ).not.toContain('disabled=""')
    expect(
      buttonTag(atMaximum, 'Increase Master duration by 1 second'),
    ).toContain('disabled=""')
  })
})
