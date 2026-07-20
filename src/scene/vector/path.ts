// SPDX-License-Identifier: Apache-2.0

import type {
  VectorContour,
  VectorGeometry,
  VectorPoint,
  VectorPosition,
  VectorSegment,
} from '@/scene/types'

const PATH_TOKEN = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g
const PATH_COMMAND = /^[AaCcHhLlMmQqSsTtVvZz]$/
const MAX_PATH_TOKENS = 1_000_000

export interface ParseSvgPathOptions {
  idPrefix?: string
  fillRule?: 'nonzero' | 'evenodd'
}

/**
 * Mutable path authoring helper used by SVG import and native shape tools.
 * IDs are deterministic for a given call sequence, which lets future shape
 * keyframes retain stable anchors and segments.
 */
export class VectorPathBuilder {
  private readonly idPrefix: string
  private readonly fillRule: 'nonzero' | 'evenodd'
  private readonly points: Record<string, VectorPoint> = {}
  private readonly segments: Record<string, VectorSegment> = {}
  private readonly contours: VectorContour[] = []
  private pointCount = 0
  private segmentCount = 0
  private contourCount = 0
  private activeContour: VectorContour | null = null
  private currentPointId: string | null = null
  private firstPointId: string | null = null

  constructor(idPrefix = 'path', fillRule: 'nonzero' | 'evenodd' = 'nonzero') {
    this.idPrefix = idPrefix
    this.fillRule = fillRule
  }

  moveTo(x: number, y: number): this {
    this.finishOpenContour()
    const point = this.addPoint(x, y)
    const contour: VectorContour = {
      id: `${this.idPrefix}-contour-${++this.contourCount}`,
      segmentIds: [],
      closed: false,
      fillRule: this.fillRule,
    }
    this.contours.push(contour)
    this.activeContour = contour
    this.currentPointId = point.id
    this.firstPointId = point.id
    return this
  }

  lineTo(x: number, y: number): this {
    this.ensureActive(x, y)
    const end = this.addPoint(x, y)
    this.addSegment({ kind: 'line', endPointId: end.id })
    return this
  }

  cubicTo(
    controlStartX: number,
    controlStartY: number,
    controlEndX: number,
    controlEndY: number,
    x: number,
    y: number,
  ): this {
    this.ensureActive(x, y)
    const end = this.addPoint(x, y)
    this.addSegment({
      kind: 'cubic',
      endPointId: end.id,
      controlStart: point(controlStartX, controlStartY),
      controlEnd: point(controlEndX, controlEndY),
    })
    return this
  }

  quadraticTo(controlX: number, controlY: number, x: number, y: number): this {
    const current = this.currentPosition()
    return this.cubicTo(
      current.x + (2 / 3) * (controlX - current.x),
      current.y + (2 / 3) * (controlY - current.y),
      x + (2 / 3) * (controlX - x),
      y + (2 / 3) * (controlY - y),
      x,
      y,
    )
  }

  closePath(): this {
    if (!this.activeContour || !this.currentPointId || !this.firstPointId) return this
    if (this.currentPointId !== this.firstPointId) {
      const current = this.points[this.currentPointId]
      const first = this.points[this.firstPointId]
      const lastSegmentId = this.activeContour.segmentIds.at(-1)
      const lastSegment = lastSegmentId ? this.segments[lastSegmentId] : undefined
      if (current && first && lastSegment && current.x === first.x && current.y === first.y) {
        lastSegment.endPointId = first.id
        delete this.points[current.id]
      } else {
        this.addSegment({ kind: 'line', endPointId: this.firstPointId, isClosing: true })
      }
    }
    this.activeContour.closed = true
    this.currentPointId = this.firstPointId
    return this
  }

  currentPosition(): VectorPosition {
    const current = this.currentPointId ? this.points[this.currentPointId] : undefined
    return current ? point(current.x, current.y) : point(0, 0)
  }

