// SPDX-License-Identifier: Apache-2.0

import type {
  GradientStop,
  VectorDocument,
  VectorGeometry,
  VectorHandleMode,
  VectorItem,
  VectorNode,
  VectorPaint,
  VectorPoint,
  VectorPosition,
  VectorSegment,
  VectorStroke,
} from '@/scene/types'
import { lerpOklchStrings } from '@/anim/color'
import { createVectorItem, defaultVectorStroke, emptyVectorDocument } from './model'

export function isEditableVectorNode(
  node: { kind: string } | null | undefined,
): node is VectorNode {
  return (
    !!node &&
    node.kind === 'vector' &&
    (node as VectorNode).importFidelity === 'editable'
  )
}

export function cloneVectorDocument(
  vector: VectorDocument | undefined | null,
): VectorDocument {
  if (!vector) return emptyVectorDocument()
  return structuredClone(vector)
}

/** First visible fill of any kind — solid or gradient. */
export function primaryVectorFill(
  vector: VectorDocument | undefined | null,
): VectorPaint | null {
  return vector?.items[0]?.fills.find((paint) => paint.visible) ?? null
}

/** @deprecated color-only convenience over {@link primaryVectorFill}; solid fills only. */
export function primaryVectorFillColor(
  vector: VectorDocument | undefined | null,
): string | null {
  const fill = primaryVectorFill(vector)
  return fill?.kind === 'solid' ? fill.color : null
}

/**
 * Replace the item's primary (first visible) fill with `paint` — any kind,
 * solid or gradient. Reuses the existing fill's `id` when replacing one in
 * place so a track/keyframe referencing it stays stable; otherwise prepends
 * `paint` with its own id.
 */
export function applyVectorFill(
  vector: VectorDocument,
  paint: VectorPaint,
): VectorDocument {
  const next = cloneVectorDocument(vector)
  const item = next.items[0]
  if (!item) return next
  const index = item.fills.findIndex((candidate) => candidate.visible)
  if (index >= 0) {
    item.fills[index] = { ...paint, id: item.fills[index]!.id }
    return next
  }
  item.fills = [{ ...paint }, ...item.fills]
  return next
}

/** The item's primary (first) stroke, or null if it has none. */
export function primaryVectorStroke(
  vector: VectorDocument | undefined | null,
): VectorStroke | null {
  return vector?.items[0]?.strokes[0] ?? null
}

/**
 * Replace the item's primary (first) stroke with `stroke`. Reuses the
 * existing stroke's `id` when replacing one in place so a track/keyframe
 * referencing it stays stable; otherwise prepends `stroke` with its own id.
 */
export function applyVectorStroke(
  vector: VectorDocument,
  stroke: VectorStroke,
): VectorDocument {
  const next = cloneVectorDocument(vector)
  const item = next.items[0]
  if (!item) return next
  if (item.strokes.length > 0) {
    item.strokes[0] = { ...stroke, id: item.strokes[0]!.id }
    return next
  }
  item.strokes = [{ ...stroke }]
  return next
}

export type VectorEditPart =
  | { kind: 'anchor'; itemId: string; pointId: string }
  | {
      kind: 'handle'
      itemId: string
      segmentId: string
      which: 'start' | 'end'
    }

export function vectorViewBoxToLocal(
  viewBox: VectorNode['viewBox'],
  size: { width: number; height: number },
  point: VectorPosition,
): VectorPosition {
  return {
    x:
      ((point.x - viewBox.x) / Math.max(0.0001, viewBox.width)) * size.width,
    y:
      ((point.y - viewBox.y) / Math.max(0.0001, viewBox.height)) *
      size.height,
  }
}

export function vectorLocalToViewBox(
  viewBox: VectorNode['viewBox'],
  size: { width: number; height: number },
  local: VectorPosition,
): VectorPosition {
  return {
    x:
      viewBox.x +
      (local.x / Math.max(0.0001, size.width)) * viewBox.width,
    y:
      viewBox.y +
      (local.y / Math.max(0.0001, size.height)) * viewBox.height,
  }
}

