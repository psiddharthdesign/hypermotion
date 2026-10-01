// SPDX-License-Identifier: Apache-2.0

import type { CameraCompositionGuide } from '@/scene/cameraCompositionGuide'

export interface CameraCompositionLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Editor guides use artboard coordinates, independent of the camera's pose. */
export function cameraCompositionGeometry(
  guide: CameraCompositionGuide,
  width: number,
  height: number,
): CameraCompositionLine[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []

  const horizontal = (fraction: number): CameraCompositionLine => ({ x1: 0, y1: height * fraction, x2: width, y2: height * fraction })
  const vertical = (fraction: number): CameraCompositionLine => ({ x1: width * fraction, y1: 0, x2: width * fraction, y2: height })
  const grid = (fractions: number[]) => fractions.flatMap(fraction => [vertical(fraction), horizontal(fraction)])
  switch (guide) {
    case 'none': return []
    case 'thirds': return grid([1 / 3, 2 / 3])
    case 'center': return grid([0.5])
    case 'diagonals': return [
      { x1: 0, y1: 0, x2: width, y2: height },
      { x1: 0, y1: height, x2: width, y2: 0 },
    ]
    case 'diamond': return [
      { x1: width / 2, y1: 0, x2: width, y2: height / 2 },
      { x1: width, y1: height / 2, x2: width / 2, y2: height },
      { x1: width / 2, y1: height, x2: 0, y2: height / 2 },
      { x1: 0, y1: height / 2, x2: width / 2, y2: 0 },
    ]
    case 'diamond-grid': return diamondGrid(width, height)
    case 'isometric': return isometricGrid(width, height)
    case 'golden-ratio': {
      const ratio = (Math.sqrt(5) - 1) / 2
      return grid([1 - ratio, ratio])
    }
    case 'grid': return grid([1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6])
    case 'safe-areas': return [0.05, 0.1].flatMap(inset => {
      const left = width * inset
      const top = height * inset
      const right = width * (1 - inset)
      const bottom = height * (1 - inset)
      return [
        { x1: left, y1: top, x2: right, y2: top },
        { x1: right, y1: top, x2: right, y2: bottom },
        { x1: right, y1: bottom, x2: left, y2: bottom },
        { x1: left, y1: bottom, x2: left, y2: top },
      ]
    })
  }
}

function isometricGrid(width: number, height: number): CameraCompositionLine[] {
  const step = Math.max(Math.min(width, height) / 6, Math.max(width, height) / 40)
  const slope = 1 / Math.sqrt(3)
  const lines: CameraCompositionLine[] = []
  const count = Math.ceil((height + slope * width) / (2 * step))
  for (const direction of [-slope, slope]) {
    for (let index = -count; index <= count; index += 1) {
      const intercept = height / 2 - direction * width / 2 + index * step
      const left = Math.max(0, Math.min(-intercept / direction, (height - intercept) / direction))
      const right = Math.min(width, Math.max(-intercept / direction, (height - intercept) / direction))
      if (right <= left) continue
      lines.push({ x1: left, y1: Math.max(0, Math.min(height, direction * left + intercept)), x2: right, y2: Math.max(0, Math.min(height, direction * right + intercept)) })
    }
  }
  // All three line families intersect on the same triangular lattice.
  const columnStep = step / (2 * slope)
  const columns = Math.floor(width / (2 * columnStep))
  for (let index = -columns; index <= columns; index += 1) {
    const x = width / 2 + index * columnStep
    lines.push({ x1: x, y1: 0, x2: x, y2: height })
  }
  return lines
}

function diamondGrid(width: number, height: number): CameraCompositionLine[] {
  // Keep diamonds at 45 degrees in either aspect ratio. Limit density for
  // exceptionally narrow artboards so a guide cannot create unbounded work.
  const spacing = Math.max(Math.min(width, height) / 3, Math.max(width, height) / 60)
  const count = Math.ceil((width + height) / 2 / spacing)
  const lines: CameraCompositionLine[] = []
  for (const slope of [-1, 1]) {
    for (let index = -count; index <= count; index += 1) {
      const intercept = height / 2 - slope * width / 2 + index * spacing
      const candidates = [
        { x: 0, y: intercept },
        { x: width, y: slope * width + intercept },
        { x: -intercept / slope, y: 0 },
        { x: (height - intercept) / slope, y: height },
      ]
      const points: { x: number; y: number }[] = []
      const tolerance = Math.max(width, height) * 1e-10
      for (const point of candidates) {
        if (point.x < -tolerance || point.x > width + tolerance || point.y < -tolerance || point.y > height + tolerance) continue
        const clipped = { x: Math.min(width, Math.max(0, point.x)), y: Math.min(height, Math.max(0, point.y)) }
        if (points.some(other => Math.abs(other.x - clipped.x) <= tolerance && Math.abs(other.y - clipped.y) <= tolerance)) continue
        points.push(clipped)
      }
      if (points.length < 2) continue
      lines.push({ x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y })
    }
  }
  return lines
}
