// SPDX-License-Identifier: Apache-2.0

import type {
  VectorContour,
  VectorGeometry,
  VectorItem,
  VectorNode,
  VectorPaint,
  VectorPosition,
} from '@/scene'

export interface VectorTrimState {
  start: number
  end: number
  offset: number
}

/** Resolve the vector layer's persisted trim fields. */
export function vectorTrimState(node: VectorNode): VectorTrimState {
  return {
    start: node.trimStart ?? 0,
    end: node.trimEnd ?? 1,
    offset: node.trimOffset ?? 0,
  }
}

export function vectorContourPathData(
  geometry: VectorGeometry,
  contour: VectorContour,
): string {
  let currentId: string | null = null
  const commands: string[] = []

  for (const segmentId of contour.segmentIds) {
    const segment = geometry.segments[segmentId]
    if (!segment) continue
    const forward: boolean = currentId !== segment.endPointId
    const startId: string = forward ? segment.startPointId : segment.endPointId
    const endId: string = forward ? segment.endPointId : segment.startPointId
    const start = geometry.points[startId]
    const end = geometry.points[endId]
    if (!start || !end) continue

    if (currentId !== startId) {
      commands.push(`M ${fmt(start.x)} ${fmt(start.y)}`)
    }
    if (segment.kind === 'cubic') {
      const c1 = forward ? segment.controlStart : segment.controlEnd
      const c2 = forward ? segment.controlEnd : segment.controlStart
      commands.push(
        `C ${fmt(c1?.x ?? start.x)} ${fmt(c1?.y ?? start.y)} ${fmt(c2?.x ?? end.x)} ${fmt(c2?.y ?? end.y)} ${fmt(end.x)} ${fmt(end.y)}`,
      )
    } else {
      commands.push(`L ${fmt(end.x)} ${fmt(end.y)}`)
    }
    currentId = endId
  }

  if (contour.closed && commands.length > 0) commands.push('Z')
  return commands.join(' ')
}

export function vectorItemPathData(item: VectorItem): string {
  return item.geometry.contours
    .map((contour) => vectorContourPathData(item.geometry, contour))
    .filter(Boolean)
    .join(' ')
}

/**
 * Generate inert SVG markup from the canonical vector model. This function
 * never includes source SVG or arbitrary attributes, so callers can safely
 * place the result in `dangerouslySetInnerHTML` without reintroducing scripts
 * stripped by the importer.
 */
export function vectorNodeInnerSvgMarkup(
  node: VectorNode,
  trim: VectorTrimState = vectorTrimState(node),
): string {
  const defs: string[] = []
  const body: string[] = []
  const idPrefix = `hm-${safeId(node.id)}`
  const trimAttributes = svgTrimAttributes(trim)

  node.vector.items.forEach((item, itemIndex) => {
    if (!item.visible) return
    const d = vectorItemPathData(item)
    if (!d) return
    const itemPaths: string[] = []

    for (const [paintIndex, paint] of item.fills.entries()) {
      if (!paint.visible) continue
      const paintValue = svgPaintValue(
        paint,
        `${idPrefix}-${itemIndex}-fill-${paintIndex}`,
        defs,
      )
      for (const fillPath of vectorFillPaths(item, paint.id)) {
        itemPaths.push(
          `<path d="${escapeAttr(fillPath.d)}" fill="${paintValue}" fill-rule="${fillPath.fillRule}" fill-opacity="${fmt(clamp01(paint.opacity))}"${svgBlendStyle(paint.blendMode)}${trimIsFull(trim) ? '' : ' visibility="hidden"'}/>`,
        )
      }
    }

    for (const [strokeIndex, stroke] of item.strokes.entries()) {
      if (!stroke.visible || stroke.width <= 0 || !stroke.paint.visible) continue
      const paintValue = svgPaintValue(
        stroke.paint,
        `${idPrefix}-${itemIndex}-stroke-${strokeIndex}`,
        defs,
      )
      const authoredDash = stroke.dash.length
        ? ` stroke-dasharray="${stroke.dash.map(fmt).join(' ')}" stroke-dashoffset="${fmt(stroke.dashOffset)}"`
        : ''
      itemPaths.push(
        `<path d="${escapeAttr(d)}" fill="none" stroke="${paintValue}" stroke-width="${fmt(stroke.width)}" stroke-linecap="${stroke.cap}" stroke-linejoin="${stroke.join}" stroke-miterlimit="${fmt(stroke.miterLimit)}" stroke-opacity="${fmt(clamp01(stroke.opacity * stroke.paint.opacity))}" pathLength="1"${svgBlendStyle(stroke.paint.blendMode)}${trimAttributes || authoredDash}/>` ,
      )
    }

    if (itemPaths.length > 0) {
      body.push(
        `<g transform="matrix(${item.transform.map(fmt).join(' ')})" opacity="${fmt(clamp01(item.opacity))}"${svgBlendStyle(item.blendMode)}>${itemPaths.join('')}</g>`,
      )
    }
  })

  return `${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}`
}

