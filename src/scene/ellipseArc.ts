// SPDX-License-Identifier: Apache-2.0

import type { EllipseArc } from './types'

/** A complete, solid ellipse. The start angle is visually inert at 100%. */
export const DEFAULT_ELLIPSE_ARC: Readonly<EllipseArc> = Object.freeze({
  startAngle: -90,
  sweep: 1,
  innerRadius: 0,
})

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback
}

/** Keep the authoring value compact without changing the represented ray. */
export function normalizeEllipseStartAngle(value: unknown): number {
  const angle = finiteNumber(value, DEFAULT_ELLIPSE_ARC.startAngle)
  const normalized = ((angle + 180) % 360 + 360) % 360 - 180
  if (Object.is(normalized, -0)) return 0
  // Keep the Inspector's positive endpoint stable instead of snapping a
  // scrubbed +180° value back to the visually equivalent -180° endpoint.
  return normalized === -180 && angle > 0 ? 180 : normalized
}

/**
 * Normalize persisted or imported ellipse geometry.
 *
 * `sweep` and `innerRadius` are ratios because the Inspector presents both as
 * percentages and chart-reveal animation naturally runs from 0 to 1.
 */
export function normalizeEllipseArc(value: unknown): EllipseArc {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<Record<keyof EllipseArc, unknown>>)
      : {}
  return {
    startAngle: normalizeEllipseStartAngle(source.startAngle),
    sweep: Math.max(
      0,
      Math.min(1, finiteNumber(source.sweep, DEFAULT_ELLIPSE_ARC.sweep)),
    ),
    innerRadius: Math.max(
      0,
      Math.min(
        1,
        finiteNumber(
          source.innerRadius,
          DEFAULT_ELLIPSE_ARC.innerRadius,
        ),
      ),
    ),
  }
}

/** Convert Figma's radian start/end representation to our editable model. */
export function ellipseArcFromRadians(
  startAngle: unknown,
  endAngle: unknown,
  innerRadius: unknown,
): EllipseArc {
  const start = finiteNumber(startAngle, -Math.PI / 2)
  const end = finiteNumber(endAngle, start + Math.PI * 2)
  const rawSweep = end - start
  const full = Math.abs(Math.abs(rawSweep) - Math.PI * 2) < 0.0001
  const positiveSweep = full
    ? Math.PI * 2
    : ((rawSweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return normalizeEllipseArc({
    startAngle: (start * 180) / Math.PI,
    sweep: positiveSweep / (Math.PI * 2),
    innerRadius,
  })
}
