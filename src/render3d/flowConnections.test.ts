// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { DEFAULT_FLOW_CONNECTION } from '@/scene/flowConnection'
import type { AnimatedValue } from '@/anim'
import { createIsometricAsset } from '@/ui/isometricAssetAuthoring'
import { solveLayout, yogaReady } from '@/layout/engine'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { buildWorldPlanes, createPlaneBuildContext, hitTestPlanes, resolveCamera3D } from './scene3d'
import { flowPulseDistances, flowRoute, intersectFlowConnection, resolveFlowConnections, roundedFlowCurve } from './flowConnections'
import { FlowConnectionsRenderer } from './flowConnectionsRenderer'

function fixture() {
  const api = createSceneAPI()
  const viewport = { width: 800, height: 600 }
  const root = api.createNode('frame', null, { size: viewport, clipsContent: false })
  const source = api.createNode('rect', root, { size: { width: 100, height: 100 }, extrusion: { depth: 80, sideColor: '#2563eb' } })
  const target = api.createNode('ellipse', root, { size: { width: 100, height: 100 }, extrusion: { depth: 40, sideColor: '#2563eb' } })
  const connection = api.createNode('vector', root, { size: { width: 1, height: 1 }, connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: source, targetId: target } })
  const layout = { [root]: { x: 0, y: 0, ...viewport }, [source]: { x: 50, y: 60, width: 100, height: 100 }, [target]: { x: 500, y: 220, width: 100, height: 100 }, [connection]: { x: 0, y: 0, width: 1, height: 1 } }
  const camera = resolveCamera3D(api.getActiveCamera()!, undefined, viewport)
  const resolve = (animated: Record<string, AnimatedValue> = {}) => {
    const context = createPlaneBuildContext(api)
    const planes = buildWorldPlanes(api, layout, animated, camera, { context, independentNodes: true })
    return { connections: resolveFlowConnections(context.nodesById, planes, animated), planes }
  }
  return { api, root, source, target, connection, layout, camera, viewport, resolve }
}