export function vectorNodeSvgMarkup(
  node: VectorNode,
  width: number,
  height: number,
  trim: VectorTrimState = vectorTrimState(node),
): string {
  const vb = node.viewBox
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" viewBox="${fmt(vb.x)} ${fmt(vb.y)} ${fmt(Math.max(0.0001, vb.width))} ${fmt(Math.max(0.0001, vb.height))}" preserveAspectRatio="none">${vectorNodeInnerSvgMarkup(node, trim)}</svg>`
}

/** Paint a native vector synchronously into the Canvas2D render/export path. */
export function paintVectorNodeToCanvas(
  ctx: CanvasRenderingContext2D,
  node: VectorNode,
  width: number,
  height: number,
  trim: VectorTrimState = vectorTrimState(node),
): void {
  const vb = node.viewBox
  const sx = width / Math.max(0.0001, vb.width)
  const sy = height / Math.max(0.0001, vb.height)
  ctx.save()
  ctx.scale(sx, sy)
  ctx.translate(-vb.x, -vb.y)

  for (const item of node.vector.items) {
    if (!item.visible) continue
    const d = vectorItemPathData(item)
    if (!d) continue
    let path: Path2D
    try {
      path = new Path2D(d)
    } catch {
      continue
    }
    ctx.save()
    ctx.transform(...item.transform)
    ctx.globalAlpha *= clamp01(item.opacity)
    ctx.globalCompositeOperation = canvasBlendMode(item.blendMode)
    const paintBounds = vectorItemPaintBounds(item)

    if (trimIsFull(trim)) {
      for (const paint of item.fills) {
        if (!paint.visible) continue
        ctx.save()
        ctx.globalAlpha *= clamp01(paint.opacity)
        if (paint.blendMode !== 'normal') {
          ctx.globalCompositeOperation = canvasBlendMode(paint.blendMode)
        }
        const fillStyle = canvasPaint(ctx, paint, paintBounds)
        if (fillStyle) {
          ctx.fillStyle = fillStyle
          for (const fillPath of vectorFillPaths(item, paint.id)) {
            try {
              ctx.fill(new Path2D(fillPath.d), fillPath.fillRule)
            } catch {
              // Continue painting other valid regions from this item.
            }
          }
        }
        ctx.restore()
      }
    }

    const length = Math.max(0.001, vectorItemApproximateLength(item))
    for (const stroke of item.strokes) {
      if (!stroke.visible || stroke.width <= 0 || !stroke.paint.visible) continue
      if (!trimIsFull(trim) && trimIsEmpty(trim)) continue
      const strokeStyle = canvasPaint(ctx, stroke.paint, paintBounds)
      if (!strokeStyle) continue
      ctx.save()
      ctx.globalAlpha *= clamp01(stroke.opacity * stroke.paint.opacity)
      if (stroke.paint.blendMode !== 'normal') {
        ctx.globalCompositeOperation = canvasBlendMode(stroke.paint.blendMode)
      }
      ctx.strokeStyle = strokeStyle
      ctx.lineWidth = stroke.width
      ctx.lineCap = stroke.cap
      ctx.lineJoin = stroke.join
      ctx.miterLimit = stroke.miterLimit
      if (trimIsFull(trim)) {
        ctx.setLineDash(stroke.dash)
        ctx.lineDashOffset = stroke.dashOffset
      } else {
        const interval = normalizedTrimInterval(trim)
        ctx.setLineDash([
          Math.max(0.0001, interval.span * length),
          Math.max(0.0001, (1 - interval.span) * length),
        ])
        ctx.lineDashOffset = -interval.start * length
      }
      ctx.stroke(path)
      ctx.restore()
    }
    ctx.restore()
  }
  ctx.restore()
}

export function vectorItemApproximateLength(item: VectorItem): number {
  let total = 0
  for (const contour of item.geometry.contours) {
    for (const segmentId of contour.segmentIds) {
      const segment = item.geometry.segments[segmentId]
      if (!segment) continue
      const p0 = item.geometry.points[segment.startPointId]
      const p3 = item.geometry.points[segment.endPointId]
      if (!p0 || !p3) continue
      if (segment.kind === 'line') {
        total += distance(p0, p3)
        continue
      }
      const p1 = segment.controlStart ?? p0
      const p2 = segment.controlEnd ?? p3
      let previous: VectorPosition = p0
      for (let step = 1; step <= 16; step++) {
        const current = cubicPoint(p0, p1, p2, p3, step / 16)
        total += distance(previous, current)
        previous = current
      }
    }
  }
  return total
}

