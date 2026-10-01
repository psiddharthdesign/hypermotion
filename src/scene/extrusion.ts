// SPDX-License-Identifier: Apache-2.0

import type { EllipseNode, RectNode } from './types'

/** A layer's front stays at its authored Z; its body extends away along local +Z. */
export interface Extrusion {
  depth: number
  sideColor: string
}

export const MAX_EXTRUSION_DEPTH = 100000
export const DEFAULT_EXTRUSION_SIDE_COLOR = '#2563eb'

/** Missing settings preserve legacy flat layers; zero depth retains authored settings. */
export function normalizeExtrusion(value: unknown): Extrusion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Partial<Extrusion>
  return {
    depth: normalizeExtrusionDepth(source.depth),
    sideColor: typeof source.sideColor === 'string' && source.sideColor.trim().length > 0 && source.sideColor.length <= 256
      ? source.sideColor.trim()
      : DEFAULT_EXTRUSION_SIDE_COLOR,
  }
}

export function normalizeExtrusionDepth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_EXTRUSION_DEPTH, value))
    : 0
}

export interface ExtrusionShapeAnimation {
  arcSweep?: number
  arcInnerRadius?: number
  fullRadius?: number
  cornerSmoothing?: number
  cornerSmoothingEnabled?: number
}

export type ExtrusionShapeLimitation = 'ellipse-arc' | 'independent-corners' | 'corner-smoothing'

/** The renderer and Inspector must agree before showing a body behind a 2D face. */
export function extrusionShapeLimitation(
  node: RectNode | EllipseNode,
  animated?: ExtrusionShapeAnimation,
): ExtrusionShapeLimitation | undefined {
  if (node.kind === 'ellipse') {
    return (animated?.arcSweep ?? node.arc.sweep) < 1 || (animated?.arcInnerRadius ?? node.arc.innerRadius) > 0
      ? 'ellipse-arc' : undefined
  }
  const full = animated?.fullRadius !== undefined
    ? animated.fullRadius >= 0.5 : node.appearance.fullRadius === true
  if (!full && node.appearance.cornerRadii) return 'independent-corners'
  const smoothingEnabled = animated?.cornerSmoothingEnabled !== undefined
    ? animated.cornerSmoothingEnabled >= 0.5 : node.appearance.cornerSmoothingEnabled !== false
  const smoothing = animated?.cornerSmoothing ?? node.appearance.cornerSmoothing ?? 0
  if (smoothingEnabled && Number.isFinite(smoothing) && smoothing > 0) return 'corner-smoothing'
  return undefined
}
