// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  canvasTextEditPresentation,
  isRepeatedCanvasPress,
} from './canvasTextEditing'

describe('canvas text editing', () => {
  it('reveals the editable DOM scene while WebGL stays mounted but hidden', () => {
    expect(canvasTextEditPresentation(true, null)).toEqual({
      showDomScene: false,
      hideWebglScene: false,
      suspendWebglScene: false,
      applyDomCameraPostEffects: false,
    })
    expect(canvasTextEditPresentation(true, 'text-1')).toEqual({
      showDomScene: true,
      hideWebglScene: true,
      suspendWebglScene: true,
      applyDomCameraPostEffects: false,
    })
    expect(canvasTextEditPresentation(false, null)).toEqual({
      showDomScene: true,
      hideWebglScene: false,
      suspendWebglScene: false,
      applyDomCameraPostEffects: true,
    })
    expect(canvasTextEditPresentation(false, 'text-1')).toEqual({
      showDomScene: true,
      hideWebglScene: true,
      suspendWebglScene: true,
      applyDomCameraPostEffects: false,
    })
  })

  it('uses the interruptible DOM renderer for transient geometry previews', () => {
    expect(canvasTextEditPresentation(true, null, true)).toEqual({
      showDomScene: true,
      hideWebglScene: true,
      suspendWebglScene: true,
      applyDomCameraPostEffects: false,
    })
    expect(canvasTextEditPresentation(false, null, true)).toEqual({
      showDomScene: true,
      hideWebglScene: true,
      suspendWebglScene: true,
      applyDomCameraPostEffects: false,
    })
  })

  it('recognizes a nearby second press without relying on dblclick', () => {
    const first = { time: 100, clientX: 50, clientY: 80 }
    expect(
      isRepeatedCanvasPress(first, {
        time: 450,
        clientX: 54,
        clientY: 82,
      }),
    ).toBe(true)
    expect(
      isRepeatedCanvasPress(first, {
        time: 501,
        clientX: 54,
        clientY: 82,
      }),
    ).toBe(false)
    expect(
      isRepeatedCanvasPress(first, {
        time: 200,
        clientX: 70,
        clientY: 80,
      }),
    ).toBe(false)
  })
})