export function moveVectorAnchor(
  vector: VectorDocument,
  itemId: string,
  pointId: string,
  next: VectorPosition,
): VectorDocument {
  const nextDoc = cloneVectorDocument(vector)
  const item = nextDoc.items.find((candidate) => candidate.id === itemId)
  if (!item) return nextDoc
  const point = item.geometry.points[pointId]
  if (!point) return nextDoc
  const dx = next.x - point.x
  const dy = next.y - point.y
  item.geometry.points[pointId] = { ...point, x: next.x, y: next.y }
  for (const segment of Object.values(item.geometry.segments)) {
    if (segment.startPointId === pointId && segment.controlStart) {
      segment.controlStart = {
        x: segment.controlStart.x + dx,
        y: segment.controlStart.y + dy,
      }
    }
    if (segment.endPointId === pointId && segment.controlEnd) {
      segment.controlEnd = {
        x: segment.controlEnd.x + dx,
        y: segment.controlEnd.y + dy,
      }
    }
  }
  return nextDoc
}

export function moveVectorHandle(
  vector: VectorDocument,
  itemId: string,
  segmentId: string,
  which: 'start' | 'end',
  next: VectorPosition,
  handleMode: VectorHandleMode = 'independent',
): VectorDocument {
  const nextDoc = cloneVectorDocument(vector)
  const item = nextDoc.items.find((candidate) => candidate.id === itemId)
  if (!item) return nextDoc
  const segment = item.geometry.segments[segmentId]
  if (!segment) return nextDoc
  ensureCubicSegment(item.geometry, segment)
  if (which === 'start') segment.controlStart = { ...next }
  else segment.controlEnd = { ...next }

  const anchorId = which === 'start' ? segment.startPointId : segment.endPointId
  const anchor = item.geometry.points[anchorId]
  if (!anchor || handleMode === 'independent') return nextDoc

  const opposite = findOppositeHandle(item, segmentId, anchorId, which)
  if (!opposite) return nextDoc
  const oppositeSegment = item.geometry.segments[opposite.segmentId]
  if (!oppositeSegment) return nextDoc
  ensureCubicSegment(item.geometry, oppositeSegment)
  const incoming = which === 'start' ? next : next
  const vx = incoming.x - anchor.x
  const vy = incoming.y - anchor.y
  const length = Math.hypot(vx, vy)
  if (length < 1e-6) return nextDoc

  const oppositeControl =
    opposite.which === 'start'
      ? oppositeSegment.controlStart
      : oppositeSegment.controlEnd
  if (!oppositeControl) return nextDoc
  const oppositeLength =
    handleMode === 'mirrored'
      ? length
      : Math.hypot(oppositeControl.x - anchor.x, oppositeControl.y - anchor.y)
  const ox = anchor.x - (vx / length) * oppositeLength
  const oy = anchor.y - (vy / length) * oppositeLength
  if (opposite.which === 'start') {
    oppositeSegment.controlStart = { x: ox, y: oy }
  } else {
    oppositeSegment.controlEnd = { x: ox, y: oy }
  }
  return nextDoc
}

function ensureCubicSegment(
  geometry: VectorGeometry,
  segment: VectorSegment,
): void {
  const start = geometry.points[segment.startPointId]
  const end = geometry.points[segment.endPointId]
  if (!start || !end) return
  if (segment.kind !== 'cubic') {
    segment.kind = 'cubic'
    segment.controlStart = lerpPoint(start, end, 1 / 3)
    segment.controlEnd = lerpPoint(start, end, 2 / 3)
  } else {
    segment.controlStart ??= lerpPoint(start, end, 1 / 3)
    segment.controlEnd ??= lerpPoint(start, end, 2 / 3)
  }
}

