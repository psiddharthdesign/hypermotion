// SPDX-License-Identifier: Apache-2.0

import { Box3, CurvePath, LineCurve3, Matrix4, QuadraticBezierCurve3, Ray, Vector3 } from 'three'
import type { AnimatedValue } from '@/anim'
import type { Node, NodeId } from '@/scene'
import { finiteFlowNumber, normalizeFlowConnection, type FlowConnection } from '@/scene/flowConnection'
import type { Ray3 } from './math'
import type { Plane3D } from './scene3d'
import { extrusionShapeForPlane, extrusionWorldMatrix } from './extrusionScene'
import { intersectExtrusion } from './extrusionPicking'

export interface ResolvedFlowConnection {
  nodeId: NodeId
  settings: FlowConnection
  source: Vector3
  target: Vector3
  points: Vector3[]
  curve: CurvePath<Vector3>
  length: number
  opacity: number
  alwaysOnTop: boolean
  paintOrder: number
  timeOffset: number
  travelDistance?: number
}

function descendantOf(id: NodeId, ancestor: NodeId, nodes: ReadonlyMap<NodeId, Node>): boolean {
  const visited = new Set<NodeId>()
  let current: NodeId | null = id
  while (current && !visited.has(current)) {
    if (current === ancestor) return true
    visited.add(current)
    current = nodes.get(current)?.parent ?? null
  }
  return false
}

function endpointPlanes(id: NodeId, nodes: ReadonlyMap<NodeId, Node>, planes: readonly Plane3D[]): Plane3D[] {
  const node = nodes.get(id)
  if (!node || !node.visible || node.connection) return []
  const candidates = planes.filter(plane => plane.opacity > 0 && plane.node.visible && !plane.node.connection && descendantOf(plane.nodeId, id, nodes))
  // Use actual solids for a kit group rather than its empty flat container.
  const solids = candidates.filter(plane => !!plane.extrusion)
  return solids.length ? solids : candidates
}

export function flowAssetBounds(planes: readonly Plane3D[]): Box3 | null {
  if (!planes.length) return null
  const bounds = new Box3()
  for (const plane of planes) {
    const matrix = new Matrix4().fromArray(extrusionWorldMatrix(plane))
    for (const x of [-plane.rect.width / 2, plane.rect.width / 2]) {
      for (const y of [-plane.rect.height / 2, plane.rect.height / 2]) {
        for (const z of [0, plane.extrusion?.depth ?? 0]) bounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(matrix))
      }
    }
  }
  return bounds.isEmpty() ? null : bounds
}

function port(bounds: Box3, other: Box3, planes: readonly Plane3D[]): Vector3 {
  const center = bounds.getCenter(new Vector3())
  const target = other.getCenter(new Vector3())
  const dx = target.x - center.x, dy = target.y - center.y
  // In the isometric workspace, negative Z rises; connections run near the base.
  center.z = bounds.max.z - Math.min(12, Math.max(0, bounds.max.z - bounds.min.z) / 2)
  const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
  const direction = new Vector3(axis === 'x' ? Math.sign(dx) || 1 : 0, axis === 'y' ? Math.sign(dy) || 1 : 0, 0)
  const extent = bounds.getSize(new Vector3()).length() + 1
  const origin = center.clone().addScaledVector(direction, extent)
  const rayDirection = direction.clone().negate()
  let closest: { t: number; point: Vector3 } | null = null
  for (const plane of planes) {
    const shape = extrusionShapeForPlane(plane)
    if (!shape || shape.depth <= 0) continue
    const hit = intersectExtrusion({ origin, direction: rayDirection }, shape, extrusionWorldMatrix(plane))
    if (hit && (!closest || hit.t < closest.t)) closest = { t: hit.t, point: new Vector3(hit.point.x, hit.point.y, hit.point.z) }
  }
  if (closest) return closest.point
  center[axis] = direction[axis] > 0 ? bounds.max[axis] : bounds.min[axis]
  return center
}

/** Orthogonal automatic routing with rounded elbows, including a vertical step when needed. */
export function flowRoute(source: Vector3, target: Vector3, routing: FlowConnection['routing']): Vector3[] {
  if (routing === 'straight') return [source.clone(), target.clone()]
  const dx = target.x - source.x, dy = target.y - source.y
  const points = Math.abs(dx) >= Math.abs(dy)
    ? [source.clone(), new Vector3((source.x + target.x) / 2, source.y, source.z), new Vector3((source.x + target.x) / 2, target.y, source.z), new Vector3(target.x, target.y, source.z), target.clone()]
    : [source.clone(), new Vector3(source.x, (source.y + target.y) / 2, source.z), new Vector3(target.x, (source.y + target.y) / 2, source.z), new Vector3(target.x, target.y, source.z), target.clone()]
  return points.filter((point, index) => index === 0 || point.distanceToSquared(points[index - 1]!) > 1e-8)
}