function svgPaintValue(paint: VectorPaint, id: string, defs: string[]): string {
  if (paint.kind === 'solid') return escapeAttr(paint.color)
  if (paint.kind === 'image') return 'transparent'
  const safe = safeId(id)
  const gradientUnits = paint.coordinateSpace ?? 'userSpaceOnUse'
  const spreadMethod = paint.spread ?? 'pad'
  const paintTransform = paint.transform
    ? ` gradientTransform="matrix(${paint.transform.map(fmt).join(' ')})"`
    : ''
  const stops = paint.stops
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => a.stop.at - b.stop.at || a.index - b.index)
    .map(
      ({ stop }) =>
        `<stop offset="${fmt(clamp01(stop.at))}" stop-color="${escapeAttr(stop.color)}"/>`,
    )
    .join('')
  if (paint.kind === 'linear') {
    defs.push(
      `<linearGradient id="${safe}" gradientUnits="${gradientUnits}" spreadMethod="${spreadMethod}" x1="${fmt(paint.start.x)}" y1="${fmt(paint.start.y)}" x2="${fmt(paint.end.x)}" y2="${fmt(paint.end.y)}"${paintTransform}>${stops}</linearGradient>`,
    )
    return `url(#${safe})`
  }
  if (paint.kind === 'radial') {
    const ratio = paint.radiusX > 0 ? paint.radiusY / paint.radiusX : 1
    defs.push(
      `<radialGradient id="${safe}" gradientUnits="${gradientUnits}" spreadMethod="${spreadMethod}" cx="${fmt(paint.center.x)}" cy="${fmt(paint.center.y)}" r="${fmt(Math.max(0.0001, paint.radiusX))}" gradientTransform="${paint.transform ? `matrix(${paint.transform.map(fmt).join(' ')}) ` : ''}rotate(${fmt(paint.rotation)} ${fmt(paint.center.x)} ${fmt(paint.center.y)}) translate(${fmt(paint.center.x)} ${fmt(paint.center.y)}) scale(1 ${fmt(ratio)}) translate(${fmt(-paint.center.x)} ${fmt(-paint.center.y)})">${stops}</radialGradient>`,
    )
    return `url(#${safe})`
  }
  // SVG has no native conic gradient. Preserve a stable visual rather than
  // silently dropping the paint; the importer keeps the exact paint model for
  // the GPU renderer and future SVG2 support.
  return escapeAttr(paint.stops[0]?.color ?? 'transparent')
}

function canvasPaint(
  ctx: CanvasRenderingContext2D,
  paint: VectorPaint,
  bounds: { x: number; y: number; width: number; height: number },
): string | CanvasGradient | CanvasPattern | null {
  if (paint.kind === 'solid') return paint.color
  if (paint.kind === 'image') return null
  let gradient: CanvasGradient
  if (paint.kind === 'linear') {
    ctx.save()
    applyPaintCoordinateSpace(ctx, paint, bounds)
    if (paint.transform) ctx.transform(...paint.transform)
    gradient = ctx.createLinearGradient(
      paint.start.x,
      paint.start.y,
      paint.end.x,
      paint.end.y,
    )
    ctx.restore()
  } else if (paint.kind === 'radial') {
    // Canvas radial gradients are circular in their own coordinate system.
    // Author the gradient while a temporary transform represents the imported
    // paint matrix + ellipse ratio + rotation; the CanvasGradient captures that
    // coordinate system and remains valid after restore(). This matches the DOM
    // SVG radialGradient instead of inflating every ellipse to a large circle.
    ctx.save()
    applyPaintCoordinateSpace(ctx, paint, bounds)
    if (paint.transform) ctx.transform(...paint.transform)
    ctx.translate(paint.center.x, paint.center.y)
    ctx.rotate((paint.rotation * Math.PI) / 180)
    ctx.scale(1, paint.radiusX > 0 ? paint.radiusY / paint.radiusX : 1)
    gradient = ctx.createRadialGradient(
      0,
      0,
      0,
      0,
      0,
      Math.max(0.0001, paint.radiusX),
    )
    ctx.restore()
  } else {
    const createConic = (
      ctx as CanvasRenderingContext2D & {
        createConicGradient?: (angle: number, x: number, y: number) => CanvasGradient
      }
    ).createConicGradient
    if (!createConic) return paint.stops[0]?.color ?? null
    ctx.save()
    applyPaintCoordinateSpace(ctx, paint, bounds)
    if (paint.transform) ctx.transform(...paint.transform)
    gradient = createConic.call(
      ctx,
      (paint.angle * Math.PI) / 180,
      paint.center.x,
      paint.center.y,
    )
    ctx.restore()
  }
  for (const stop of paint.stops) {
    try {
      gradient.addColorStop(clamp01(stop.at), stop.color)
    } catch {
      // Invalid imported color: omit only that stop.
    }
  }
  return gradient
}