  build(): VectorGeometry {
    this.finishOpenContour()
    return {
      points: { ...this.points },
      segments: { ...this.segments },
      contours: this.contours.map((contour) => ({
        ...contour,
        segmentIds: [...contour.segmentIds],
      })),
    }
  }

  private ensureActive(x: number, y: number): void {
    if (!this.activeContour || !this.currentPointId) this.moveTo(x, y)
  }

  private addPoint(x: number, y: number): VectorPoint {
    assertFinite(x, y)
    const id = `${this.idPrefix}-point-${++this.pointCount}`
    const value: VectorPoint = { id, x, y }
    this.points[id] = value
    return value
  }

  private addSegment(
    value: Pick<VectorSegment, 'kind' | 'endPointId'> &
      Partial<Pick<VectorSegment, 'controlStart' | 'controlEnd' | 'isClosing'>>,
  ): void {
    if (!this.activeContour || !this.currentPointId) {
      throw new Error('A vector segment requires an active contour')
    }
    const id = `${this.idPrefix}-segment-${++this.segmentCount}`
    this.segments[id] = {
      id,
      startPointId: this.currentPointId,
      endPointId: value.endPointId,
      kind: value.kind,
      ...(value.controlStart ? { controlStart: value.controlStart } : {}),
      ...(value.controlEnd ? { controlEnd: value.controlEnd } : {}),
      ...(value.isClosing ? { isClosing: true } : {}),
    }
    this.activeContour.segmentIds.push(id)
    this.currentPointId = value.endPointId
  }

  private finishOpenContour(): void {
    if (this.activeContour && this.activeContour.segmentIds.length === 0) {
      // A move-only contour carries no renderable geometry.
      this.contours.pop()
      if (this.firstPointId) delete this.points[this.firstPointId]
    }
    this.activeContour = null
    this.currentPointId = null
    this.firstPointId = null
  }
}