/** Same convention `useKeyboardShortcuts.ts`/`tracks.ts`/etc. already use for a locally-unique, non-persistent id — not cryptographic, just collision-safe within one document. */
function generateVectorId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`
}

export interface VectorPenAppendResult {
  document: VectorDocument
  itemId: string
  pointId: string
}

/**
 * Pen-tool primitive: place the next point of an in-progress path.
 *
 * Pass `document`/`itemId`/`lastPointId` as `null` to start a brand new
 * path (its first point has nothing to connect to yet) — returns a fresh
 * one-item `VectorDocument` with a default visible stroke and no fill, so
 * the line the user is drawing is actually visible while they draw it.
 * Otherwise appends a point plus the connecting `VectorSegment` (straight,
 * unless `incomingControlStart` is given — see `dragVectorPenAnchor`,
 * which computes it from a click-and-drag on the *previous* point) to the
 * item's current (last) contour.
 */
export function appendVectorPenPoint(
  document: VectorDocument | null,
  itemId: string | null,
  lastPointId: string | null,
  point: VectorPosition,
  incomingControlStart?: VectorPosition,
): VectorPenAppendResult {
  const pointId = generateVectorId('pt')
  if (!document || !itemId || !lastPointId) {
    const newItemId = generateVectorId('item')
    const item = createVectorItem({
      id: newItemId,
      strokes: [defaultVectorStroke()],
      geometry: {
        points: { [pointId]: { id: pointId, x: point.x, y: point.y } },
        segments: {},
        contours: [
          { id: generateVectorId('contour'), segmentIds: [], closed: false, fillRule: 'nonzero' },
        ],
      },
    })
    return { document: { version: 1, items: [item] }, itemId: newItemId, pointId }
  }

  const nextDoc = cloneVectorDocument(document)
  const item = nextDoc.items.find((candidate) => candidate.id === itemId)
  if (!item) return { document: nextDoc, itemId, pointId: lastPointId }

  const segmentId = generateVectorId('seg')
  item.geometry.points[pointId] = { id: pointId, x: point.x, y: point.y }
  item.geometry.segments[segmentId] = {
    id: segmentId,
    startPointId: lastPointId,
    endPointId: pointId,
    kind: incomingControlStart ? 'cubic' : 'line',
    ...(incomingControlStart ? { controlStart: { ...incomingControlStart } } : {}),
  }
  const contour = item.geometry.contours[item.geometry.contours.length - 1]
  contour?.segmentIds.push(segmentId)
  return { document: nextDoc, itemId, pointId }
}

export interface VectorPenDragResult {
  document: VectorDocument
  /**
   * Absolute position for the future segment's `controlStart` if the
   * pen continues from here — pass this straight into the next
   * `appendVectorPenPoint`/`closeVectorPenPath` call's
   * `incomingControlStart` (or drop it on release without a further
   * point, in which case it's simply unused).
   */
  pendingOutgoingHandle: VectorPosition
}

/**
 * Pen-tool primitive: the user is click-and-dragging right after placing
 * `anchorPointId`. Standard pen-tool behavior — dragging sets the
 * OUTGOING tangent for whatever segment comes next (not created yet,
 * hence returning it separately rather than writing it anywhere), and
 * mirrors the INCOMING handle on the segment that already ends at this
 * anchor (`incomingSegmentId` — `null` for a path's very first point,
 * which has no incoming segment to mirror).
 */
export function dragVectorPenAnchor(
  document: VectorDocument,
  itemId: string,
  incomingSegmentId: string | null,
  anchorPointId: string,
  dragTo: VectorPosition,
): VectorPenDragResult {
  const nextDoc = cloneVectorDocument(document)
  const item = nextDoc.items.find((candidate) => candidate.id === itemId)
  const anchor = item?.geometry.points[anchorPointId]
  if (item && anchor && incomingSegmentId) {
    const segment = item.geometry.segments[incomingSegmentId]
    if (segment) {
      ensureCubicSegment(item.geometry, segment)
      // Mirror the drag across the anchor for the incoming handle —
      // the same symmetric relationship `moveVectorHandle`'s
      // `handleMode !== 'independent'` path keeps between a real
      // point's two handles, just computed directly since the outgoing
      // handle isn't a real segment yet to mirror *from*.
      segment.controlEnd = {
        x: anchor.x * 2 - dragTo.x,
        y: anchor.y * 2 - dragTo.y,
      }
    }
  }
  return { document: nextDoc, pendingOutgoingHandle: { ...dragTo } }
}

/**
 * Pen-tool primitive: close the path — connect the last placed point
 * back to its first point with a final `isClosing` segment, and mark the
 * contour closed. `incomingControlStart` is the same drag-computed
 * handle `appendVectorPenPoint` accepts, for a curved closing segment.
 */
export function closeVectorPenPath(
  document: VectorDocument,
  itemId: string,
  lastPointId: string,
  firstPointId: string,
  incomingControlStart?: VectorPosition,
): VectorDocument {
  const nextDoc = cloneVectorDocument(document)
  const item = nextDoc.items.find((candidate) => candidate.id === itemId)
  if (!item) return nextDoc
  const segmentId = generateVectorId('seg')
  item.geometry.segments[segmentId] = {
    id: segmentId,
    startPointId: lastPointId,
    endPointId: firstPointId,
    kind: incomingControlStart ? 'cubic' : 'line',
    isClosing: true,
    ...(incomingControlStart ? { controlStart: { ...incomingControlStart } } : {}),
  }
  const contour = item.geometry.contours[item.geometry.contours.length - 1]
  if (contour) {
    contour.segmentIds.push(segmentId)
    contour.closed = true
  }
  return nextDoc
}

function findOppositeHandle(
  item: VectorItem,
  segmentId: string,
  anchorId: string,
  which: 'start' | 'end',
): { segmentId: string; which: 'start' | 'end' } | null {
  for (const [id, segment] of Object.entries(item.geometry.segments)) {
    if (id === segmentId) continue
    if (segment.endPointId === anchorId) {
      return { segmentId: id, which: 'end' }
    }
    if (segment.startPointId === anchorId) {
      return { segmentId: id, which: 'start' }
    }
  }
  if (which === 'start' && item.geometry.segments[segmentId]?.endPointId === anchorId) {
    return { segmentId, which: 'end' }
  }
  if (which === 'end' && item.geometry.segments[segmentId]?.startPointId === anchorId) {
    return { segmentId, which: 'start' }
  }
  return null
}

function lerpPoint(
  a: VectorPoint,
  b: VectorPoint,
  t: number,
): VectorPosition {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}

export function vectorDocumentsCompatible(
  a: VectorDocument,
  b: VectorDocument,
): boolean {
  if (a.items.length !== b.items.length) return false
  for (let i = 0; i < a.items.length; i++) {
    const left = a.items[i]!
    const right = b.items[i]!
    if (left.id !== right.id) return false
    const leftPoints = Object.keys(left.geometry.points)
    const rightPoints = Object.keys(right.geometry.points)
    if (leftPoints.length !== rightPoints.length) return false
    for (const id of leftPoints) {
      if (!right.geometry.points[id]) return false
    }
    const leftSegments = Object.keys(left.geometry.segments)
    const rightSegments = Object.keys(right.geometry.segments)
    if (leftSegments.length !== rightSegments.length) return false
    for (const id of leftSegments) {
      const ls = left.geometry.segments[id]
      const rs = right.geometry.segments[id]
      if (!ls || !rs) return false
      if (
        ls.startPointId !== rs.startPointId ||
        ls.endPointId !== rs.endPointId
      ) {
        return false
      }
    }
  }
  return true
}

export function lerpVectorDocuments(
  a: VectorDocument,
  b: VectorDocument,
  u: number,
): VectorDocument {
  if (!vectorDocumentsCompatible(a, b)) return u < 1 ? a : b
  const t = Math.max(0, Math.min(1, u))
  const next = cloneVectorDocument(a)
  for (let i = 0; i < next.items.length; i++) {
    const fromItem = a.items[i]!
    const toItem = b.items[i]!
    const item = next.items[i]!
    for (const id of Object.keys(item.geometry.points)) {
      const from = fromItem.geometry.points[id]!
      const to = toItem.geometry.points[id]!
      item.geometry.points[id] = {
        ...from,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      }
    }
    for (const id of Object.keys(item.geometry.segments)) {
      const from = fromItem.geometry.segments[id]!
      const to = toItem.geometry.segments[id]!
      const segment = item.geometry.segments[id]!
      segment.kind =
        from.kind === 'cubic' || to.kind === 'cubic' ? 'cubic' : 'line'
      if (from.controlStart || to.controlStart) {
        segment.controlStart = lerpOptional(
          from.controlStart,
          to.controlStart,
          t,
        )
      }
      if (from.controlEnd || to.controlEnd) {
        segment.controlEnd = lerpOptional(from.controlEnd, to.controlEnd, t)
      }
    }
    for (let fi = 0; fi < item.fills.length; fi++) {
      const fromFill = fromItem.fills[fi]
      const toFill = toItem.fills[fi]
      if (!fromFill || !toFill) continue
      item.fills[fi] = lerpVectorPaint(fromFill, toFill, t)
    }
    for (let si = 0; si < item.strokes.length; si++) {
      const fromStroke = fromItem.strokes[si]
      const toStroke = toItem.strokes[si]
      if (!fromStroke || !toStroke) continue
      item.strokes[si] = lerpVectorStroke(fromStroke, toStroke, t)
    }
  }
  return next
}

function lerpOptional(
  a: VectorPosition | undefined,
  b: VectorPosition | undefined,
  t: number,
): VectorPosition | undefined {
  if (!a && !b) return undefined
  const from = a ?? b!
  const to = b ?? a!
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  }
}

/**
 * Interpolate one fill layer between two morph-target keyframes.
 *
 * Same-kind solid and gradient paints tween for real (color, geometry, and
 * stop layout). Anything without a defined blend — mismatched paint kinds,
 * or an image fill — steps like the rest of the engine's unsupported-shape
 * fallback: holds `from` until `t` reaches 1, then jumps to `to`.
 */
function lerpXY(a: VectorPosition, b: VectorPosition, t: number): VectorPosition {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function lerpVectorPaint(
  from: VectorPaint,
  to: VectorPaint,
  t: number,
): VectorPaint {
  const opacity = from.opacity + (to.opacity - from.opacity) * t
  if (from.kind === 'solid' && to.kind === 'solid') {
    return {
      ...(t >= 1 ? to : from),
      kind: 'solid',
      color: lerpOklchStrings(from.color, to.color, t) ?? (t >= 1 ? to.color : from.color),
      opacity,
    }
  }
  if (from.kind === 'linear' && to.kind === 'linear') {
    return {
      ...(t >= 1 ? to : from),
      kind: 'linear',
      stops: lerpGradientStops(from.stops, to.stops, t),
      start: lerpXY(from.start, to.start, t),
      end: lerpXY(from.end, to.end, t),
      opacity,
    }
  }
  if (from.kind === 'radial' && to.kind === 'radial') {
    return {
      ...(t >= 1 ? to : from),
      kind: 'radial',
      stops: lerpGradientStops(from.stops, to.stops, t),
      center: lerpXY(from.center, to.center, t),
      radiusX: from.radiusX + (to.radiusX - from.radiusX) * t,
      radiusY: from.radiusY + (to.radiusY - from.radiusY) * t,
      rotation: from.rotation + (to.rotation - from.rotation) * t,
      opacity,
    }
  }
  if (from.kind === 'conic' && to.kind === 'conic') {
    return {
      ...(t >= 1 ? to : from),
      kind: 'conic',
      stops: lerpGradientStops(from.stops, to.stops, t),
      center: lerpXY(from.center, to.center, t),
      angle: from.angle + (to.angle - from.angle) * t,
      opacity,
    }
  }
  return t >= 1 ? to : from
}

/**
 * Interpolate a stroke between two morph-target keyframes: paint (solid or
 * gradient, via {@link lerpVectorPaint}), width, and opacity tween for
 * real. Cap/join/align/dash/miterLimit — cosmetic details that don't read
 * as "the stroke changed," just as a style choice — step like the rest of
 * the engine's unsupported-shape fallback.
 */
export function lerpVectorStroke(
  from: VectorStroke,
  to: VectorStroke,
  t: number,
): VectorStroke {
  return {
    ...(t >= 1 ? to : from),
    paint: lerpVectorPaint(from.paint, to.paint, t),
    width: from.width + (to.width - from.width) * t,
    opacity: from.opacity + (to.opacity - from.opacity) * t,
    dashOffset: from.dashOffset + (to.dashOffset - from.dashOffset) * t,
    dash:
      from.dash.length === to.dash.length
        ? from.dash.map((value, i) => value + ((to.dash[i] ?? value) - value) * t)
        : t >= 1
          ? to.dash
          : from.dash,
  }
}

/**
 * Pairs stops by index (the common "recolor this gradient" case). A stop
 * count mismatch has no natural correspondence, so it steps as a whole
 * instead of guessing a mapping.
 */
function lerpGradientStops(
  from: GradientStop[],
  to: GradientStop[],
  t: number,
): GradientStop[] {
  if (from.length !== to.length) return t >= 1 ? to : from
  return from.map((stop, index) => {
    const target = to[index]!
    return {
      at: stop.at + (target.at - stop.at) * t,
      color: lerpOklchStrings(stop.color, target.color, t) ?? (t >= 1 ? target.color : stop.color),
    }
  })
}

export function listVectorEditHandles(item: VectorItem): Array<{
  segmentId: string
  which: 'start' | 'end'
  anchor: VectorPoint
  control: VectorPosition
}> {
  const handles: Array<{
    segmentId: string
    which: 'start' | 'end'
    anchor: VectorPoint
    control: VectorPosition
  }> = []
  for (const segment of Object.values(item.geometry.segments)) {
    const start = item.geometry.points[segment.startPointId]
    const end = item.geometry.points[segment.endPointId]
    if (!start || !end) continue
    const controlStart =
      segment.controlStart ?? lerpPoint(start, end, 1 / 3)
    const controlEnd = segment.controlEnd ?? lerpPoint(start, end, 2 / 3)
    handles.push({
      segmentId: segment.id,
      which: 'start',
      anchor: start,
      control: controlStart,
    })
    handles.push({
      segmentId: segment.id,
      which: 'end',
      anchor: end,
      control: controlEnd,
    })
  }
  return handles
}
