// SPDX-License-Identifier: Apache-2.0

import { projectWorldPoint, viewportPointToRay, type ResolvedCamera3D, type ViewportSize } from '@/render3d/scene3d'

/** Map a pointer onto the scene's authoring plane through the actual camera. */
export function cameraCanvasPoint(
  camera: ResolvedCamera3D,
  point: { x: number; y: number },
  viewport: ViewportSize,
): { x: number; y: number } | null {
  const ray = viewportPointToRay(camera, point.x, point.y, viewport)
  if (Math.abs(ray.direction.z) < 1e-6) return null
  const distance = -ray.origin.z / ray.direction.z
  if (distance < 0) return null
  const x = ray.origin.x + ray.direction.x * distance
  const y = ray.origin.y + ray.direction.y * distance
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/** Pan an angled orthographic view in screen directions while keeping Z fixed. */
export function cameraOrthographicPan(input: {
  camera: ResolvedCamera3D
  viewport: ViewportSize
  startX: number
  startY: number
  deltaX: number
  deltaY: number
  workspaceZoom: number
  parentMatrix?: readonly number[]
}): { x: number; y: number } {
  const zoom = Math.max(0.001, Math.abs(input.workspaceZoom) || 1)
  const center = input.camera.pointOfInterest
  const matrix = input.parentMatrix
  const xAxis = matrix ? { x: matrix[0], y: matrix[1], z: matrix[2] } : { x: 1, y: 0, z: 0 }
  const yAxis = matrix ? { x: matrix[4], y: matrix[5], z: matrix[6] } : { x: 0, y: 1, z: 0 }
  const projected = projectWorldPoint(center, input.camera, input.viewport)
  const axis = (direction: typeof center) => {
    const point = projectWorldPoint({ x: center.x + direction.x, y: center.y + direction.y, z: center.z + direction.z }, input.camera, input.viewport)
    return { x: point.x - projected.x, y: point.y - projected.y }
  }
  const x = axis(xAxis)
  const y = axis(yAxis)
  const determinant = x.x * y.y - x.y * y.x
  if (Math.abs(determinant) < 1e-6) return { x: input.startX, y: input.startY }
  const dx = input.deltaX / zoom
  const dy = input.deltaY / zoom
  return {
    x: input.startX + (dx * y.y - dy * y.x) / determinant,
    y: input.startY + (dy * x.x - dx * x.y) / determinant,
  }
}
