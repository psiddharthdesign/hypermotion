// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'

// The production font module also exports React hooks wired to the live scene
// document. The importer only needs this pure predicate, so isolate it from
// IndexedDB and the application singleton in the Node test environment.
vi.mock('@/ui/fonts/googleFonts', () => ({
  isGoogleFont: () => true,
}))

import { figmaToFill, figmaToStroke } from './fillMap'
import { figmaToLayout, figmaToTransform } from './layoutMap'
import { figmaToText } from './textMap'
import type {
  FigmaCapturedFrame,
  FigmaCapturedRect,
  FigmaCapturedText,
  FigmaSolidFill,
} from './types'

const carbon: FigmaSolidFill = {
  type: 'SOLID',
  color: { r: 68 / 255, g: 63 / 255, b: 59 / 255 },
  opacity: 1,
  visible: true,
}

function capturedRect(
  overrides: Partial<FigmaCapturedRect> = {},
): FigmaCapturedRect {
  return {
    id: 'rect',
    name: 'Rect',
    type: 'RECTANGLE',
    visible: true,
    locked: false,
    opacity: 1,
    x: 24,
    y: 32,
    width: 100,
    height: 48,
    rotation: 0,
    cornerRadius: [0, 0, 0, 0],
    fills: [],
    strokes: [],
    strokeWeight: 0,
    strokeAlign: 'INSIDE',
    strokeDashes: [],
    ...overrides,
  }
}

type GridCapture = FigmaCapturedFrame & {
  gridRowCount: number
  gridColumnCount: number
  gridRowGap: number
  gridColumnGap: number
}

function capturedGrid(): GridCapture {
  return {
    id: 'pricing-grid',
    name: 'Pricing grid',
    type: 'FRAME',
    visible: true,
    locked: false,
    opacity: 1,
    x: 0,
    y: 0,
    width: 1104,
    height: 498,
    rotation: 0,
    cornerRadius: [0, 0, 0, 0],
    fills: [],
    strokes: [],
    strokeWeight: 0,
    strokeAlign: 'INSIDE',
    strokeDashes: [],
    layoutMode: 'GRID',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    // Deliberately differs from both grid gaps. A mapper that falls
    // back to the legacy auto-layout gap cannot satisfy this fixture.
    itemSpacing: 99,
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    layoutWrap: 'NO_WRAP',
    clipsContent: false,
    children: [],
    gridRowCount: 1,
    gridColumnCount: 2,
    gridRowGap: 12,
    gridColumnGap: 24,
  }
}

function capturedText(
  overrides: Partial<FigmaCapturedText> = {},
): FigmaCapturedText {
  return {
    ...capturedRect(),
    id: 'label',
    name: 'Label',
    type: 'TEXT',
    characters: 'starter',
    fontFamily: 'Geist Mono',
    fontWeight: 600,
    fontStyle: 'italic',
    fontSize: 14,
    lineHeightPx: 20,
    letterSpacingPx: 0.56,
    textAlignHorizontal: 'JUSTIFIED',
    textAlignVertical: 'BOTTOM',
    textCase: 'UPPER',
    textDecoration: 'UNDERLINE',
    textAutoResize: 'NONE',
    fills: [carbon],
    ...overrides,
  }
}

describe('Figma import mapping regressions', () => {
  it('uses captured grid columns and independent row/column gaps', () => {
    const layout = figmaToLayout(capturedGrid())

    expect(layout.mode).toBe('grid')
    expect(layout.columns).toBe(2)
    expect(layout.rowGap).toBe(12)
    expect(layout.columnGap).toBe(24)
  })

  it('preserves a flow child rotation while Yoga owns its x/y position', () => {
    const transform = figmaToTransform(
      capturedRect({ x: 240, y: 128, rotation: 17.5 }),
      'HORIZONTAL',
    )

    expect(transform).toMatchObject({ x: 0, y: 0, rotation: 17.5 })
  })

  it('retains a border made entirely from per-side stroke widths', () => {
    const widths = { top: 0, right: 0, bottom: 1, left: 0 }
    const stroke = figmaToStroke(
      [carbon],
      0,
      'INSIDE',
      [],
      {},
      widths,
    )

    expect(stroke).not.toBeNull()
    expect(stroke).toMatchObject({
      width: 1,
      widths,
      align: 'inside',
      style: 'solid',
    })
  })

  it('keeps an opaque Figma sRGB color in its exact 8-bit representation', () => {
    expect(figmaToFill([carbon], {})).toEqual({
      kind: 'solid',
      color: '#443f3b',
    })
  })

  it('maps Figma text presentation without mutating the authored characters', () => {
    const text = figmaToText(capturedText(), {})

    expect(text).toMatchObject({
      text: 'starter',
      size: { width: 100, height: 48 },
      fontStyle: 'italic',
      textAlign: 'justify',
      textAlignVertical: 'bottom',
      textCase: 'upper',
      textDecoration: 'underline',
    })
  })

  it('keeps a centered Figma badge inside its exact captured text box', () => {
    const text = figmaToText(
      capturedText({
        characters: 'Recommended',
        width: 80,
        height: 14,
        fontSize: 10,
        lineHeightPx: 14,
        fontStyle: 'normal',
        textAlignHorizontal: 'CENTER',
        textAlignVertical: 'TOP',
        textDecoration: 'NONE',
        textAutoResize: 'WIDTH_AND_HEIGHT',
        layoutSizingHorizontal: 'HUG',
        layoutSizingVertical: 'HUG',
      }),
      {},
    )

    expect(text).toMatchObject({
      text: 'Recommended',
      size: { width: 80, height: 14 },
      textAlign: 'center',
      textAlignVertical: 'top',
      textCase: 'upper',
    })
  })
})
