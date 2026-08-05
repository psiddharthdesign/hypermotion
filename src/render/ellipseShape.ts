// SPDX-License-Identifier: Apache-2.0

import type { EllipseArc } from '@/scene/types'
import { normalizeEllipseArc } from '@/scene/ellipseArc'

/** CSS percentage radii scale independently on each axis, producing an ellipse. */
export const ELLIPSE_CSS_BORDER_RADIUS = '50%'

const TAU = Math.PI * 2
const FULL_SWEEP_EPSILON = 1e-6

export interface EllipseArcOverrides {
  arcStart?: number
  arcSweep?: number
  arcInnerRadius?: number
}

export interface EllipseArcGeometry {
  arc: EllipseArc
  centerX: number
  centerY: number
  outerRadiusX: number
  outerRadiusY: number
  innerRadiusX: number
  innerRadiusY: number
  startRadians: number
  endRadians: number
  full: boolean
  empty: boolean
}

type CanvasEllipsePathTarget = Pick<
  CanvasRenderingContext2D,
  'beginPath' | 'ellipse' | 'closePath' | 'moveTo' | 'lineTo'
>

export function resolveEllipseArc(
  arc: EllipseArc | null | undefined,
  overrides?: EllipseArcOverrides,
): EllipseArc {
  return normalizeEllipseArc({
    ...(arc ?? {}),
    ...(overrides?.arcStart !== undefined
      ? { startAngle: overrides.arcStart }
      : {}),
    ...(overrides?.arcSweep !== undefined
      ? { sweep: overrides.arcSweep }
      : {}),
    ...(overrides?.arcInnerRadius !== undefined
      ? { innerRadius: overrides.arcInnerRadius }
      : {}),
  })
}

export function isSolidFullEllipseArc(arc: EllipseArc): boolean {
  const normalized = normalizeEllipseArc(arc)
  return normalized.sweep >= 1 - FULL_SWEEP_EPSILON && normalized.innerRadius <= 0
}

export function ellipseArcGeometry(
  x: number,
  y: number,
  width: number,
  height: number,
  arc: EllipseArc,
  inset = 0,
): EllipseArcGeometry {
  const normalized = normalizeEllipseArc(arc)
  const baseRadiusX = Math.max(0, width / 2)
  const baseRadiusY = Math.max(0, height / 2)
  const outerRadiusX = Math.max(0, baseRadiusX - inset)
  const outerRadiusY = Math.max(0, baseRadiusY - inset)
  // Moving an inside-aligned stroke inward means its inner edge moves away
  // from the centre while its outer edge moves toward it.
  const innerRadiusX = Math.min(
    outerRadiusX,
    Math.max(0, baseRadiusX * normalized.innerRadius + inset),
  )
  const innerRadiusY = Math.min(
    outerRadiusY,
    Math.max(0, baseRadiusY * normalized.innerRadius + inset),
  )
  const startRadians = (normalized.startAngle * Math.PI) / 180
  const full = normalized.sweep >= 1 - FULL_SWEEP_EPSILON
  const empty =
    normalized.sweep <= FULL_SWEEP_EPSILON ||
    outerRadiusX <= 0 ||
    outerRadiusY <= 0 ||
    normalized.innerRadius >= 1 - FULL_SWEEP_EPSILON
  return {
    arc: normalized,
    centerX: x + width / 2,
    centerY: y + height / 2,
    outerRadiusX,
    outerRadiusY,
    innerRadiusX,
    innerRadiusY,
    startRadians,
    endRadians: startRadians + (full ? TAU : normalized.sweep * TAU),
    full,
    empty,
  }
}

function pointOnEllipse(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: centerX + Math.cos(angle) * radiusX,
    y: centerY + Math.sin(angle) * radiusY,
  }
}

/**
 * Trace a true editable ellipse arc inside a rectangle.
 *
 * The inner contour is wound in reverse so Canvas2D fill/clip operations
 * preserve a donut hole with their default non-zero winding rule.
 */
export function traceCanvasEllipseArc(
  ctx: CanvasEllipsePathTarget,
  x: number,
  y: number,
  width: number,
  height: number,
  arc: EllipseArc,
  inset = 0,
): void {
  const geometry = ellipseArcGeometry(x, y, width, height, arc, inset)
  ctx.beginPath()
  if (geometry.empty) return

  const outerStart = pointOnEllipse(
    geometry.centerX,
    geometry.centerY,
    geometry.outerRadiusX,
    geometry.outerRadiusY,
    geometry.startRadians,
  )
  const hasHole = geometry.arc.innerRadius > FULL_SWEEP_EPSILON

  // Preserve the established fast path (and its simple Canvas contract) for
  // the overwhelmingly common complete solid ellipse.
  if (geometry.full && !hasHole) {
    ctx.ellipse(
      geometry.centerX,
      geometry.centerY,
      geometry.outerRadiusX,
      geometry.outerRadiusY,
      0,
      0,
      TAU,
    )
    ctx.closePath()
    return
  }

  if (!hasHole && !geometry.full) {
    ctx.moveTo(geometry.centerX, geometry.centerY)
    ctx.lineTo(outerStart.x, outerStart.y)
  } else {
    ctx.moveTo(outerStart.x, outerStart.y)
  }
  ctx.ellipse(
    geometry.centerX,
    geometry.centerY,
    geometry.outerRadiusX,
    geometry.outerRadiusY,
    0,
    geometry.startRadians,
    geometry.endRadians,
    false,
  )

  if (hasHole) {
    const innerEnd = pointOnEllipse(
      geometry.centerX,
      geometry.centerY,
      geometry.innerRadiusX,
      geometry.innerRadiusY,
      geometry.endRadians,
    )
    // A complete donut has two closed contours. Starting the inner contour
    // separately avoids drawing a visible radial seam through its stroke.
    if (geometry.full) ctx.moveTo(innerEnd.x, innerEnd.y)
    else ctx.lineTo(innerEnd.x, innerEnd.y)
    ctx.ellipse(
      geometry.centerX,
      geometry.centerY,
      geometry.innerRadiusX,
      geometry.innerRadiusY,
      0,
      geometry.endRadians,
      geometry.startRadians,
      true,
    )
  }
  ctx.closePath()
}

