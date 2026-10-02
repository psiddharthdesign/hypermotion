// SPDX-License-Identifier: Apache-2.0

import { Matrix4, Vector3 } from 'three'
import type { Node, NodeId } from '@/scene'
import type { Vec3 } from '@/render3d/math'
import type { Plane3D } from '@/render3d/scene3d'
import { extrusionWorldMatrix } from '@/render3d/extrusionScene'

export type SolidGridAxis = 'x' | 'y' | 'z'
interface Bounds { min: Vec3; max: Vec3 }
interface Collider {
  nodeId: NodeId
  protected: boolean
  protectionOwner: NodeId | null
  vertices: Vector3[]
  normals: Vector3[]
  edges: Vector3[]
  bounds: Bounds
  volume: boolean
}
export interface SolidPlacementSession {
  readonly moving: readonly Collider[]
  readonly obstacles: readonly Collider[]
  readonly movingIds: ReadonlySet<NodeId>
  /** Absolute world-space XY center and bottom/base Z of the selected solids. */
  readonly anchor: Vec3
  readonly hasProtectedPairs: boolean
}
export interface SolidTranslationOptions {
  snapToGrid?: boolean
  gridSize?: number
  axes?: readonly SolidGridAxis[]
  bypass?: boolean
}
export interface SolidTranslationResult {
  delta: Vec3
  fraction: number
  blocked: boolean
  snapped: boolean
}

// Strict contact is allowed. The tolerance only ignores numerical contact noise.
const CONTACT_EPSILON = 1e-5
const TIME_EPSILON = 1e-7
const CYLINDER_SIDES = 32
const AXES = ['x', 'y', 'z'] as const
const finite = (p: Vec3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)

function boundsFor(vertices: readonly Vec3[]): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of vertices) for (const axis of AXES) { min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]) }
  return { min, max }
}
function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return AXES.every(axis => a.max[axis] - b.min[axis] > CONTACT_EPSILON && b.max[axis] - a.min[axis] > CONTACT_EPSILON)
}
function addAxis(axes: Vector3[], axis: Vector3): void {
  const length = axis.length()
  if (length < 1e-8 || !Number.isFinite(length)) return
  axis.divideScalar(length)
  if (!axes.some(existing => Math.abs(existing.dot(axis)) > 1 - 1e-7)) axes.push(axis)
}

function colliderFor(plane: Plane3D, protectionOwner: NodeId | null, includeFlat = false): Collider | null {
  const depth = plane.extrusion?.depth
  if (!plane.extrusion || depth === undefined || (!includeFlat && depth <= 0) || !plane.node.visible || plane.opacity <= 0 || plane.node.connection || (plane.node.kind !== 'rect' && plane.node.kind !== 'ellipse')) return null
  const width = plane.rect.width, height = plane.rect.height
  if (!(width > 0 && height > 0 && depth >= 0) || ![width, height, depth].every(Number.isFinite)) return null
  const outline: Array<[number, number]> = []
  if (plane.node.kind === 'ellipse') {
    // Tangent polygon encloses the rendered cylinder. Cardinal tangent faces
    // are exact; intermediate angles are conservatively within 0.5% of radius.
    const factor = 1 / Math.cos(Math.PI / CYLINDER_SIDES)
    for (let i = 0; i < CYLINDER_SIDES; i++) {
      const angle = (i + 0.5) * Math.PI * 2 / CYLINDER_SIDES
      outline.push([Math.cos(angle) * width / 2 * factor, Math.sin(angle) * height / 2 * factor])
    }
  } else {
    // Rounded rectangles retain a conservative box so their corner rounding
    // cannot permit hidden overlap while resizing through square corners.
    outline.push([-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2])
  }
  const matrix = new Matrix4().fromArray(extrusionWorldMatrix(plane))
  const vertices = [0, depth].flatMap(z => outline.map(([x, y]) => new Vector3(x, y, z).applyMatrix4(matrix)))
  if (!vertices.every(finite)) return null
  const up = new Vector3(0, 0, 1).transformDirection(matrix)
  const normals: Vector3[] = [], edges: Vector3[] = []
  addAxis(normals, up.clone())
  addAxis(edges, up.clone())
  for (let i = 0; i < outline.length; i++) {
    const edge = vertices[(i + 1) % outline.length]!.clone().sub(vertices[i]!)
    addAxis(edges, edge.clone())
    addAxis(normals, edge.cross(up))
  }
  if (normals.length < 3) return null
  return { nodeId: plane.nodeId, protected: !!protectionOwner, protectionOwner, vertices, normals, edges, bounds: boundsFor(vertices), volume: depth > CONTACT_EPSILON }
}

