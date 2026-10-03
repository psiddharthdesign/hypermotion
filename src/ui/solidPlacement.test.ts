// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { Node, NodeId, Transform } from '@/scene'
import type { Plane3D } from '@/render3d/scene3d'
import { buildWorldPlanes, resolveCamera3D } from '@/render3d/scene3d'
import { constrainSolidResize, constrainSolidTranslation, createSolidPlacementSession, snapSolidWorldPoint } from './solidPlacement'

function fixture() {
  const api = createSceneAPI(), viewport = { width: 2000, height: 1200 }
  const root = api.createNode('frame', null, { size: viewport, clipsContent: false })
  const layout: Record<NodeId, { x: number; y: number; width: number; height: number }> = { [root]: { x: 0, y: 0, ...viewport } }
  const body = (options: { kind?: 'rect' | 'ellipse'; x?: number; y?: number; z?: number; width?: number; height?: number; depth?: number; protect?: boolean; rotation?: Partial<Transform>; parent?: NodeId; visible?: boolean } = {}) => {
    const size = { width: options.width ?? 100, height: options.height ?? 100 }
    const id = api.createNode(options.kind ?? 'rect', options.parent ?? root, { size, visible: options.visible ?? true, preventOverlap: options.protect,
      extrusion: { depth: options.depth ?? 100, sideColor: '#2563eb' } })
    const node = api.getNode(id)!
    api.setNodeProperty(id, 'transform', { ...node.transform, z: options.z ?? 0, ...options.rotation })
    layout[id] = { x: options.x ?? 0, y: options.y ?? 0, ...size }
    return id
  }
  const snapshot = () => {
    const nodes = new Map<NodeId, Node>(api.getAllNodeIds().map(id => [id, api.getNode(id)!]))
    const planes = buildWorldPlanes(api, layout, {}, resolveCamera3D(api.getActiveCamera()!, undefined, viewport), { independentNodes: true })
    return { planes, nodes }
  }
  const session = (ids: readonly NodeId[]) => { const { planes, nodes } = snapshot(); return createSolidPlacementSession(planes, ids, nodes) }
  return { api, root, layout, body, snapshot, session }
}
const delta = (x: number, y = 0, z = 0) => ({ x, y, z })
function resized(plane: Plane3D, width: number, depth = plane.extrusion!.depth): Plane3D {
  return { ...plane, rect: { ...plane.rect, width }, center: { ...plane.center, x: plane.center.x + (width - plane.rect.width) / 2 }, extrusion: { ...plane.extrusion!, depth } }
}

