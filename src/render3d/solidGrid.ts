// SPDX-License-Identifier: Apache-2.0
import * as THREE from 'three'

/** Editor-only ground lattice. The spacing and origin match placement snapping. */
export class SolidGridRenderer {
  private lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null
  private signature = ''

  sync(scene: THREE.Scene, spacing: number | null, width: number, height: number): void {
    if (spacing === null || !Number.isFinite(spacing) || spacing <= 0) {
      if (this.lines) this.lines.visible = false
      return
    }
    const step = Math.max(1, spacing)
    const extent = Math.max(width, height, step * 8) * 1.5
    // Large canvases retain exact snap spacing near the composition, with a
    // bounded line count so a one-pixel grid cannot allocate millions of lines.
    const count = Math.min(512, Math.ceil(extent / step))
    const cx = Math.round(width / 2 / step), cy = Math.round(height / 2 / step)
    const signature = `${step}:${count}:${cx}:${cy}`
    if (signature !== this.signature) {
      this.dispose()
      const positions: number[] = [], colors: number[] = []
      const minor = new THREE.Color('#94a3b8'), major = new THREE.Color('#64748b')
      const segment = (x1: number, y1: number, x2: number, y2: number, index: number) => {
        // Negative Z points up. A small offset keeps ground surfaces stable.
        positions.push(x1, y1, -0.01, x2, y2, -0.01)
        const color = index % 4 === 0 ? major : minor
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
      }
      for (let i = -count; i <= count; i++) {
        segment((cx + i) * step, (cy - count) * step, (cx + i) * step, (cy + count) * step, cx + i)
        segment((cx - count) * step, (cy + i) * step, (cx + count) * step, (cy + i) * step, cy + i)
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthTest: true, depthWrite: false }))
      this.lines.name = 'Editor placement grid'
      this.lines.renderOrder = -1000
      scene.add(this.lines)
      this.signature = signature
    }
    this.lines!.visible = true
  }

  dispose(): void {
    this.lines?.removeFromParent()
    this.lines?.geometry.dispose()
    this.lines?.material.dispose()
    this.lines = null
    this.signature = ''
  }
}
