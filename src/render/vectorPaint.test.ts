// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { VectorNode } from '@/scene/types'
import {
  createVectorItem,
  defaultVectorStroke,
  parseSvgPathData,
  solidVectorPaint,
} from '@/scene/vector'
import {
  vectorNodeInnerSvgMarkup,
  vectorTrimState,
} from './vectorPaint'

function node(): VectorNode {
  const geometry = parseSvgPathData(
    'M0 0 L40 0 L40 40 L0 40 Z M60 60 L100 60 L100 100 L60 100 Z',
    { idPrefix: 'regions' },
  )
  const [first, second] = geometry.contours
  geometry.regions = [
    {
      id: 'region-a',
      contourIds: [first!.id],
      fillRule: 'nonzero',
      fillIds: ['red'],
    },
    {
      id: 'region-b',
      contourIds: [second!.id],
      fillRule: 'evenodd',
      fillIds: ['blue'],
    },
  ]
  const red = solidVectorPaint('#ff0000', 'red')
  const blue = solidVectorPaint('#0000ff', 'blue')
  const stroke = defaultVectorStroke(solidVectorPaint('#111111', 'ink'), 'outline')
  return {
    id: 'vector-1',
    kind: 'vector',
    name: 'Vector',
    parent: null,
    children: [],
    transform: {
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    },
    appearance: {
      opacity: 1,
      fill: null,
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    visible: true,
    locked: false,
    position: 'absolute',
    zIndex: 0,
    isMask: false,
    size: { width: 100, height: 100 },
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
    vector: {
      version: 1,
      items: [
        createVectorItem({
          id: 'regions-item',
          geometry,
          fills: [red, blue],
          strokes: [stroke],
        }),
      ],
    },
    trimStart: 0,
    trimEnd: 1,
    trimOffset: 0,
    importFidelity: 'editable',
  }
}

describe('native vector SVG paint', () => {
  it('keeps region-specific fills on their assigned contours', () => {
    const markup = vectorNodeInnerSvgMarkup(node())
    const redPath = markup.match(/d="([^"]+)"[^>]+fill="#ff0000"/)?.[1]
    const bluePath = markup.match(/d="([^"]+)"[^>]+fill="#0000ff"/)?.[1]

    expect(redPath).toContain('M 0 0')
    expect(redPath).not.toContain('M 60 60')
    expect(bluePath).toContain('M 60 60')
    expect(bluePath).not.toContain('M 0 0')
  })

  it('serializes persisted trim as normalized path-length dash values', () => {
    const fixture = node()
    fixture.trimStart = 0.2
    fixture.trimEnd = 0.7
    fixture.trimOffset = 0.1
    const trim = vectorTrimState(fixture)
    const markup = vectorNodeInnerSvgMarkup(fixture, trim)

    expect(markup).toContain('pathLength="1"')
    expect(markup).toContain('stroke-dasharray="0.5 0.5"')
    expect(markup).toContain('stroke-dashoffset="-0.3"')
  })

  it('fully hides a zero-span trim instead of leaving a round-cap dot', () => {
    const markup = vectorNodeInnerSvgMarkup(node(), {
      start: 0,
      end: 0,
      offset: 0,
    })

    expect(markup).toContain('visibility="hidden"')
    expect(markup).not.toContain('stroke-dasharray="0.0001')
  })

  it('retains gradient transforms in generated SVG definitions', () => {
    const fixture = node()
    fixture.vector.items[0]!.fills = [
      {
        id: 'gradient',
        kind: 'linear',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
      transform: [1, 0.2, -0.1, 1, 8, 12],
      coordinateSpace: 'objectBoundingBox',
      spread: 'reflect',
        stops: [
          { at: 0, color: '#fff' },
          { at: 1, color: '#000' },
        ],
      },
    ]
    fixture.vector.items[0]!.geometry.regions = undefined

    expect(vectorNodeInnerSvgMarkup(fixture)).toContain(
      'gradientTransform="matrix(1 0.2 -0.1 1 8 12)"',
    )
    expect(vectorNodeInnerSvgMarkup(fixture)).toContain(
      'gradientUnits="objectBoundingBox" spreadMethod="reflect"',
    )
  })

  it('sorts a render-only copy of reversed source gradient stops', () => {
    const fixture = node()
    fixture.vector.items[0]!.fills = [{
      id: 'reversed',
      kind: 'linear',
      visible: true,
      opacity: 1,
      blendMode: 'multiply',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      stops: [
        { at: 1, color: '#000' },
        { at: 0, color: '#fff' },
      ],
    }]
    fixture.vector.items[0]!.geometry.regions = undefined

    const markup = vectorNodeInnerSvgMarkup(fixture)
    expect(markup.indexOf('offset="0"')).toBeLessThan(markup.indexOf('offset="1"'))
    expect(markup).toContain('style="mix-blend-mode:multiply"')
    // Source fidelity is untouched by render normalization.
    expect(fixture.vector.items[0]!.fills[0]!.kind === 'linear' &&
      fixture.vector.items[0]!.fills[0]!.stops[0]!.at).toBe(1)
  })
})
