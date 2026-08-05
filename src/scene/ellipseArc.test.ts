// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from './doc'
import {
  DEFAULT_ELLIPSE_ARC,
  ellipseArcFromRadians,
  normalizeEllipseArc,
} from './ellipseArc'

describe('ellipse arc model', () => {
  it('normalizes legacy and invalid values to a complete solid ellipse', () => {
    expect(normalizeEllipseArc(undefined)).toEqual(DEFAULT_ELLIPSE_ARC)
    expect(
      normalizeEllipseArc({
        startAngle: Number.NaN,
        sweep: Number.POSITIVE_INFINITY,
        innerRadius: Number.NaN,
      }),
    ).toEqual(DEFAULT_ELLIPSE_ARC)
  })

  it('clamps ratios and stabilizes angles', () => {
    expect(
      normalizeEllipseArc({ startAngle: 270, sweep: 2, innerRadius: -1 }),
    ).toEqual({ startAngle: -90, sweep: 1, innerRadius: 0 })
    expect(
      normalizeEllipseArc({ startAngle: 180, sweep: 1, innerRadius: 0 }),
    ).toEqual({ startAngle: 180, sweep: 1, innerRadius: 0 })
  })

  it('converts the Figma reference from radians', () => {
    const arc = ellipseArcFromRadians(
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * 0.804,
      0.55,
    )
    expect(arc.startAngle).toBeCloseTo(-90)
    expect(arc.sweep).toBeCloseTo(0.804)
    expect(arc.innerRadius).toBeCloseTo(0.55)
  })

  it('hydrates defaults and persists edits through the scene API', () => {
    const api = createSceneAPI()
    const id = api.createNode('ellipse', api.getRoot(), {})
    expect(api.getNode(id)).toMatchObject({
      kind: 'ellipse',
      arc: DEFAULT_ELLIPSE_ARC,
    })

    api.setNodeProperty(id, 'arc', {
      startAngle: -90,
      sweep: 0.804,
      innerRadius: 0.55,
    })
    expect(api.getNode(id)).toMatchObject({
      arc: { startAngle: -90, sweep: 0.804, innerRadius: 0.55 },
    })
  })
})
