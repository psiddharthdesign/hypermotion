// SPDX-License-Identifier: Apache-2.0

import { BufferGeometry, Float32BufferAttribute } from 'three'
import { normalizeExtrusionDepth } from '@/scene/extrusion'

export interface ExtrusionGeometryOptions {
  kind: 'rect' | 'ellipse'
  width: number
  height: number
  depth: number
  /** Uniform corner radius for rectangle bodies, in unscaled layer pixels. */
  cornerRadius?: number
}

export interface ExtrusionPoint { x: number; y: number }

function effectiveCornerRadius(options: ExtrusionGeometryOptions): number {
  return Math.min(options.width / 2, options.height / 2, Math.max(0, Number.isFinite(options.cornerRadius) ? options.cornerRadius ?? 0 : 0))
}

/** Analytic normals keep curved wall shading continuous across tessellation joins. */
function curvedWallNormal(options: ExtrusionGeometryOptions, point: ExtrusionPoint): ExtrusionPoint | null {
  let nx: number, ny: number
  if (options.kind === 'ellipse') {
    nx = point.x / (options.width * options.width / 4)
    ny = point.y / (options.height * options.height / 4)
  } else {
    const radius = effectiveCornerRadius(options)
    if (radius <= 0) return null
    const innerW = options.width / 2 - radius, innerH = options.height / 2 - radius
    nx = point.x - Math.max(-innerW, Math.min(innerW, point.x))
    ny = point.y - Math.max(-innerH, Math.min(innerH, point.y))
  }
  const length = Math.hypot(nx, ny)
  return length > 1e-10 ? { x: nx / length, y: ny / length } : null
}

function sideShade(normal: ExtrusionPoint): number {
  return 0.7 + 0.24 * Math.max(0, normal.x * -0.6 + normal.y * -0.8)
}

/** Shared tessellation keeps side picking identical to the visible solid. */
export function extrusionOutline(options: ExtrusionGeometryOptions): ExtrusionPoint[] {
  const { kind, width, height } = options
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
  const halfW = width / 2
  const halfH = height / 2
  if (kind === 'ellipse') {
    return Array.from({ length: 96 }, (_, i) => {
      const angle = i * Math.PI / 48
      return { x: halfW * Math.cos(angle), y: halfH * Math.sin(angle) }
    })
  }
  const radius = effectiveCornerRadius(options)
  if (radius === 0) return [
    { x: -halfW, y: -halfH }, { x: halfW, y: -halfH },
    { x: halfW, y: halfH }, { x: -halfW, y: halfH },
  ]
  const corners = [
    { x: halfW - radius, y: -halfH + radius, angle: -Math.PI / 2 },
    { x: halfW - radius, y: halfH - radius, angle: 0 },
    { x: -halfW + radius, y: halfH - radius, angle: Math.PI / 2 },
    { x: -halfW + radius, y: -halfH + radius, angle: Math.PI },
  ]
  // Keep the polygon within 0.1 layer pixels of the same circular cap path.
  // Large radii need more segments, especially after a high-resolution export.
  const cornerSegments = Math.max(12, Math.min(64, Math.ceil((Math.PI / 2) / (2 * Math.acos(Math.max(-1, 1 - 0.1 / radius))))))
  const outline: ExtrusionPoint[] = []
  for (const corner of corners) {
    for (let i = 0; i <= cornerSegments; i++) {
      const angle = corner.angle + i * Math.PI / (cornerSegments * 2)
      const point = { x: corner.x + radius * Math.cos(angle), y: corner.y + radius * Math.sin(angle) }
      const previous = outline.at(-1)
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-8) outline.push(point)
    }
  }
  if (Math.hypot(outline[0]!.x - outline.at(-1)!.x, outline[0]!.y - outline.at(-1)!.y) < 1e-8) outline.pop()
  return outline
}

/**
 * Local XY uses canvas coordinates, centered on the layer; front Z=0, back Z=depth.
 * Group 0 is the textured front cap, group 1 the colored walls/back. Front UVs
 * match ordinary PlaneGeometry with canvas textures using flipY=false.
 * Use vertexColors=true on the side material for restrained face shading.
 */
export function createExtrusionGeometry(options: ExtrusionGeometryOptions): BufferGeometry {
  const geometry = new BufferGeometry()
  const outline = extrusionOutline(options)
  const depth = normalizeExtrusionDepth(options.depth)
  if (outline.length < 3 || depth === 0) return geometry
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const vertex = (point: ExtrusionPoint, z: number, nx: number, ny: number, nz: number, shade: number) => {
    positions.push(point.x, point.y, z)
    normals.push(nx, ny, nz)
    uvs.push(point.x / options.width + 0.5, point.y / options.height + 0.5)
    colors.push(shade, shade, shade)
  }
  const center = { x: 0, y: 0 }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    vertex(center, 0, 0, 0, -1, 1)
    vertex(b, 0, 0, 0, -1, 1)
    vertex(a, 0, 0, 0, -1, 1)
  }
  const frontCount = positions.length / 3
  geometry.addGroup(0, frontCount, 0)
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    vertex(center, depth, 0, 0, 1, 0.72)
    vertex(a, depth, 0, 0, 1, 0.72)
    vertex(b, depth, 0, 0, 1, 0.72)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    const nx = dy / length
    const ny = -dx / length
    const normalA = curvedWallNormal(options, a) ?? { x: nx, y: ny }
    const normalB = curvedWallNormal(options, b) ?? { x: nx, y: ny }
    const shadeA = sideShade(normalA), shadeB = sideShade(normalB)
    vertex(a, 0, normalA.x, normalA.y, 0, shadeA)
    vertex(b, 0, normalB.x, normalB.y, 0, shadeB)
    vertex(a, depth, normalA.x, normalA.y, 0, shadeA)
    vertex(b, 0, normalB.x, normalB.y, 0, shadeB)
    vertex(b, depth, normalB.x, normalB.y, 0, shadeB)
    vertex(a, depth, normalA.x, normalA.y, 0, shadeA)
  }
  geometry.addGroup(frontCount, positions.length / 3 - frontCount, 1)
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Walls and back only, for a child mesh behind the renderer's existing front plane. */
export function createExtrusionBodyGeometry(options: ExtrusionGeometryOptions): BufferGeometry {
  const geometry = createExtrusionGeometry(options)
  const frontCount = geometry.groups[0]?.count ?? 0
  if (frontCount === 0) return geometry
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const attribute = geometry.getAttribute(name)
    geometry.setAttribute(name, new Float32BufferAttribute(
      attribute.array.slice(frontCount * attribute.itemSize), attribute.itemSize,
    ))
  }
  geometry.clearGroups()
  geometry.addGroup(0, geometry.getAttribute('position').count, 0)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