export function parseSvgPathData(
  data: string,
  options: ParseSvgPathOptions = {},
): VectorGeometry {
  const tokens = data.match(PATH_TOKEN) ?? []
  if (tokens.length > MAX_PATH_TOKENS) throw new Error('SVG path is too complex')
  const compact = data.replace(PATH_TOKEN, '').replace(/[\s,]/g, '')
  if (compact.length > 0) throw new Error('SVG path contains invalid tokens')

  const builder = new VectorPathBuilder(
    options.idPrefix ?? 'path',
    options.fillRule ?? 'nonzero',
  )
  let index = 0
  let command = ''
  let previousCommand = ''
  let current = point(0, 0)
  let subpathStart = point(0, 0)
  let lastCubicControl: VectorPosition | null = null
  let lastQuadraticControl: VectorPosition | null = null

  const hasNumber = () => index < tokens.length && !PATH_COMMAND.test(tokens[index] ?? '')
  const read = () => {
    const token = tokens[index++]
    if (token === undefined || PATH_COMMAND.test(token)) throw new Error('Malformed SVG path')
    const value = Number(token)
    if (!Number.isFinite(value)) throw new Error('SVG path contains a non-finite value')
    return value
  }
  const xy = (relative: boolean): VectorPosition => {
    const x = read()
    const y = read()
    return relative ? point(current.x + x, current.y + y) : point(x, y)
  }

  while (index < tokens.length) {
    if (PATH_COMMAND.test(tokens[index] ?? '')) command = tokens[index++] ?? ''
    if (!command) throw new Error('SVG path must start with a command')
    const relative = command === command.toLowerCase()
    const upper = command.toUpperCase()

    if (upper === 'Z') {
      builder.closePath()
      current = { ...subpathStart }
      lastCubicControl = null
      lastQuadraticControl = null
      previousCommand = command
      command = ''
      continue
    }

    if (!hasNumber()) throw new Error(`SVG command ${command} has no coordinates`)

    switch (upper) {
      case 'M': {
        const target = xy(relative)
        builder.moveTo(target.x, target.y)
        current = target
        subpathStart = { ...target }
        command = relative ? 'l' : 'L'
        break
      }
      case 'L': {
        const target = xy(relative)
        builder.lineTo(target.x, target.y)
        current = target
        break
      }
      case 'H': {
        const x = read() + (relative ? current.x : 0)
        builder.lineTo(x, current.y)
        current = point(x, current.y)
        break
      }
      case 'V': {
        const y = read() + (relative ? current.y : 0)
        builder.lineTo(current.x, y)
        current = point(current.x, y)
        break
      }
      case 'C': {
        const c1 = xy(relative)
        const c2 = xy(relative)
        const target = xy(relative)
        builder.cubicTo(c1.x, c1.y, c2.x, c2.y, target.x, target.y)
        current = target
        lastCubicControl = c2
        break
      }
      case 'S': {
        const c1 = previousCommand.toUpperCase() === 'C' || previousCommand.toUpperCase() === 'S'
          ? reflect(lastCubicControl ?? current, current)
          : { ...current }
        const c2 = xy(relative)
        const target = xy(relative)
        builder.cubicTo(c1.x, c1.y, c2.x, c2.y, target.x, target.y)
        current = target
        lastCubicControl = c2
        break
      }
      case 'Q': {
        const control = xy(relative)
        const target = xy(relative)
        builder.quadraticTo(control.x, control.y, target.x, target.y)
        current = target
        lastQuadraticControl = control
        break
      }
      case 'T': {
        const control: VectorPosition = previousCommand.toUpperCase() === 'Q' || previousCommand.toUpperCase() === 'T'
          ? reflect(lastQuadraticControl ?? current, current)
          : { ...current }
        const target = xy(relative)
        builder.quadraticTo(control.x, control.y, target.x, target.y)
        current = target
        lastQuadraticControl = control
        break
      }
      case 'A': {
        const rx = Math.abs(read())
        const ry = Math.abs(read())
        const rotation = read()
        const largeArc = read() !== 0
        const sweep = read() !== 0
        const target = xy(relative)
        for (const cubic of arcToCubics(current, target, rx, ry, rotation, largeArc, sweep)) {
          builder.cubicTo(
            cubic.controlStart.x,
            cubic.controlStart.y,
            cubic.controlEnd.x,
            cubic.controlEnd.y,
            cubic.end.x,
            cubic.end.y,
          )
        }
        current = target
        break
      }
      default:
        throw new Error(`Unsupported SVG path command: ${command}`)
    }

    previousCommand = command
    if (upper !== 'C' && upper !== 'S') lastCubicControl = null
    if (upper !== 'Q' && upper !== 'T') lastQuadraticControl = null
  }

  return builder.build()
}

/** Serialize canonical geometry as absolute M/L/C/Z SVG path data. */
export function vectorGeometryToPathData(geometry: VectorGeometry): string {
  const parts: string[] = []
  for (const contour of geometry.contours) {
    const firstSegment = geometry.segments[contour.segmentIds[0] ?? '']
    const firstPoint = firstSegment ? geometry.points[firstSegment.startPointId] : undefined
    if (!firstPoint) continue
    parts.push(`M ${number(firstPoint.x)} ${number(firstPoint.y)}`)
    for (const segmentId of contour.segmentIds) {
      const segment = geometry.segments[segmentId]
      if (!segment) continue
      const end = geometry.points[segment.endPointId]
      if (!end) continue
      if (contour.closed && segment.isClosing) continue
      if (segment.kind === 'cubic' && segment.controlStart && segment.controlEnd) {
        parts.push(
          `C ${number(segment.controlStart.x)} ${number(segment.controlStart.y)} ` +
            `${number(segment.controlEnd.x)} ${number(segment.controlEnd.y)} ` +
            `${number(end.x)} ${number(end.y)}`,
        )
      } else {
        parts.push(`L ${number(end.x)} ${number(end.y)}`)
      }
    }
    if (contour.closed) parts.push('Z')
  }
  return parts.join(' ')
}

