// SPDX-License-Identifier: Apache-2.0
import type { AnimatedValue } from '@/anim/engine'
import type { SolvedLayout } from '@/layout'
import type { CameraNode, Node, SceneAPI } from '@/scene'
import { buildWorldPlanes, cameraSpaceDepth, hitTestPlanes, projectWorldPoint, resolveCamera3D, viewportPointToRay, type ResolvedCamera3D } from '@/render3d/scene3d'

function paintedFocusPlanes(api: SceneAPI, layout: SolvedLayout, animated: Record<string, AnimatedValue>, resolved: ResolvedCamera3D) {
  const planes = buildWorldPlanes(api, layout, animated, resolved)
  const emitted = new Set(planes.map((p) => p.nodeId))
  const hasPaint = (node: Node, subtree: boolean): boolean => {
    if (!node.visible || (animated[node.id]?.opacity ?? node.appearance.opacity) <= 0) return false
    if (node.kind === 'camera' || node.kind === 'audio') return false
    if ((animated[node.id]?.fill ?? node.appearance.fill) || (node.appearance.stroke?.width ?? 0) > 0) return true
    if (node.kind === 'image' || node.kind === 'video' || node.kind === 'shader' || node.kind === 'vector' || (node.kind === 'text' && node.text.trim().length > 0)) return true
    return subtree && api.getChildren(node.id).some((child) => !emitted.has(child.id) && hasPaint(child, true))
  }
  return planes.filter((plane) => plane.nodeId !== api.getRoot() && plane.opacity > 0 && plane.scaleX !== 0 && plane.scaleY !== 0 && hasPaint(plane.node, plane.contentMode === 'subtree'))
}

/** Capture a distance-focus plane from the nearest visible rendered layer at this frame. */
export function nearestLayerFocus(api: SceneAPI, camera: CameraNode, layout: SolvedLayout, animated: Record<string, AnimatedValue>) {
  const viewport = api.getMeta().canvas
  const resolved = resolveCamera3D(camera, animated[camera.id], viewport)
  let nearest: { nodeId: string; distance: number } | null = null
  for (const plane of paintedFocusPlanes(api, layout, animated, resolved)) {
    const distance = cameraSpaceDepth(plane.center, resolved)
    if (distance < resolved.nearClip || distance > resolved.farClip || (nearest && distance >= nearest.distance)) continue
    const corners = [-1, 1].flatMap((x) => [-1, 1].map((y) => projectWorldPoint({
      x: plane.center.x + x * plane.right.x * plane.rect.width * plane.scaleX / 2 + y * plane.down.x * plane.rect.height * plane.scaleY / 2,
      y: plane.center.y + x * plane.right.y * plane.rect.width * plane.scaleX / 2 + y * plane.down.y * plane.rect.height * plane.scaleY / 2,
      z: plane.center.z + x * plane.right.z * plane.rect.width * plane.scaleX / 2 + y * plane.down.z * plane.rect.height * plane.scaleY / 2,
    }, resolved, viewport)))
    if (corners.every((p) => p.x < 0) || corners.every((p) => p.x > viewport.width) || corners.every((p) => p.y < 0) || corners.every((p) => p.y > viewport.height)) continue
    nearest = { nodeId: plane.nodeId, distance }
  }
  return nearest
}

/** Focus the clicked surface at its camera-space depth, including card tilt. */
export function pickLayerFocus(api: SceneAPI, camera: CameraNode, layout: SolvedLayout, animated: Record<string, AnimatedValue>, point: { x: number; y: number }) {
  const viewport = api.getMeta().canvas
  if (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) return null
  const resolved = resolveCamera3D(camera, animated[camera.id], viewport)
  const ray = viewportPointToRay(resolved, point.x, point.y, viewport)
  // Locks prevent editing a layer, but should not prevent focusing on it.
  let planes = paintedFocusPlanes(api, layout, animated, resolved).map((plane) =>
    plane.node.locked ? { ...plane, node: { ...plane.node, locked: false } } : plane,
  )
  while (planes.length) {
    const hit = hitTestPlanes(planes, ray, resolved, viewport)
    if (!hit) return null
    if (hit.cameraDepth >= resolved.nearClip && hit.cameraDepth <= resolved.farClip) {
      return { nodeId: hit.nodeId, distance: hit.cameraDepth, point: hit.point }
    }
    planes = planes.filter((plane) => plane.nodeId !== hit.nodeId)
  }
  return null
}