function belongsToSelection(id: NodeId, selected: ReadonlySet<NodeId>, nodes: ReadonlyMap<NodeId, Node>): boolean {
  const visited = new Set<NodeId>()
  let current: NodeId | null = id
  while (current && !visited.has(current)) {
    if (selected.has(current)) return true
    visited.add(current)
    current = nodes.get(current)?.parent ?? null
  }
  return false
}
function protectedByAncestor(id: NodeId, nodes: ReadonlyMap<NodeId, Node>): NodeId | null {
  let owner: NodeId | null = null
  const visited = new Set<NodeId>()
  let current: NodeId | null = id
  while (current && !visited.has(current)) {
    visited.add(current)
    const node = nodes.get(current)
    if (node?.preventOverlap) owner = current
    current = node?.parent ?? null
  }
  return owner
}

function protectedPair(a: Collider, b: Collider): boolean {
  // A protected frame is one asset: internal parts may intersect each other.
  return (a.protected || b.protected) && (!a.protectionOwner || a.protectionOwner !== b.protectionOwner)
}

/** Capture this once at pointer-down. No scene writes or playback constraints. */
export function createSolidPlacementSession(
  planes: readonly Plane3D[], selectedIds: ReadonlySet<NodeId> | readonly NodeId[], nodesById?: ReadonlyMap<NodeId, Node>,
): SolidPlacementSession {
  const nodes = nodesById ?? new Map(planes.map(plane => [plane.nodeId, plane.node]))
  const selected = new Set(selectedIds), moving: Collider[] = [], obstacles: Collider[] = []
  for (const plane of planes) {
    const moves = belongsToSelection(plane.nodeId, selected, nodes)
    const collider = colliderFor(plane, protectedByAncestor(plane.nodeId, nodes), moves)
    if (collider) (moves ? moving : obstacles).push(collider)
  }
  const bounds = boundsFor(moving.flatMap(body => body.vertices))
  const anchor = moving.length ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: bounds.max.z } : { x: 0, y: 0, z: 0 }
  return { moving, obstacles, movingIds: new Set(moving.map(body => body.nodeId)), anchor,
    hasProtectedPairs: !!moving.length && !!obstacles.length && (moving.some(body => body.protected) || obstacles.some(body => body.protected)) }
}

export function snapSolidWorldPoint(point: Vec3, spacing = 32, axes: readonly SolidGridAxis[] = AXES): Vec3 {
  if (!finite(point)) return { ...point }
  const step = Number.isFinite(spacing) ? Math.max(1, Math.min(100000, spacing)) : 32
  const next = { ...point }
  for (const axis of axes) next[axis] = Math.round(point[axis] / step) * step
  return next
}

function collisionAxes(a: Collider, b: Collider, extra?: Collider): Vector3[] {
  const axes: Vector3[] = []
  for (const normal of [...a.normals, ...b.normals, ...(extra?.normals ?? [])]) addAxis(axes, normal.clone())
  for (const edgeA of [...a.edges, ...(extra?.edges ?? [])]) {
    for (const edgeB of b.edges) addAxis(axes, new Vector3().crossVectors(edgeA, edgeB))
  }
  return axes
}
function projection(vertices: readonly Vec3[], axis: Vector3): [number, number] {
  let min = Infinity, max = -Infinity
  for (const p of vertices) { const distance = p.x * axis.x + p.y * axis.y + p.z * axis.z; min = Math.min(min, distance); max = Math.max(max, distance) }
  return [min, max]
}
function intersects(a: Collider, b: Collider, axes = collisionAxes(a, b)): boolean {
  if (!a.volume || !b.volume || !boundsOverlap(a.bounds, b.bounds)) return false
  return axes.every(axis => { const [amin, amax] = projection(a.vertices, axis), [bmin, bmax] = projection(b.vertices, axis); return amax - bmin > CONTACT_EPSILON && bmax - amin > CONTACT_EPSILON })
}

/** Exact swept SAT for the translated convex prisms, including fast drags. */
function translationContact(a: Collider, b: Collider, delta: Vec3): number {
  const axes = collisionAxes(a, b)
  // Existing intersecting asset pairs can move apart rather than trapping a
  // document imported with overlaps. Newly encountered pairs still constrain.
  if (intersects(a, b, axes)) return 1
  let entry = 0, exit = 1
  for (const axis of axes) {
    const [amin, amax] = projection(a.vertices, axis), [bmin, bmax] = projection(b.vertices, axis)
    const velocity = axis.x * delta.x + axis.y * delta.y + axis.z * delta.z
    if (Math.abs(velocity) < 1e-10) {
      if (amax <= bmin + CONTACT_EPSILON || amin >= bmax - CONTACT_EPSILON) return 1
      continue
    }
    const first = (bmin - amax) / velocity, last = (bmax - amin) / velocity
    entry = Math.max(entry, Math.min(first, last))
    exit = Math.min(exit, Math.max(first, last))
    if (entry >= exit - TIME_EPSILON) return 1
  }
  return entry >= 0 && entry < 1 && exit > 0 ? Math.max(0, entry) : 1
}