interface CubicArc {
  controlStart: VectorPosition
  controlEnd: VectorPosition
  end: VectorPosition
}

function arcToCubics(
  start: VectorPosition,
  end: VectorPosition,
  rawRx: number,
  rawRy: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
): CubicArc[] {
  if (rawRx === 0 || rawRy === 0 || (start.x === end.x && start.y === end.y)) {
    return [{ controlStart: { ...start }, controlEnd: { ...end }, end: { ...end } }]
  }
  const phi = (rotationDegrees * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx = (start.x - end.x) / 2
  const dy = (start.y - end.y) / 2
  const xPrime = cosPhi * dx + sinPhi * dy
  const yPrime = -sinPhi * dx + cosPhi * dy
  let rx = rawRx
  let ry = rawRy
  const radiiScale = xPrime ** 2 / rx ** 2 + yPrime ** 2 / ry ** 2
  if (radiiScale > 1) {
    const scale = Math.sqrt(radiiScale)
    rx *= scale
    ry *= scale
  }
  const numerator = Math.max(
    0,
    rx ** 2 * ry ** 2 - rx ** 2 * yPrime ** 2 - ry ** 2 * xPrime ** 2,
  )
  const denominator = rx ** 2 * yPrime ** 2 + ry ** 2 * xPrime ** 2
  const sign = largeArc === sweep ? -1 : 1
  const factor = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator)
  const cxPrime = factor * ((rx * yPrime) / ry)
  const cyPrime = factor * (-(ry * xPrime) / rx)
  const center = point(
    cosPhi * cxPrime - sinPhi * cyPrime + (start.x + end.x) / 2,
    sinPhi * cxPrime + cosPhi * cyPrime + (start.y + end.y) / 2,
  )
  const angle = (u: VectorPosition, v: VectorPosition) => {
    const dot = u.x * v.x + u.y * v.y
    const cross = u.x * v.y - u.y * v.x
    return Math.atan2(cross, dot)
  }
  const startUnit = point((xPrime - cxPrime) / rx, (yPrime - cyPrime) / ry)
  const endUnit = point((-xPrime - cxPrime) / rx, (-yPrime - cyPrime) / ry)
  let startAngle = angle(point(1, 0), startUnit)
  let delta = angle(startUnit, endUnit)
  if (!sweep && delta > 0) delta -= Math.PI * 2
  if (sweep && delta < 0) delta += Math.PI * 2
  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)))
  const step = delta / count
  const result: CubicArc[] = []

  const map = (unit: VectorPosition) => point(
    center.x + rx * cosPhi * unit.x - ry * sinPhi * unit.y,
    center.y + rx * sinPhi * unit.x + ry * cosPhi * unit.y,
  )
  for (let i = 0; i < count; i++) {
    const a0 = startAngle
    const a1 = a0 + step
    const alpha = (4 / 3) * Math.tan((a1 - a0) / 4)
    const p0 = point(Math.cos(a0), Math.sin(a0))
    const p1 = point(Math.cos(a1), Math.sin(a1))
    result.push({
      controlStart: map(point(p0.x - alpha * p0.y, p0.y + alpha * p0.x)),
      controlEnd: map(point(p1.x + alpha * p1.y, p1.y - alpha * p1.x)),
      end: map(p1),
    })
    startAngle = a1
  }
  result[result.length - 1]!.end = { ...end }
  return result
}

function point(x: number, y: number): VectorPosition {
  assertFinite(x, y)
  return { x, y }
}

function reflect(control: VectorPosition, around: VectorPosition): VectorPosition {
  return point(around.x * 2 - control.x, around.y * 2 - control.y)
}

function assertFinite(...values: number[]): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Vector coordinates must be finite')
  }
}

function number(value: number): string {
  return Number(value.toFixed(6)).toString()
}
