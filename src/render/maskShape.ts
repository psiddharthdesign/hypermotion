// SPDX-License-Identifier: Apache-2.0
import type { AnimatedValue } from '@/anim/engine'
import type { Rect } from '@/layout'
import type { Node, NodeId } from '@/scene/types'
import { parseSvgPathData } from '@/scene/vector/path'
import { cornerShapePath, resolveCornerAppearance } from './cornerShape'

export interface MaskPoint { x: number; y: number }

/** Mask ownership follows authored sibling order, independently of z-index. */
export function siblingMask(node: Node, getNode: (id: NodeId) => Node | null): Node | null {
  const parent = node.parent ? getNode(node.parent) : null
  const index = parent?.children.indexOf(node.id) ?? -1
  const below = parent?.children.slice(index + 1).map(getNode).find(n => n?.isMask)
  if (below?.maskMode === 'alpha') return below.visible ? below : null
  const previous = parent && index > 0 ? getNode(parent.children[index - 1]!) : null
  return previous?.isMask && previous.maskMode !== 'alpha' && previous.visible ? previous : null
}

/** Convex silhouettes shared by GPU clipping, hit testing, and DOM fallback. */
export function maskOutline(node: Node, rect: Rect, animated?: AnimatedValue): MaskPoint[] {
  const { width, height } = rect
  if (node.kind === 'ellipse') {
    return Array.from({ length: 64 }, (_, i) => {
      const angle = i * Math.PI / 32
      return { x: width / 2 * (1 + Math.cos(angle)), y: height / 2 * (1 + Math.sin(angle)) }
    })
  }
  const corners = resolveCornerAppearance(node.appearance, animated, width, height)
  if (corners.cornerRadius === 0 && !corners.cornerRadii) {
    return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
  }
  const geometry = parseSvgPathData(cornerShapePath({ width, height, ...corners }))
  const outline: MaskPoint[] = []
  for (const id of geometry.contours[0]?.segmentIds ?? []) {
    const segment = geometry.segments[id]!
    const start = geometry.points[segment.startPointId]!
    const end = geometry.points[segment.endPointId]!
    const steps = segment.kind === 'cubic' ? 12 : 1
    for (let i = 0; i < steps; i++) {
      const t = i / steps, u = 1 - t
      const a = segment.controlStart ?? start, b = segment.controlEnd ?? end
      const point = segment.kind === 'line' ? start : {
        x: u ** 3 * start.x + 3 * u ** 2 * t * a.x + 3 * u * t ** 2 * b.x + t ** 3 * end.x,
        y: u ** 3 * start.y + 3 * u ** 2 * t * a.y + 3 * u * t ** 2 * b.y + t ** 3 * end.y,
      }
      const last = outline.at(-1)
      if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1e-6) outline.push({ x: point.x, y: point.y })
    }
  }
  return outline
}

/** Intersect convex silhouettes so nested masks remain active in the DOM path. */
export function intersectMaskPolygons(subject: MaskPoint[], clip: MaskPoint[]): MaskPoint[] {
  const area = clip.reduce((sum, p, i) => {
    const q = clip[(i + 1) % clip.length]!
    return sum + p.x * q.y - q.x * p.y
  }, 0)
  if (Math.abs(area) < 1e-8) return []
  const sign = area >= 0 ? 1 : -1
  let output = subject
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i]!, b = clip[(i + 1) % clip.length]!
    const side = (p: MaskPoint) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
    const input = output
    output = []
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!, q = input[(j + 1) % input.length]!
      const dp = side(p), dq = side(q)
      if (dp >= 0) output.push(p)
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq)
        output.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) })
      }
    }
  }
  return output
}
