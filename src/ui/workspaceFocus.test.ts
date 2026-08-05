// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { fitWorkspaceBounds } from '@/ui/workspaceFocus'

describe('fitWorkspaceBounds', () => {
  it('centers the output scene without introducing pan', () => {
    const view = fitWorkspaceBounds({
      bounds: [{ x: 0, y: 0, width: 960, height: 540 }],
      artboardWidth: 960,
      artboardHeight: 540,
      viewportWidth: 1200,
      viewportHeight: 800,
      margin: 40,
      maxZoom: 2,
    })

    expect(view).not.toBeNull()
    expect(view?.panX).toBeCloseTo(0)
    expect(view?.panY).toBeCloseTo(0)
    expect(view?.zoom).toBeCloseTo(1120 / 960)
  })

  it('pans an off-screen workspace frame into the viewport', () => {
    const view = fitWorkspaceBounds({
      bounds: [{ x: -400, y: 180, width: 200, height: 120 }],
      artboardWidth: 960,
      artboardHeight: 540,
      viewportWidth: 1000,
      viewportHeight: 700,
      margin: 40,
      maxZoom: 2,
    })

    expect(view).toEqual({
      zoom: 2,
      panX: 1560,
      panY: 60,
    })
  })

  it('fits the output scene and off-screen workspace items together', () => {
    const view = fitWorkspaceBounds({
      bounds: [
        { x: 0, y: 0, width: 960, height: 540 },
        { x: -400, y: 180, width: 200, height: 120 },
      ],
      artboardWidth: 960,
      artboardHeight: 540,
      viewportWidth: 1000,
      viewportHeight: 700,
      margin: 40,
      maxZoom: 2,
    })

    expect(view).not.toBeNull()
    expect(view?.zoom).toBeCloseTo(920 / 1360)
    expect(view?.panX).toBeGreaterThan(0)
    expect(view?.panY).toBeCloseTo(0)
  })
})
