// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'
import { defaultArrangement } from '@/scene/arrangement'

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

  it('records bend geometry controls as independent tracks', () => {
    expect(
      keyframeValuesForPatch('deformation', {
        angle: 90,
        factor: 0.75,
        captureDirectionX: 1,
        captureOriginY: 24,
        captureLength: 480,
        lightAzimuth: 135,
        roughness: 0.6,
      }),
    ).toEqual([
      { propertyId: 'deformation.bend.angle', value: 90 },
      { propertyId: 'deformation.bend.factor', value: 0.75 },
      { propertyId: 'deformation.bend.captureDirectionX', value: 1 },
      { propertyId: 'deformation.bend.captureOriginY', value: 24 },
      { propertyId: 'deformation.bend.captureLength', value: 480 },
      { propertyId: 'deformation.bend.lightAzimuth', value: 135 },
      { propertyId: 'deformation.bend.roughness', value: 0.6 },
    ])
  })
})


describe('recordKeyframes arrangement coverage', () => {
  it('records numeric, facing and path edits while keeping membership static', () => {
    const path = defaultArrangement('path').path
    expect(keyframeValuesForPatch('arrangement', {
      orbit: 180, radius: 320, rotationX: 60, orientation: 'screen',
      path, memberIds: ['card'], version: 1,
    })).toEqual([
      { propertyId: 'arrangement.orbit', value: 180 },
      { propertyId: 'arrangement.radius', value: 320 },
      { propertyId: 'arrangement.rotationX', value: 60 },
      { propertyId: 'arrangement.orientation', value: 'screen' },
      { propertyId: 'arrangement.path', value: path },
    ])
  })
})
