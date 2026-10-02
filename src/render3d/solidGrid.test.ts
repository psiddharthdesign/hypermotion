// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { SolidGridRenderer } from './solidGrid'

describe('editor placement grid', () => {
  it('uses world grid multiples, fixed ground depth, and depth-tested lines', () => {
    const scene = new THREE.Scene(), renderer = new SolidGridRenderer()
    renderer.sync(scene, 32, 960, 540)
    const lines = scene.children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    const points = lines.geometry.getAttribute('position')
    for (let i = 0; i < points.count; i++) {
      expect(Math.abs(points.getX(i) % 32)).toBe(0)
      expect(Math.abs(points.getY(i) % 32)).toBe(0)
      expect(points.getZ(i)).toBeCloseTo(-0.01)
    }
    expect(lines.material.depthTest).toBe(true)
    expect(lines.material.depthWrite).toBe(false)
    renderer.dispose()
  })
  it('hides disabled grids, reuses unchanged geometry, and disposes replaced resources', () => {
    const scene = new THREE.Scene(), renderer = new SolidGridRenderer()
    renderer.sync(scene, null, 960, 540)
    expect(scene.children).toHaveLength(0)
    renderer.sync(scene, 32, 960, 540)
    const lines = scene.children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    const dispose = vi.spyOn(lines.geometry, 'dispose')
    renderer.sync(scene, null, 960, 540)
    expect(lines.visible).toBe(false)
    renderer.sync(scene, 32, 960, 540)
    expect(scene.children[0]).toBe(lines)
    expect(lines.visible).toBe(true)
    renderer.sync(scene, 64, 960, 540)
    expect(dispose).toHaveBeenCalledOnce()
    expect(scene.children).toHaveLength(1)
    renderer.dispose()
    expect(scene.children).toHaveLength(0)
  })
})
