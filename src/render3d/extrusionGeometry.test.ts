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
  it('keeps side normals and shading continuous through rounded corners and cylinders', () => {
    for (const options of [
      { kind: 'rect' as const, width: 224, height: 138, depth: 60, cornerRadius: 36 },
      { kind: 'rect' as const, width: 90, height: 180, depth: 60, cornerRadius: 120 },
      { kind: 'ellipse' as const, width: 224, height: 138, depth: 60 },
    ]) {
      const geometry = createExtrusionBodyGeometry(options)
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), colors = geometry.getAttribute('color')
      const shared = new Map<string, { normal: Vector3; color: number }>()
      let joins = 0
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(normals.getZ(i)) > 0.1) continue
        const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(value => value.toFixed(5)).join(',')
        const normal = new Vector3().fromBufferAttribute(normals, i)
        expect(normal.length()).toBeCloseTo(1, 6)
        const previous = shared.get(key)
        if (previous) {
          expect(normal.distanceTo(previous.normal)).toBeLessThan(1e-6)
          expect(colors.getX(i)).toBeCloseTo(previous.color, 7)
          joins++
        } else shared.set(key, { normal, color: colors.getX(i) })
      }
      expect(joins).toBeGreaterThan(24)
      geometry.dispose()
    }
  })
  it('preserves hard box corners instead of smoothing them into rounded lighting', () => {
    const geometry = createExtrusionBodyGeometry({ kind: 'rect', width: 100, height: 100, depth: 40, cornerRadius: 0 })
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
    const cornerNormals = []
    for (let i = 0; i < positions.count; i++) {
      if (positions.getX(i) === -50 && positions.getY(i) === -50 && positions.getZ(i) === 0) cornerNormals.push([normals.getX(i) || 0, normals.getY(i) || 0])
    }
    expect(cornerNormals).toContainEqual([-1, 0])
    expect(cornerNormals).toContainEqual([0, -1])
    geometry.dispose()
  })
  it('keeps the authored circular cap radius while dimensions and nonuniform display scale change', () => {
    for (const [width, height] of [[240, 160], [320, 230], [100, 180]]) {
      const radius = 36
      const outline = extrusionOutline({ kind: 'rect', width, height, depth: 60, cornerRadius: radius })
      const cornerCenter = { x: width / 2 - radius, y: -height / 2 + radius }
      const corner = outline.filter(point => point.x >= cornerCenter.x - 1e-7 && point.y <= cornerCenter.y + 1e-7)
      expect(corner.length).toBeGreaterThan(10)
      for (const point of corner) {
        // Front texture and body inherit the same 112% / 138% layer transform.
        const scaledX = (point.x - cornerCenter.x) * 1.12, scaledY = (point.y - cornerCenter.y) * 1.38
        expect((scaledX / (radius * 1.12)) ** 2 + (scaledY / (radius * 1.38)) ** 2).toBeCloseTo(1, 6)
      }
    }
  })
  it('increases rounded tessellation to meet the curved cap on larger shapes', () => {
    const radius = 600
    const outline = extrusionOutline({ kind: 'rect', width: 1600, height: 1400, depth: 80, cornerRadius: radius })
    const center = { x: 800 - radius, y: -700 + radius }
    const corner = outline.filter(point => point.x >= center.x - 1e-7 && point.y <= center.y + 1e-7)
    expect(corner.length).toBeGreaterThan(13)
    for (let i = 1; i < corner.length; i++) {
      const a = corner[i - 1]!, b = corner[i]!
      const midRadius = Math.hypot((a.x + b.x) / 2 - center.x, (a.y + b.y) / 2 - center.y)
      expect(radius - midRadius).toBeLessThanOrEqual(0.100001)
    }
  })
  it('produces no geometry for flat or invalid sizes', () => {
    for (const options of [{ width: 100, height: 100, depth: 0 }, { width: NaN, height: 20, depth: 10 }, { width: 20, height: -1, depth: 10 }]) {
      expect(createExtrusionGeometry({ kind: 'rect', ...options }).getAttribute('position')).toBeUndefined()
    }
  })
})
