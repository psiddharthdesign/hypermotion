// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createExtrusionBodyGeometry, createExtrusionGeometry, extrusionOutline } from './extrusionGeometry'

describe('extrusion geometry', () => {
  it('leaves the front at its authored plane and builds a closed box behind it', () => {
    const geometry = createExtrusionGeometry({ kind: 'rect', width: 120, height: 80, depth: 30 })
    expect(geometry.boundingBox?.min.toArray()).toEqual([-60, -40, 0])
    expect(geometry.boundingBox?.max.toArray()).toEqual([60, 40, 30])
    expect(geometry.groups).toEqual([{ start: 0, count: 12, materialIndex: 0 }, { start: 12, count: 36, materialIndex: 1 }])
    const p = geometry.getAttribute('position')
    const n = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')
    for (let i = 0; i < p.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(p, i)
      const b = new Vector3().fromBufferAttribute(p, i + 1)
      const c = new Vector3().fromBufferAttribute(p, i + 2)
      expect(b.sub(a).cross(c.sub(a)).normalize().dot(new Vector3().fromBufferAttribute(n, i))).toBeCloseTo(1)
    }
    for (let i = 0; i < 12; i++) {
      expect(uv.getX(i)).toBeCloseTo(p.getX(i) / 120 + 0.5)
      expect(uv.getY(i)).toBeCloseTo(p.getY(i) / 80 + 0.5)
    }
    geometry.dispose()
  })
  it('can attach only walls and back behind an existing textured front plane', () => {
    const geometry = createExtrusionBodyGeometry({ kind: 'rect', width: 120, height: 80, depth: 30 })
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    expect(positions.count).toBe(36)
    expect(geometry.groups).toEqual([{ start: 0, count: 36, materialIndex: 0 }])
    for (let i = 0; i < normals.count; i++) expect(normals.getZ(i)).toBeGreaterThanOrEqual(0)
    expect(geometry.boundingBox?.min.toArray()).toEqual([-60, -40, 0])
    geometry.dispose()
  })
  it('uses the same finite contour for elliptical walls and caps', () => {
    const options = { kind: 'ellipse' as const, width: 100, height: 60, depth: 20 }
    const outline = extrusionOutline(options)
    expect(outline).toHaveLength(96)
    for (const p of outline) expect(p.x * p.x / 2500 + p.y * p.y / 900).toBeCloseTo(1)
    const geometry = createExtrusionGeometry(options)
    expect(geometry.groups[0]!.count).toBe(96 * 3)
    expect(geometry.getAttribute('position').count).toBe(96 * 12)
    geometry.dispose()
  })
  it('clamps rounded corners and avoids duplicate or zero-length wall edges', () => {
    for (const cornerRadius of [12, 1000]) {
      const outline = extrusionOutline({ kind: 'rect', width: 80, height: 80, depth: 20, cornerRadius })
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i]!, b = outline[(i + 1) % outline.length]!
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-8)
        expect(Math.abs(a.x)).toBeLessThanOrEqual(40.000001)
        expect(Math.abs(a.y)).toBeLessThanOrEqual(40.000001)
      }
    }
  })
  it('produces no geometry for flat or invalid sizes', () => {
    for (const options of [{ width: 100, height: 100, depth: 0 }, { width: NaN, height: 20, depth: 10 }, { width: 20, height: -1, depth: 10 }]) {
      expect(createExtrusionGeometry({ kind: 'rect', ...options }).getAttribute('position')).toBeUndefined()
    }
  })
})