/** Backward-compatible full-ellipse tracer used by older call sites/tests. */
export function traceCanvasEllipse(
  ctx: CanvasEllipsePathTarget,
  x: number,
  y: number,
  width: number,
  height: number,
  inset = 0,
): void {
  traceCanvasEllipseArc(
    ctx,
    x,
    y,
    width,
    height,
    { startAngle: -90, sweep: 1, innerRadius: 0 },
    inset,
  )
}

function svgNumber(value: number): string {
  const stable = Math.abs(value) < 1e-9 ? 0 : value
  return Number(stable.toFixed(5)).toString()
}

/** A renderer-neutral SVG path used by DOM preview and Pixi export. */
export function ellipseArcSvgPath(
  width: number,
  height: number,
  arc: EllipseArc,
  x = 0,
  y = 0,
  inset = 0,
): string {
  const geometry = ellipseArcGeometry(x, y, width, height, arc, inset)
  if (geometry.empty) return ''
  const n = svgNumber
  const outerStart = pointOnEllipse(
    geometry.centerX,
    geometry.centerY,
    geometry.outerRadiusX,
    geometry.outerRadiusY,
    geometry.startRadians,
  )
  const outerEnd = pointOnEllipse(
    geometry.centerX,
    geometry.centerY,
    geometry.outerRadiusX,
    geometry.outerRadiusY,
    geometry.endRadians,
  )
  const hasHole = geometry.arc.innerRadius > FULL_SWEEP_EPSILON
  const commands: string[] = []

  if (geometry.full) {
    const oppositeAngle = geometry.startRadians + Math.PI
    const outerOpposite = pointOnEllipse(
      geometry.centerX,
      geometry.centerY,
      geometry.outerRadiusX,
      geometry.outerRadiusY,
      oppositeAngle,
    )
    commands.push(
      `M ${n(outerStart.x)} ${n(outerStart.y)}`,
      `A ${n(geometry.outerRadiusX)} ${n(geometry.outerRadiusY)} 0 0 1 ${n(outerOpposite.x)} ${n(outerOpposite.y)}`,
      `A ${n(geometry.outerRadiusX)} ${n(geometry.outerRadiusY)} 0 0 1 ${n(outerStart.x)} ${n(outerStart.y)}`,
      'Z',
    )
    if (hasHole) {
      const innerStart = pointOnEllipse(
        geometry.centerX,
        geometry.centerY,
        geometry.innerRadiusX,
        geometry.innerRadiusY,
        geometry.startRadians,
      )
      const innerOpposite = pointOnEllipse(
        geometry.centerX,
        geometry.centerY,
        geometry.innerRadiusX,
        geometry.innerRadiusY,
        oppositeAngle,
      )
      commands.push(
        `M ${n(innerStart.x)} ${n(innerStart.y)}`,
        `A ${n(geometry.innerRadiusX)} ${n(geometry.innerRadiusY)} 0 0 0 ${n(innerOpposite.x)} ${n(innerOpposite.y)}`,
        `A ${n(geometry.innerRadiusX)} ${n(geometry.innerRadiusY)} 0 0 0 ${n(innerStart.x)} ${n(innerStart.y)}`,
        'Z',
      )
    }
    return commands.join(' ')
  }

  const largeArc = geometry.arc.sweep > 0.5 ? 1 : 0
  if (!hasHole) {
    commands.push(
      `M ${n(geometry.centerX)} ${n(geometry.centerY)}`,
      `L ${n(outerStart.x)} ${n(outerStart.y)}`,
      `A ${n(geometry.outerRadiusX)} ${n(geometry.outerRadiusY)} 0 ${largeArc} 1 ${n(outerEnd.x)} ${n(outerEnd.y)}`,
      'Z',
    )
    return commands.join(' ')
  }

  const innerStart = pointOnEllipse(
    geometry.centerX,
    geometry.centerY,
    geometry.innerRadiusX,
    geometry.innerRadiusY,
    geometry.startRadians,
  )
  const innerEnd = pointOnEllipse(
    geometry.centerX,
    geometry.centerY,
    geometry.innerRadiusX,
    geometry.innerRadiusY,
    geometry.endRadians,
  )
  commands.push(
    `M ${n(outerStart.x)} ${n(outerStart.y)}`,
    `A ${n(geometry.outerRadiusX)} ${n(geometry.outerRadiusY)} 0 ${largeArc} 1 ${n(outerEnd.x)} ${n(outerEnd.y)}`,
    `L ${n(innerEnd.x)} ${n(innerEnd.y)}`,
    `A ${n(geometry.innerRadiusX)} ${n(geometry.innerRadiusY)} 0 ${largeArc} 0 ${n(innerStart.x)} ${n(innerStart.y)}`,
    'Z',
  )
  return commands.join(' ')
}

/** CSS mask for painting any existing Fill through the shared arc geometry. */
export function ellipseArcMaskImage(
  width: number,
  height: number,
  arc: EllipseArc,
): string {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const path = ellipseArcSvgPath(safeWidth, safeHeight, arc)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${safeWidth} ${safeHeight}"><path d="${path}" fill="white" fill-rule="evenodd"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
