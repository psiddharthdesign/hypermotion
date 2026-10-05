// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { CameraCompositionGuide } from '@/scene/cameraCompositionGuide'
import { cameraCompositionGeometry, type CameraCompositionLine } from './cameraCompositionGeometry'

describe('camera composition geometry', () => {
  it('places thirds, center and golden-ratio intersections at their exact proportions', () => {
    expect(cameraCompositionGeometry('thirds', 1200, 900)).toEqual([
      { x1: 400, y1: 0, x2: 400, y2: 900 },
      { x1: 0, y1: 300, x2: 1200, y2: 300 },
      { x1: 800, y1: 0, x2: 800, y2: 900 },
      { x1: 0, y1: 600, x2: 1200, y2: 600 },
    ])
    expect(cameraCompositionGeometry('center', 1200, 900)).toEqual([
      { x1: 600, y1: 0, x2: 600, y2: 900 },
      { x1: 0, y1: 450, x2: 1200, y2: 450 },
    ])
    const golden = cameraCompositionGeometry('golden-ratio', 1200, 900)
    expect(golden[0].x1 / 1200).toBeCloseTo(0.381966)
    expect(golden[2].x1 / 1200).toBeCloseTo(0.618034)
    expect(golden[0].x1 + golden[2].x1).toBeCloseTo(1200)
    expect(golden[1].y1 + golden[3].y1).toBeCloseTo(900)
  })

  it('connects opposite corners for diagonals and edge midpoints for a closed diamond', () => {
    expect(cameraCompositionGeometry('diagonals', 960, 540)).toEqual([
      { x1: 0, y1: 0, x2: 960, y2: 540 },
      { x1: 0, y1: 540, x2: 960, y2: 0 },
    ])
    const diamond = cameraCompositionGeometry('diamond', 960, 540)
    expect(diamond.map(line => [line.x1, line.y1])).toEqual([[480, 0], [960, 270], [480, 540], [0, 270]])
    diamond.forEach((line, index) => {
      const next = diamond[(index + 1) % diamond.length]
      expect([line.x2, line.y2]).toEqual([next.x1, next.y1])
    })
  })

  it('makes six equal rows and columns and centered 90% / 80% safe areas', () => {
    const grid = cameraCompositionGeometry('grid', 600, 1200)
    expect(grid.filter(line => line.x1 === line.x2).map(line => line.x1)).toEqual([100, 200, 300, 400, 500])
    expect(grid.filter(line => line.y1 === line.y2).map(line => line.y1)).toEqual([200, 400, 600, 800, 1000])
    const safe = cameraCompositionGeometry('safe-areas', 1000, 500)
    expect(safe).toHaveLength(8)
    expect(safe[0]).toEqual({ x1: 50, y1: 25, x2: 950, y2: 25 })
    expect(safe[2]).toEqual({ x1: 950, y1: 475, x2: 50, y2: 475 })
    expect(safe[4]).toEqual({ x1: 100, y1: 50, x2: 900, y2: 50 })
    expect(safe[6]).toEqual({ x1: 900, y1: 450, x2: 100, y2: 450 })
  })

  it.each([[1920, 1080], [1080, 1920], [900, 900]])('keeps diamond cells square and symmetric in a %s × %s frame', (width, height) => {
    const lines = cameraCompositionGeometry('diamond-grid', width, height)
    const sameLine = (a: CameraCompositionLine, b: CameraCompositionLine) => {
      const close = (x: number, y: number) => Math.abs(x - y) < 1e-6
      return (close(a.x1, b.x1) && close(a.y1, b.y1) && close(a.x2, b.x2) && close(a.y2, b.y2))
        || (close(a.x1, b.x2) && close(a.y1, b.y2) && close(a.x2, b.x1) && close(a.y2, b.y1))
    }
    expect(lines.length).toBeGreaterThan(4)
    lines.forEach(line => {
      expect(Math.abs(line.x2 - line.x1)).toBeCloseTo(Math.abs(line.y2 - line.y1))
      expect(lines.some(other => sameLine(other, {
        x1: width - line.x1, y1: line.y1, x2: width - line.x2, y2: line.y2,
      }))).toBe(true)
      expect(lines.some(other => sameLine(other, {
        x1: line.x1, y1: height - line.y1, x2: line.x2, y2: height - line.y2,
      }))).toBe(true)
    })
  })

  it('clips every guide to portrait and landscape frames without degenerate segments', () => {
    const guides: CameraCompositionGuide[] = ['thirds', 'center', 'diagonals', 'diamond', 'diamond-grid', 'isometric', 'golden-ratio', 'grid', 'safe-areas']
    for (const [width, height] of [[1920, 1080], [1080, 1920], [1000000, 1]]) {
      for (const guide of guides) {
        const lines = cameraCompositionGeometry(guide, width, height)
        expect(lines.length).toBeLessThan(200)
        for (const line of lines) {
          for (const x of [line.x1, line.x2]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(width) }
          for (const y of [line.y1, line.y2]) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(height) }
          expect(Math.hypot(line.x2 - line.x1, line.y2 - line.y1)).toBeGreaterThan(0)
        }
      }
    }
  })

  it('omits off guides and invalid canvas dimensions', () => {
    expect(cameraCompositionGeometry('none', 960, 540)).toEqual([])
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(cameraCompositionGeometry('diamond-grid', invalid, 540)).toEqual([])
      expect(cameraCompositionGeometry('diamond-grid', 960, invalid)).toEqual([])
    }
  })

  it.each([[1920, 1080], [1080, 1920], [900, 900]])('keeps isometric guides at 30° and vertical for %s × %s', (width, height) => {
    const lines = cameraCompositionGeometry('isometric', width, height)
    expect(lines.some(line => line.x1 === width / 2 && line.x2 === width / 2)).toBe(true)
    for (const line of lines) {
      if (line.x1 === line.x2) continue
      expect(Math.abs((line.y2 - line.y1) / (line.x2 - line.x1))).toBeCloseTo(1 / Math.sqrt(3), 8)
    }
    expect(lines.some(line => line.y1 < line.y2)).toBe(true)
    expect(lines.some(line => line.y1 > line.y2)).toBe(true)
  })
})