function svgTrimAttributes(trim: VectorTrimState): string {
  if (trimIsFull(trim)) return ''
  const interval = normalizedTrimInterval(trim)
  if (interval.span <= 1e-8) return ' visibility="hidden"'
  return ` stroke-dasharray="${fmt(interval.span)} ${fmt(Math.max(0.0001, 1 - interval.span))}" stroke-dashoffset="${fmt(-interval.start)}"`
}

function normalizedTrimInterval(trim: VectorTrimState): { start: number; span: number } {
  const rawSpan = trim.end - trim.start
  const span = Math.abs(rawSpan) >= 1
    ? 1
    : rawSpan >= 0
      ? rawSpan
      : 1 + rawSpan
  return {
    start: modulo1(trim.start + trim.offset),
    span: Math.max(0, Math.min(1, span)),
  }
}

function trimIsEmpty(trim: VectorTrimState): boolean {
  return normalizedTrimInterval(trim).span <= 1e-8
}

function trimIsFull(trim: VectorTrimState): boolean {
  return Math.abs(trim.end - trim.start) >= 0.999999
}

function fillRuleForItem(item: VectorItem): CanvasFillRule {
  return item.geometry.contours.some((contour) => contour.fillRule === 'evenodd')
    ? 'evenodd'
    : 'nonzero'
}

function vectorFillPaths(
  item: VectorItem,
  paintId: string,
): Array<{ d: string; fillRule: CanvasFillRule }> {
  const regions = item.geometry.regions ?? []
  if (regions.length === 0) {
    const d = vectorItemPathData(item)
    return d ? [{ d, fillRule: fillRuleForItem(item) }] : []
  }
  const contourById = new Map(
    item.geometry.contours.map((contour) => [contour.id, contour]),
  )
  return regions.flatMap((region) => {
    if (region.fillIds?.length && !region.fillIds.includes(paintId)) return []
    const d = region.contourIds
      .map((id) => contourById.get(id))
      .filter((contour): contour is VectorContour => !!contour)
      .map((contour) => vectorContourPathData(item.geometry, contour))
      .filter(Boolean)
      .join(' ')
    return d ? [{ d, fillRule: region.fillRule }] : []
  })
}

function vectorItemPaintBounds(item: VectorItem): {
  x: number
  y: number
  width: number
  height: number
} {
  const positions: VectorPosition[] = [
    ...Object.values(item.geometry.points),
    ...Object.values(item.geometry.segments).flatMap((segment) => [
      ...(segment.controlStart ? [segment.controlStart] : []),
      ...(segment.controlEnd ? [segment.controlEnd] : []),
    ]),
  ]
  if (positions.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  const xs = positions.map((position) => position.x)
  const ys = positions.map((position) => position.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(0.0001, Math.max(...xs) - x),
    height: Math.max(0.0001, Math.max(...ys) - y),
  }
}

function applyPaintCoordinateSpace(
  ctx: CanvasRenderingContext2D,
  paint: VectorPaint,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  if (paint.coordinateSpace !== 'objectBoundingBox') return
  ctx.translate(bounds.x, bounds.y)
  ctx.scale(bounds.width, bounds.height)
}

function canvasBlendMode(value: VectorItem['blendMode']): GlobalCompositeOperation {
  return value === 'normal' ? 'source-over' : value
}

function svgBlendStyle(value: VectorItem['blendMode']): string {
  return value === 'normal'
    ? ''
    : ` style="mix-blend-mode:${escapeAttr(value)}"`
}

function cubicPoint(
  p0: VectorPosition,
  p1: VectorPosition,
  p2: VectorPosition,
  p3: VectorPosition,
  t: number,
): VectorPosition {
  const mt = 1 - t
  return {
    x:
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x,
    y:
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y,
  }
}

function distance(a: VectorPosition, b: VectorPosition): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function modulo1(value: number): number {
  const next = value % 1
  return next < 0 ? next + 1 : next
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 10000) / 10000)
}