describe('native attached flow connections', () => {
  it('attaches to actual solid sides near their bases and rounds elbow corners', () => {
    const { resolve } = fixture()
    const c = resolve().connections[0]!
    expect(c.source.toArray()).toEqual([150, 110, 68])
    expect(c.target.x).toBeCloseTo(500)
    expect(c.target.y).toBeCloseTo(270)
    expect(c.target.z).toBeCloseTo(28)
    expect(c.curve.getPointAt(0).distanceTo(c.source)).toBeLessThan(1e-6)
    expect(c.curve.getPointAt(1).distanceTo(c.target)).toBeLessThan(1e-6)
    expect(c.curve.curves.some(curve => curve instanceof THREE.QuadraticBezierCurve3)).toBe(true)
  })
  it('follows animated position, rotation, depth and size changes without rewriting saved connections', () => {
    const { api, source, target, connection, layout, resolve } = fixture()
    const before = resolve().connections[0]!
    const moved = resolve({ [source]: { x: 80, extrusionDepth: 160 }, [target]: { y: 100, rotation: 30 } }).connections[0]!
    expect(moved.source.x).toBeCloseTo(before.source.x + 80)
    expect(moved.source.z).toBeCloseTo(148)
    expect(moved.target.distanceTo(before.target)).toBeGreaterThan(40)
    layout[source]!.width = 160
    expect(resolve().connections[0]!.source.x).toBeCloseTo(210)
    expect(api.getNode(connection)?.connection).toEqual({ ...DEFAULT_FLOW_CONNECTION, sourceId: source, targetId: target })
  })
  it('uses descendants of an asset container and respects parent visibility and opacity', () => {
    const { api, root, source, target, connection, layout, camera } = fixture()
    const group = api.createNode('frame', root, { size: { width: 300, height: 300 }, clipsContent: false })
    api.appendChild(group, source)
    api.setNodeProperty(connection, 'connection', { ...DEFAULT_FLOW_CONNECTION, sourceId: group, targetId: target })
    const resolve = () => { const context = createPlaneBuildContext(api); return resolveFlowConnections(context.nodesById, buildWorldPlanes(api, { ...layout, [group]: { x: 0, y: 0, width: 300, height: 300 } }, {}, camera, { context, independentNodes: true }), {}) }
    expect(resolve()[0]?.source.x).toBeCloseTo(150)
    api.setNodeProperty(group, 'visible', false)
    expect(resolve()).toEqual([])
  })
  it('disappears safely after endpoint deletion and reconnects after undo', () => {
    const { api, target, resolve } = fixture()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    api.doc.transact(() => api.deleteNode(target), UNDOABLE_GESTURE_ORIGIN)
    expect(resolve().connections).toEqual([])
    undo.undo()
    expect(resolve().connections).toHaveLength(1)
    undo.destroy()
  })
  it('picks the visible connection path and never its 1px vector storage rectangle', () => {
    const { connection, camera, viewport, resolve } = fixture()
    const { connections, planes } = resolve()
    const c = connections[0]!, point = c.curve.getPointAt(0.5)
    const ray = { origin: { x: point.x, y: point.y, z: -400 }, direction: { x: 0, y: 0, z: 1 } }
    expect(intersectFlowConnection(c, ray)).not.toBeNull()
    expect(hitTestPlanes(planes, ray, camera, viewport)?.nodeId).toBe(connection)
    expect(hitTestPlanes(planes, { origin: { x: 0.5, y: 0.5, z: -400 }, direction: { x: 0, y: 0, z: 1 } }, camera, viewport)).toBeNull()
  })
  it('uses independent endpoint geometry for nested flat assets while leaving other hits unchanged', () => {
    const { api, root, source, target, connection, layout, camera, viewport } = fixture()
    api.setNodeProperty(source, 'extrusion', undefined)
    api.setNodeProperty(target, 'extrusion', undefined)
    const group = api.createNode('frame', root, { size: { width: 800, height: 600 }, clipsContent: false })
    api.appendChild(group, source)
    api.appendChild(group, target)
    const fullLayout = { ...layout, [group]: { x: 0, y: 0, width: 800, height: 600 } }
    const context = createPlaneBuildContext(api)
    const ordinary = buildWorldPlanes(api, fullLayout, {}, camera, { context })
    const independent = buildWorldPlanes(api, fullLayout, { [connection]: { connectionWidth: 36 } }, camera, { context, independentNodes: true })
    const c = resolveFlowConnections(context.nodesById, independent, {})[0]!
    expect(c.settings.width).toBe(36)
    const point = c.curve.getPointAt(0.5)
    const ray = { origin: { x: point.x, y: point.y, z: -400 }, direction: { x: 0, y: 0, z: 1 } }
    // Restrict ordinary picking to the selected path to isolate the fifth-argument contract.
    expect(hitTestPlanes(ordinary.filter(p => p.nodeId === connection), ray, camera, viewport, independent)?.nodeId).toBe(connection)
  })
  it('picks a connection between real starter groups with normal render planes', async () => {
    const api = createSceneAPI(), viewport = { width: 1200, height: 800 }
    api.createNode('frame', null, { size: viewport, clipsContent: false })
    const source = createIsometricAsset(api, 'block', { center: { x: 220, y: 200 } })
    const target = createIsometricAsset(api, 'platform', { center: { x: 850, y: 450 } })
    const id = api.createNode('vector', api.getRoot(), { size: { width: 1, height: 1 }, connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: source, targetId: target } })
    const layout = solveLayout(await yogaReady, api, api.getRoot(), viewport)
    const camera = resolveCamera3D(api.getActiveCamera()!, undefined, viewport)
    const planes = buildWorldPlanes(api, layout, {}, camera)
    const c = resolveFlowConnections(new Map(api.getAllNodeIds().map(id => [id, api.getNode(id)!])), planes, {})[0]!
    expect(c).toBeDefined()
    const point = c.curve.getPointAt(0.5)
    expect(hitTestPlanes(planes, { origin: { x: point.x, y: point.y, z: -500 }, direction: { x: 0, y: 0, z: 1 } }, camera, viewport)?.nodeId).toBe(id)
  })
  it('produces deterministic flow on seek, reverse, paused and exact-loop times', () => {
    const s = { ...DEFAULT_FLOW_CONNECTION, sourceId: 'a', targetId: 'b' }
    expect(flowPulseDistances(400, s, 0)).toEqual([0, 120, 240, 360])
    expect(flowPulseDistances(400, s, 0.5)).toEqual([60, 180, 300])
    expect(flowPulseDistances(400, s, 1)).toEqual(flowPulseDistances(400, s, 0))
    expect(flowPulseDistances(400, { ...s, flowSpeed: -120 }, 0.25)).toEqual([90, 210, 330])
    expect(flowPulseDistances(400, { ...s, flowEnabled: false }, 10)).toEqual([])
    expect(flowPulseDistances(100000, { ...s, flowSpacing: 8 }, 0).length).toBeLessThanOrEqual(256)
  })
  it('renders native tubes with depth, bounded pulses, live keyframed width and disposal', () => {
    const { resolve, connection } = fixture(), scene = new THREE.Scene(), renderer = new FlowConnectionsRenderer()
    const connections = resolve({ [connection]: { connectionWidth: 12, connectionFlowSpeed: 40, connectionFlowPhase: 0.5 } }).connections
    expect(connections[0]!.settings).toMatchObject({ width: 12, flowSpeed: 40, flowPhase: 0.5 })
    renderer.sync(scene, connections, 0.5)
    const group = scene.children[0]!, line = group.children[0] as THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>
    expect(line.geometry.parameters.radius).toBe(6)
    expect(line.material.depthTest).toBe(true)
    expect((group.children[1] as THREE.InstancedMesh).count).toBeGreaterThan(0)
    const geometry = line.geometry
    let disposed = false
    geometry.addEventListener('dispose', () => { disposed = true })
    renderer.sync(scene, [], 1)
    expect(scene.children).toEqual([])
    expect(disposed).toBe(true)
    renderer.dispose()
  })
  it('supports direct paths and handles coincident endpoints without invalid geometry', () => {
    const a = new THREE.Vector3(1, 2, 3), b = new THREE.Vector3(10, 30, 9)
    expect(flowRoute(a, b, 'straight')).toEqual([a, b])
    expect(roundedFlowCurve(flowRoute(a, b, 'straight')).getLength()).toBeCloseTo(a.distanceTo(b))
    expect(roundedFlowCurve(flowRoute(a, a, 'elbow')).curves).toEqual([])
  })
})