export function constrainSolidTranslation(session: SolidPlacementSession, requestedDelta: Vec3, options: SolidTranslationOptions = {}): SolidTranslationResult {
  if (!finite(requestedDelta)) return { delta: { x: 0, y: 0, z: 0 }, fraction: 0, blocked: true, snapped: false }
  let delta = { ...requestedDelta }, snapped = false
  if (!options.bypass && options.snapToGrid && session.moving.length) {
    const target = { x: session.anchor.x + delta.x, y: session.anchor.y + delta.y, z: session.anchor.z + delta.z }
    const next = snapSolidWorldPoint(target, options.gridSize, options.axes ?? ['x', 'y'])
    delta = { x: next.x - session.anchor.x, y: next.y - session.anchor.y, z: next.z - session.anchor.z }
    snapped = AXES.some(axis => Math.abs(delta[axis] - requestedDelta[axis]) > 1e-7)
  }
  let fraction = 1
  if (!options.bypass && session.hasProtectedPairs) {
    for (const body of session.moving) for (const obstacle of session.obstacles) {
      if (!protectedPair(body, obstacle) || !body.volume) continue
      const end = body.vertices.map(vertex => ({ x: vertex.x + delta.x, y: vertex.y + delta.y, z: vertex.z + delta.z }))
      if (!boundsOverlap(boundsFor([...body.vertices, ...end]), obstacle.bounds)) continue
      fraction = Math.min(fraction, translationContact(body, obstacle, delta))
    }
  }
  return { delta: { x: delta.x * fraction, y: delta.y * fraction, z: delta.z * fraction }, fraction, blocked: fraction < 1 - TIME_EPSILON, snapped }
}

/**
 * Conservative continuous collision for face resizing. Corresponding convex
 * prism vertices move linearly; interval hulls exclude impossible contacts.
 * Subdivision finds the first remaining interval, even if the end clears an
 * obstacle. Orientation must stay fixed during a face gesture.
 */
function resizeContact(a: Collider, end: Collider, obstacle: Collider): number {
  const axes = collisionAxes(a, obstacle, end)
  if (intersects(a, obstacle, axes)) return 1
  if (a.vertices.length !== end.vertices.length) return 0
  const obstacleIntervals = axes.map(axis => projection(obstacle.vertices, axis))
  const starts = axes.map(axis => a.vertices.map(vertex => vertex.dot(axis)))
  const velocities = axes.map((axis, index) => end.vertices.map((vertex, vertexIndex) => vertex.dot(axis) - starts[index]![vertexIndex]!))
  const possible = (from: number, to: number): boolean => {
    for (let index = 0; index < axes.length; index++) {
      let min = Infinity, max = -Infinity
      for (let vertex = 0; vertex < a.vertices.length; vertex++) {
        const atStart = starts[index]![vertex]! + velocities[index]![vertex]! * from
        const atEnd = starts[index]![vertex]! + velocities[index]![vertex]! * to
        min = Math.min(min, atStart, atEnd); max = Math.max(max, atStart, atEnd)
      }
      const [obstacleMin, obstacleMax] = obstacleIntervals[index]!
      if (max <= obstacleMin + CONTACT_EPSILON || min >= obstacleMax - CONTACT_EPSILON) return false
    }
    return true
  }
  let intervals = 0
  const firstContact = (from: number, to: number, depth: number): number => {
    if (!possible(from, to)) return 1
    // Guard worst-case precision work without allowing an uncertain contact.
    if (to - from <= TIME_EPSILON || depth >= 24 || ++intervals > 2048) return from
    const middle = (from + to) / 2
    const left = firstContact(from, middle, depth + 1)
    return left < 1 ? left : firstContact(middle, to, depth + 1)
  }
  return firstContact(0, 1, 0)
}

export function constrainSolidResize(
  session: SolidPlacementSession, candidatePlanes: readonly Plane3D[], options: { bypass?: boolean } = {},
): { fraction: number; blocked: boolean } {
  if (options.bypass || !session.hasProtectedPairs) return { fraction: 1, blocked: false }
  const candidates = new Map(candidatePlanes.map(plane => [plane.nodeId, plane]))
  let fraction = 1
  for (const body of session.moving) {
    const plane = candidates.get(body.nodeId)
    if (!plane) continue
    const candidate = colliderFor(plane, body.protectionOwner, true)
    if (!candidate) continue
    const sweep = boundsFor([...body.vertices, ...candidate.vertices])
    for (const obstacle of session.obstacles) {
      if (!protectedPair(body, obstacle) || !boundsOverlap(sweep, obstacle.bounds)) continue
      fraction = Math.min(fraction, resizeContact(body, candidate, obstacle))
    }
  }
  return { fraction, blocked: fraction < 1 - TIME_EPSILON }
}
