// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  ELLIPSE_CSS_BORDER_RADIUS,
  ellipseArcSvgPath,
  ellipseArcGeometry,
  traceCanvasEllipseArc,
  traceCanvasEllipse,
} from './ellipseShape'

describe('ellipse shape geometry', () => {
  it('uses independent horizontal and vertical radii for a non-square ellipse', () => {
    const ctx = {
      beginPath: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
    }

    traceCanvasEllipse(
      ctx as unknown as CanvasRenderingContext2D,
      10,
      20,
      240,
      120,
    )

    expect(ctx.beginPath).toHaveBeenCalledOnce()
    expect(ctx.ellipse).toHaveBeenCalledWith(
      130,
      80,
      120,
      60,
      0,
      0,
      Math.PI * 2,
    )
    expect(ctx.closePath).toHaveBeenCalledOnce()
  })

  it('keeps an inset stroke concentric with the ellipse', () => {
    const ctx = {
      beginPath: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
    }

    traceCanvasEllipse(
      ctx as unknown as CanvasRenderingContext2D,
      0,
      0,
      100,
      60,
      4,
    )

    expect(ctx.ellipse).toHaveBeenCalledWith(
      50,
      30,
      46,
      26,
      0,
      0,
      Math.PI * 2,
    )
  })

  it('uses equal radii for a square, producing a true circle', () => {
    const ctx = {
      beginPath: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
    }

    traceCanvasEllipse(
      ctx as unknown as CanvasRenderingContext2D,
      12,
      8,
      80,
      80,
    )

    expect(ctx.ellipse).toHaveBeenCalledWith(
      52,
      48,
      40,
      40,
      0,
      0,
      Math.PI * 2,
    )
  })

  it('uses percentage CSS radii rather than a capsule-producing pixel radius', () => {
    expect(ELLIPSE_CSS_BORDER_RADIUS).toBe('50%')
  })

  it('builds the reference donut segment with proportional inner radii', () => {
    const arc = { startAngle: -90, sweep: 0.804, innerRadius: 0.55 }
    const geometry = ellipseArcGeometry(0, 0, 184, 184, arc)
    const path = ellipseArcSvgPath(184, 184, arc)

    expect(geometry.innerRadiusX).toBeCloseTo(50.6)
    expect(geometry.innerRadiusY).toBeCloseTo(50.6)
    expect(path).toContain('A 92 92 0 1 1')
    expect(path).toContain('A 50.6 50.6 0 1 0')
  })

  it('distinguishes an empty sweep from a complete ellipse', () => {
    expect(
      ellipseArcSvgPath(100, 60, {
        startAngle: -90,
        sweep: 0,
        innerRadius: 0,
      }),
    ).toBe('')
    const full = ellipseArcSvgPath(100, 60, {
      startAngle: -90,
      sweep: 1,
      innerRadius: 0,
    })
    expect((full.match(/ A /g) ?? []).length).toBe(2)
  })

  it('uses a centre-connected pie path and a reversed donut contour', () => {
    const pie = ellipseArcSvgPath(120, 80, {
      startAngle: 0,
      sweep: 0.25,
      innerRadius: 0,
    })
    const donut = ellipseArcSvgPath(120, 80, {
      startAngle: 0,
      sweep: 0.25,
      innerRadius: 0.5,
    })

    expect(pie).toMatch(/^M 60 40 L 120 40 A /)
    expect(donut).toMatch(/^M 120 40 A /)
    expect(donut).toContain(' 0 0 0 ')
  })

  it('traces a complete donut as separate contours without a radial seam', () => {
    const ctx = {
      beginPath: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
    }

    traceCanvasEllipseArc(
      ctx as unknown as CanvasRenderingContext2D,
      0,
      0,
      100,
      100,
      { startAngle: -90, sweep: 1, innerRadius: 0.5 },
    )

    expect(ctx.ellipse).toHaveBeenCalledTimes(2)
    expect(ctx.moveTo).toHaveBeenCalledTimes(2)
    expect(ctx.lineTo).not.toHaveBeenCalled()
  })
})
