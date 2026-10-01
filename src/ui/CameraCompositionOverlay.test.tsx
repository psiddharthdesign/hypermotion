// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CameraCompositionOverlay } from './CameraCompositionOverlay'

describe('camera composition overlay', () => {
  it('marks guides as editor-only and lets clicks pass through to the scene', () => {
    const html = renderToStaticMarkup(<CameraCompositionOverlay guide="thirds" width={960} height={540} zoom={1} />)
    expect(html).toContain('data-export-hide="1"')
    expect(html).toContain('data-camera-composition-guide="thirds"')
    expect(html).toContain('pointer-events:none')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('focusable="false"')
    expect(html).toContain('overflow:hidden')
    expect(html).toContain('viewBox="0 0 960 540"')
    expect(html).not.toContain('tabindex')
  })

  it.each([0.1, 0.5, 1, 2, 8])('keeps its light stroke and dark halo constant on screen at %s zoom', zoom => {
    const html = renderToStaticMarkup(<CameraCompositionOverlay guide="diamond" width={960} height={540} zoom={zoom} />)
    expect(html).toContain(`stroke-width="${2.5 / zoom}"`)
    expect(html).toContain(`stroke-width="${1 / zoom}"`)
    expect(html).toContain('stroke="#000"')
    expect(html).toContain('stroke="#fff"')
  })

  it('renders nothing when switched off or when the artboard is unavailable', () => {
    expect(renderToStaticMarkup(<CameraCompositionOverlay guide="none" width={960} height={540} zoom={1} />)).toBe('')
    expect(renderToStaticMarkup(<CameraCompositionOverlay guide="thirds" width={0} height={540} zoom={1} />)).toBe('')
  })

  it('keeps invalid viewport zooms from producing invisible or invalid strokes', () => {
    for (const zoom of [0, -1, NaN, Infinity]) {
      const html = renderToStaticMarkup(<CameraCompositionOverlay guide="thirds" width={960} height={540} zoom={zoom} />)
      expect(html).toContain('stroke-width="1"')
      expect(html).not.toMatch(/NaN|Infinity/)
    }
  })
})
