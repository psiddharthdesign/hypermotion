// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'

vi.mock('@/ui/fonts/googleFonts', () => ({
  isGoogleFont: () => true,
}))
import { importFigmaPayload, parseFigmaPayload } from './walk'
import type { FigmaCapturedVector, FigmaPayload } from './types'
import {
  FIGMA_PAYLOAD_FORMAT,
  FIGMA_PAYLOAD_VECTOR_VERSION,
  FIGMA_PAYLOAD_VERSION,
} from './types'
import { figmaToVectorDocument, sanitizeFigmaSvg } from './vectorMap'

function capturedVector(
  overrides: Partial<FigmaCapturedVector> = {},
): FigmaCapturedVector {
  return {
    id: '12:34',
    name: 'Curve',
    type: 'VECTOR',
    sourceKind: 'VECTOR',
    visible: true,
    locked: false,
    opacity: 1,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    cornerRadius: [0, 0, 0, 0],
    fills: [],
    strokes: [],
    strokeWeight: 0,
    strokeAlign: 'CENTER',
    strokeDashes: [],
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"/>',
    viewBox: { x: 0, y: 0, width: 100, height: 80 },
    fidelity: 'editable',
    ...overrides,
  }
}

describe('Figma vector payload v2', () => {
  it('accepts legacy, vector, and current payload versions', () => {
    for (const version of [
      1,
      FIGMA_PAYLOAD_VECTOR_VERSION,
      FIGMA_PAYLOAD_VERSION,
    ] as const) {
      const payload: FigmaPayload = {
        format: FIGMA_PAYLOAD_FORMAT,
        version,
        nodes: [],
        assets: {},
      }
      expect(parseFigmaPayload(JSON.stringify(payload))?.version).toBe(version)
    }
  })

  it('promotes an editable v2 ellipse primitive to the native arc model', () => {
    const api = createSceneAPI()
    const payload: FigmaPayload = {
      format: FIGMA_PAYLOAD_FORMAT,
      version: FIGMA_PAYLOAD_VECTOR_VERSION,
      nodes: [
        capturedVector({
          sourceKind: 'ELLIPSE',
          primitive: {
            kind: 'ellipse',
            startAngle: -Math.PI / 2,
            endAngle: Math.PI / 2,
            innerRadius: 0.4,
          },
          fidelity: 'editable',
        }),
      ],
      assets: {},
    }

    const [createdId] = importFigmaPayload(payload, api, api.getRoot())
    const created = api.getNode(createdId)

    expect(created?.kind).toBe('ellipse')
    expect(created && created.kind === 'ellipse' ? created.arc : null).toEqual({
      startAngle: -90,
      sweep: 0.5,
      innerRadius: 0.4,
    })
  })

  it('preserves Figma network vertices and absolute cubic controls', () => {
    const mapped = figmaToVectorDocument(
      capturedVector({
        vectorNetwork: {
          vertices: [
            { x: 10, y: 20, handleMirroring: 'ANGLE_AND_LENGTH' },
            { x: 90, y: 60 },
          ],
          segments: [
            {
              start: 0,
              end: 1,
              tangentStart: { x: 12, y: -4 },
              tangentEnd: { x: -8, y: 6 },
            },
          ],
          regions: [],
        },
      }),
      {},
      2,
    )

    const item = mapped?.vector.items[0]
    expect(item?.geometry.points['point-0']).toMatchObject({
      x: 10,
      y: 20,
      handleMode: 'mirrored',
    })
    expect(item?.geometry.segments['segment-0']).toMatchObject({
      kind: 'cubic',
      controlStart: { x: 22, y: 16 },
      controlEnd: { x: 82, y: 66 },
    })
    expect(item?.geometry.contours[0]).toMatchObject({
      segmentIds: ['segment-0'],
      closed: false,
    })
  })

  it('stores the complete non-translation Figma affine on the vector item', () => {
    const mapped = figmaToVectorDocument(
      capturedVector({
        relativeTransform: [
          [-1, 0.4, 240],
          [0.2, 1.5, 96],
        ],
        vectorPaths: [
          { windingRule: 'NONZERO', data: 'M 0 0 L 10 0 L 10 10 Z' },
        ],
      }),
      {},
      2,
    )

    expect(mapped?.vector.items[0]?.transform).toEqual([
      -1,
      0.2,
      0.4,
      1.5,
      0,
      0,
    ])
  })

  it('uses the shared SVG path parser for relative, shorthand and arc commands', () => {
    const mapped = figmaToVectorDocument(
      capturedVector({
        vectorPaths: [
          {
            windingRule: 'NONZERO',
            data: 'M 0 0 c 10 0 10 20 20 20 s 10 -20 20 -20 a 10 10 0 0 1 20 0',
          },
        ],
      }),
      {},
      2,
    )

    const geometry = mapped?.vector.items[0]?.geometry
    expect(geometry?.contours).toHaveLength(1)
    expect(Object.values(geometry?.segments ?? {}).every((segment) => segment.kind === 'cubic')).toBe(true)
    expect(Object.keys(geometry?.segments ?? {}).length).toBeGreaterThan(3)
  })

  it('keeps vector-network region paint stacks scoped to their regions', () => {
    const mapped = figmaToVectorDocument(
      capturedVector({
        fills: [
          {
            type: 'SOLID',
            color: { r: 1, g: 0, b: 0 },
            opacity: 1,
            visible: true,
          },
        ],
        vectorNetwork: {
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 80 },
          ],
          segments: [
            { start: 0, end: 1 },
            { start: 1, end: 2 },
            { start: 2, end: 0 },
          ],
          regions: [
            {
              windingRule: 'NONZERO',
              loops: [[0, 1, 2]],
              fillStyleId: 'S:green',
              fills: [
                {
                  type: 'SOLID',
                  color: { r: 0, g: 1, b: 0 },
                  opacity: 0.8,
                  visible: true,
                },
              ],
            },
          ],
        },
      }),
      {},
      2,
    )

    const item = mapped?.vector.items[0]
    expect(item?.fills).toHaveLength(2)
    expect(item?.geometry.regions?.[0]?.fillIds).toEqual([
      'region-0-fill-1',
    ])
    expect(item?.fills[1]).toMatchObject({
      id: 'region-0-fill-1',
      kind: 'solid',
      color: '#00ff00',
      opacity: 0.8,
    })
  })

  it('keeps multiple fills, reversed stops and complete stroke style', () => {
    const mapped = figmaToVectorDocument(
      capturedVector({
        vectorPaths: [{ windingRule: 'EVENODD', data: 'M 0 0 L 100 0 L 100 80 Z' }],
        fills: [
          {
            type: 'SOLID',
            color: { r: 1, g: 0, b: 0 },
            opacity: 0.75,
            visible: true,
          },
          {
            type: 'GRADIENT_LINEAR',
            gradientHandlePositions: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
            ],
            gradientTransform: [
              [1, 0, 0],
              [0, 1, 0],
            ],
            gradientStops: [
              { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
              { position: 0, color: { r: 0, g: 1, b: 0, a: 0.5 } },
            ],
            opacity: 1,
            visible: true,
          },
        ],
        strokes: [
          {
            type: 'SOLID',
            color: { r: 0, g: 0, b: 0 },
            opacity: 1,
            visible: true,
          },
        ],
        strokeWeight: 4,
        strokeAlign: 'OUTSIDE',
        strokeDashes: [8, 3, 2, 3],
        strokeDashOffset: 5,
        strokeCap: 'ROUND',
        strokeJoin: 'BEVEL',
        strokeMiterLimit: 9,
      }),
      {},
      2,
    )

    const item = mapped?.vector.items[0]
    expect(item?.fills).toHaveLength(2)
    expect(item?.fills[1]).toMatchObject({
      kind: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      transform: [100, 0, 0, 80, 0, 0],
      stops: [{ at: 1 }, { at: 0 }],
    })
    expect(item?.strokes[0]).toMatchObject({
      width: 4,
      align: 'outside',
      cap: 'round',
      join: 'bevel',
      miterLimit: 9,
      dash: [8, 3, 2, 3],
      dashOffset: 5,
    })
  })

  it('removes active and external SVG content from the fallback', () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" onclick="bad()"><script>bad()</script><path d="M0 0L1 1"/><image href="https://evil.test/a.png"/></svg>'
    const sanitized = sanitizeFigmaSvg(source)
    expect(sanitized).not.toMatch(/<script|onclick|https:\/\/evil/i)
    expect(sanitized).toContain('<path')
  })

  it('never returns a preserved vector with an empty render document', () => {
    const mapped = figmaToVectorDocument(
      capturedVector({
        fidelity: 'preserved',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="#shape"/></svg>',
        vectorPaths: [],
        vectorNetwork: undefined,
        fillGeometry: [],
        strokeGeometry: [],
      }),
      {},
      2,
    )

    // null tells the walker to create a sanitized inline-SVG image fallback.
    expect(mapped).toBeNull()
  })

  it('imports a partial vector through its SVG fidelity fallback', () => {
    const api = createSceneAPI()
    const vector = capturedVector({
      fidelity: 'partial',
      unsupported: ['non-center-stroke'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><path d="M0 0h100v80H0z"/></svg>',
      vectorPaths: [
        { windingRule: 'NONZERO', data: 'M 0 0 H 100 V 80 H 0 Z' },
      ],
    })
    const payload: FigmaPayload = {
      format: FIGMA_PAYLOAD_FORMAT,
      version: FIGMA_PAYLOAD_VERSION,
      nodes: [vector],
      assets: {},
    }

    const [createdId] = importFigmaPayload(payload, api, api.getRoot())
    const created = api.getNode(createdId)

    expect(created?.kind).toBe('image')
    expect(created && 'src' in created ? created.src : '').toContain(
      'data:image/svg+xml',
    )
  })
})
