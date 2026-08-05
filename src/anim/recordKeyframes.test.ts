// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'

describe('recordKeyframes fill values', () => {
  it('stores a solid fill as an interpolatable color string', () => {
    expect(
      keyframeValuesForPatch('appearance', {
        fill: { kind: 'solid', color: 'oklch(0.62 0.21 250)' },
      }),
    ).toEqual([
      {
        propertyId: 'appearance.fill',
        value: 'oklch(0.62 0.21 250)',
      },
    ])
  })

  it('does not create a color track for non-solid fills', () => {
    expect(
      keyframeValuesForPatch('appearance', {
        fill: {
          kind: 'linear',
          angle: 90,
          stops: [
            { at: 0, color: '#000000' },
            { at: 1, color: '#ffffff' },
          ],
        },
      }),
    ).toEqual([])
  })
})

describe('recordKeyframes inspector coverage', () => {
  it('records discrete blend-mode edits', () => {
    expect(
      keyframeValuesForPatch('appearance', { blendMode: 'multiply' }),
    ).toEqual([
      {
        propertyId: 'appearance.blendMode',
        value: 'multiply',
      },
    ])
  })

  it('expands layout padding into four independently keyframeable values', () => {
    expect(
      keyframeValuesForPatch('layout', {
        direction: 'column',
        gap: 24,
        padding: { top: 8, right: 16, bottom: 24, left: 32 },
      }),
    ).toEqual([
      { propertyId: 'layout.direction', value: 'column' },
      { propertyId: 'layout.gap', value: 24 },
      { propertyId: 'layout.padding.top', value: 8 },
      { propertyId: 'layout.padding.right', value: 16 },
      { propertyId: 'layout.padding.bottom', value: 24 },
      { propertyId: 'layout.padding.left', value: 32 },
    ])
  })

  it('records all editable ellipse arc values', () => {
    expect(
      keyframeValuesForPatch('shape', {
        startAngle: -90,
        sweep: 0.804,
        innerRadius: 0.55,
      }),
    ).toEqual([
      { propertyId: 'shape.arcStart', value: -90 },
      { propertyId: 'shape.arcSweep', value: 0.804 },
      { propertyId: 'shape.arcInnerRadius', value: 0.55 },
    ])
  })
})