describe('solid manual placement constraints', () => {
  it('leaves normal movement unrestricted until either asset opts into protection', () => {
    for (const [movingProtected, obstacleProtected] of [[false, false], [true, false], [false, true], [true, true]]) {
      const f = fixture(), moving = f.body({ protect: movingProtected })
      f.body({ x: 200, protect: obstacleProtected })
      const result = constrainSolidTranslation(f.session([moving]), delta(180))
      expect(result.delta.x).toBeCloseTo(movingProtected || obstacleProtected ? 100 : 180)
      expect(result.blocked).toBe(movingProtected || obstacleProtected)
    }
  })
  it('snaps absolute world anchor coordinates while preserving unconstrained axes', () => {
    const f = fixture(), moving = f.body({ x: 15, y: 21, z: -100 })
    const session = f.session([moving])
    expect(session.anchor).toEqual({ x: 65, y: 71, z: 0 })
    expect(constrainSolidTranslation(session, delta(22, 20, -17), { snapToGrid: true }).delta).toEqual({ x: 31, y: 25, z: -17 })
    expect(snapSolidWorldPoint({ x: -17, y: 33, z: 48 }, 32)).toEqual({ x: -32, y: 32, z: 64 })
    expect(constrainSolidTranslation(session, delta(22, 20), { snapToGrid: false }).delta).toEqual(delta(22, 20))
  })
  it('stops at contact even when a fast drag ends beyond a thin obstacle', () => {
    const f = fixture(), moving = f.body({ width: 40, protect: true })
    f.body({ x: 180, width: 8 })
    const result = constrainSolidTranslation(f.session([moving]), delta(1200))
    expect(result.delta.x).toBeCloseTo(140)
    expect(result.fraction).toBeCloseTo(140 / 1200)
  })
  it('permits touching, vertical stacking and movement along a touching face', () => {
    const f = fixture(), moving = f.body({ protect: true })
    f.body({ x: 100 })
    expect(constrainSolidTranslation(f.session([moving]), delta(0, 100)).blocked).toBe(false)
    expect(constrainSolidTranslation(f.session([moving]), delta(-100)).blocked).toBe(false)
    expect(constrainSolidTranslation(f.session([moving]), delta(1)).delta.x).toBe(0)
    const stacked = fixture(), top = stacked.body({ z: -100, protect: true })
    stacked.body()
    expect(constrainSolidTranslation(stacked.session([top]), delta(100)).blocked).toBe(false)
    expect(constrainSolidTranslation(stacked.session([top]), delta(0, 0, -60)).blocked).toBe(false)
    expect(constrainSolidTranslation(stacked.session([top]), delta(0, 0, 10)).delta.z).toBe(0)
  })
  it('moves a selected group rigidly, inherits protection, and ignores internal overlaps', () => {
    const f = fixture(), group = f.api.createNode('frame', f.root, { size: { width: 200, height: 150 }, clipsContent: false, preventOverlap: true })
    f.layout[group] = { x: 0, y: 0, width: 200, height: 150 }
    const a = f.body({ parent: group }), b = f.body({ x: 80, parent: group })
    f.body({ x: 300 })
    const session = f.session([group])
    expect([...session.movingIds]).toEqual(expect.arrayContaining([a, b]))
    expect(session.moving).toHaveLength(2)
    const result = constrainSolidTranslation(session, delta(200))
    expect(result.delta.x).toBeCloseTo(120)
    expect(result.blocked).toBe(true)
  })
  it('lets individual parts of one protected assembly overlap but keeps independent protected children separate', () => {
    const f = fixture(), group = f.api.createNode('frame', f.root, { size: { width: 500, height: 300 }, clipsContent: false, preventOverlap: true })
    f.layout[group] = { x: 0, y: 0, width: 500, height: 300 }
    const a = f.body({ parent: group }), b = f.body({ x: 150, parent: group })
    expect(constrainSolidTranslation(f.session([a]), delta(100)).blocked).toBe(false)
    const original = f.snapshot().planes.find(p => p.nodeId === a)!
    expect(constrainSolidResize(f.session([a]), [resized(original, 200)]).blocked).toBe(false)
    f.api.setNodeProperty(group, 'preventOverlap', false)
    f.api.setNodeProperty(b, 'preventOverlap', true)
    expect(constrainSolidTranslation(f.session([a]), delta(100)).delta.x).toBeCloseTo(50)
    expect(constrainSolidResize(f.session([a]), [resized(original, 200)]).fraction).toBeCloseTo(0.5, 5)
  })
  it('lets an imported overlapping pair separate but still stops at a new protected obstacle', () => {
    const f = fixture(), moving = f.body({ protect: true })
    f.body({ x: 50 })
    f.body({ x: 300 })
    expect(constrainSolidTranslation(f.session([moving]), delta(-100)).blocked).toBe(false)
    expect(constrainSolidTranslation(f.session([moving]), delta(500)).delta.x).toBeCloseTo(200)
  })
  it('uses rotated prism axes instead of blocking only because their world bounds overlap', () => {
    const f = fixture(), moving = f.body({ x: 0, y: 0, width: 200, height: 20, rotation: { rotation: 45 }, protect: true })
    f.body({ x: 30, y: -30, width: 200, height: 20, rotation: { rotation: 45 } })
    expect(constrainSolidTranslation(f.session([moving]), delta(20, 20)).blocked).toBe(false)
    const blocked = constrainSolidTranslation(f.session([moving]), delta(80, -80))
    expect(blocked.blocked).toBe(true)
    expect(blocked.fraction).toBeGreaterThan(0)
    expect(blocked.fraction).toBeLessThan(1)
  })
  it('uses cylinder outlines so another solid can pass through empty bounding-box corners', () => {
    const f = fixture(), moving = f.body({ x: -20, y: 82, width: 8, height: 8, protect: true })
    f.body({ kind: 'ellipse', width: 100, height: 100 })
    // A small box at (0,82) is outside the actual circular cross section.
    expect(constrainSolidTranslation(f.session([moving]), delta(20)).blocked).toBe(false)
    expect(constrainSolidTranslation(f.session([moving]), delta(120)).blocked).toBe(true)
  })
  it('includes locked solids but excludes invisible and zero-depth decorative layers', () => {
    const f = fixture(), moving = f.body({ protect: true })
    f.body({ x: 110, visible: false })
    f.body({ x: 130, depth: 0 })
    const obstacle = f.body({ x: 250 })
    f.api.setNodeProperty(obstacle, 'locked', true)
    expect(constrainSolidTranslation(f.session([moving]), delta(400)).delta.x).toBeCloseTo(150)
  })
  it('prioritizes collision over grid placement and bypasses both with Alt', () => {
    const f = fixture(), moving = f.body({ protect: true })
    f.body({ x: 175 })
    const session = f.session([moving]), requested = delta(170)
    expect(constrainSolidTranslation(session, requested, { snapToGrid: true }).delta.x).toBeCloseTo(75)
    expect(constrainSolidTranslation(session, requested, { snapToGrid: true, bypass: true }).delta).toEqual(requested)
  })
  it('limits an outward face resize exactly at first contact', () => {
    const f = fixture(), moving = f.body({ protect: true })
    f.body({ x: 160 })
    const original = f.snapshot().planes.find(p => p.nodeId === moving)!
    const result = constrainSolidResize(f.session([moving]), [resized(original, 220)])
    expect(result.blocked).toBe(true)
    expect(result.fraction).toBeCloseTo(0.5, 5)
    expect(constrainSolidResize(f.session([moving]), [resized(original, 50)]).blocked).toBe(false)
    expect(constrainSolidResize(f.session([moving]), [resized(original, 220)], { bypass: true }).fraction).toBe(1)
  })
  it('constrains extrusion from zero depth and permits growing away from contact', () => {
    const f = fixture(), moving = f.body({ depth: 0, protect: true })
    f.body({ z: 40 })
    const original = f.snapshot().planes.find(p => p.nodeId === moving)!
    const result = constrainSolidResize(f.session([moving]), [resized(original, 100, 100)])
    expect(result.fraction).toBeCloseTo(0.4, 5)
    const away = { ...resized(original, 100, 100), center: { ...original.center, z: -100 } }
    expect(constrainSolidResize(f.session([moving]), [away]).blocked).toBe(false)
  })
  it('constrains cylinder resize against a protected stationary asset', () => {
    const f = fixture(), moving = f.body({ kind: 'ellipse', x: 0 })
    f.body({ x: 160, protect: true })
    const original = f.snapshot().planes.find(p => p.nodeId === moving)!
    expect(constrainSolidResize(f.session([moving]), [resized(original, 220)]).fraction).toBeCloseTo(0.5, 4)
  })
  it('captures immutable geometry for the entire gesture', () => {
    const f = fixture(), moving = f.body({ protect: true }), other = f.body({ x: 200 })
    const session = f.session([moving])
    f.api.setNodeProperty(other, 'visible', false)
    f.layout[other]!.x = 800
    expect(constrainSolidTranslation(session, delta(200)).delta.x).toBeCloseTo(100)
    expect(constrainSolidTranslation(f.session([moving]), delta(200)).blocked).toBe(false)
  })
})