export function roundedFlowCurve(points: readonly Vector3[], radius = 16): CurvePath<Vector3> {
  const curve = new CurvePath<Vector3>()
  if (points.length < 2) return curve
  let previous = points[0]!.clone()
  for (let index = 1; index < points.length - 1; index++) {
    const a = points[index - 1]!, b = points[index]!, c = points[index + 1]!
    const size = Math.min(radius, a.distanceTo(b) / 2, b.distanceTo(c) / 2)
    const before = b.clone().addScaledVector(a.clone().sub(b).normalize(), size)
    const after = b.clone().addScaledVector(c.clone().sub(b).normalize(), size)
    if (previous.distanceToSquared(before) > 1e-8) curve.add(new LineCurve3(previous, before))
    curve.add(new QuadraticBezierCurve3(before, b.clone(), after))
    previous = after
  }
  const end = points[points.length - 1]!.clone()
  if (previous.distanceToSquared(end) > 1e-8) curve.add(new LineCurve3(previous, end))
  return curve
}

export function resolveFlowConnections(
  nodes: ReadonlyMap<NodeId, Node>, planes: readonly Plane3D[], animated: Record<NodeId, AnimatedValue>,
): ResolvedFlowConnection[] {
  const result: ResolvedFlowConnection[] = []
  for (const plane of planes) {
    const node = plane.node
    if (node.kind !== 'vector' || !node.connection || !node.visible || plane.opacity <= 0) continue
    const base = normalizeFlowConnection(node.connection)
    if (!base) continue
    const value = animated[node.id]
    const settings: FlowConnection = { ...base,
      width: finiteFlowNumber(value?.connectionWidth ?? plane.connectionWidth, base.width, 0.25, 128),
      flowSpeed: finiteFlowNumber(value?.connectionFlowSpeed, base.flowSpeed, -2000, 2000),
      flowPhase: finiteFlowNumber(value?.connectionFlowPhase, base.flowPhase, 0, 1),
    }
    const sourcePlanes = endpointPlanes(settings.sourceId, nodes, planes)
    const targetPlanes = endpointPlanes(settings.targetId, nodes, planes)
    const sourceBounds = flowAssetBounds(sourcePlanes), targetBounds = flowAssetBounds(targetPlanes)
    if (!sourceBounds || !targetBounds) continue
    const source = port(sourceBounds, targetBounds, sourcePlanes), target = port(targetBounds, sourceBounds, targetPlanes)
    if (source.distanceToSquared(target) < 1e-8) continue
    const points = flowRoute(source, target, settings.routing)
    const curve = roundedFlowCurve(points, Math.max(12, settings.width * 3))
    const length = curve.getLength()
    if (!Number.isFinite(length) || length <= 0) continue
    result.push({ nodeId: node.id, settings, source, target, points, curve, length,
      opacity: plane.opacity, alwaysOnTop: plane.alwaysOnTop, paintOrder: plane.paintOrder, timeOffset: node.proceduralTimeOffset ?? 0, travelDistance: value?.connectionFlowDistance })
  }
  return result
}

/** Pixel-distance motion is a pure function of scene time, so seeks and exports agree. */
export function flowPulseDistances(length: number, settings: FlowConnection, time: number, integratedDistance?: number): number[] {
  if (!settings.flowEnabled || !(length > 0) || !Number.isFinite(time)) return []
  const spacing = Math.max(settings.flowSpacing, length / 255)
  const travel = (integratedDistance ?? time * settings.flowSpeed) + settings.flowPhase * spacing
  const offset = ((travel % spacing) + spacing) % spacing
  const positions: number[] = []
  for (let distance = offset; distance < length; distance += spacing) positions.push(distance)
  return positions
}

/** Select the visible path itself instead of the vector layer's 1px storage bounds. */
export function intersectFlowConnection(connection: ResolvedFlowConnection, sourceRay: Ray3): { t: number; point: Vector3 } | null {
  const origin = new Vector3(sourceRay.origin.x, sourceRay.origin.y, sourceRay.origin.z)
  const direction = new Vector3(sourceRay.direction.x, sourceRay.direction.y, sourceRay.direction.z)
  const magnitude = direction.length()
  if (!Number.isFinite(magnitude) || magnitude < 1e-8) return null
  const ray = new Ray(origin, direction.divideScalar(magnitude))
  const points = connection.curve.getPoints(Math.min(256, Math.max(16, Math.ceil(connection.length / 6))))
  const onRay = new Vector3(), onSegment = new Vector3()
  const radius = Math.max(6, connection.settings.width / 2)
  let closest: { t: number; point: Vector3 } | null = null
  for (let index = 1; index < points.length; index++) {
    if (ray.distanceSqToSegment(points[index - 1]!, points[index]!, onRay, onSegment) > radius * radius) continue
    const t = onRay.clone().sub(origin).dot(ray.direction) / magnitude
    if (t > 0 && (!closest || t < closest.t)) closest = { t, point: onSegment.clone() }
  }
  return closest
}
