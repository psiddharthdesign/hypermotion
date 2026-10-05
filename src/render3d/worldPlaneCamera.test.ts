// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { getAnimEngine, type AnimatedValue } from '@/anim'
import { createSceneAPI } from '@/scene/doc'
import { createArrangement } from '@/scene/arrangementActions'
import { DEFAULT_FLOW_CONNECTION } from '@/scene/flowConnection'
import { mergeCameraAnimationPreview } from '@/ui/cameraPreviewStore'
import { createWorldPlaneAnimationSelector } from './planeAnimationSnapshot'
import { buildWorldPlanes, cameraBasis, createPlaneBuildContext, resolveCamera3D, type Plane3D, type ResolvedCamera3D } from './scene3d'
import { resolveFlowConnections } from './flowConnections'
import { createWorldPlaneCameraSelector, hasCameraFacingArrangements } from './worldPlaneCamera'

const viewport = { width: 960, height: 540 }
function fixture(projection: '2d' | 'perspective' | 'orthographic' = 'perspective') {
  const api = createSceneAPI()
  api.setMeta({ canvas: viewport, duration: 4, frameRate: 60 })
  const root = api.createNode('frame', null, { size: viewport, clipsContent: false })
  const group = api.createNode('frame', root, { size: { width: 160, height: 120 }, clipsContent: false, transform: { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotation: 0, scaleX: 1, scaleY: 1, renderMode: 'group3d' } })
  const child = api.createNode('rect', group, { size: { width: 40, height: 32 }, extrusion: { depth: 24, sideColor: '#2563eb' } })
  const target = api.createNode('rect', root, { size: { width: 72, height: 72 } })
  const layout = { [root]: { x: 0, y: 0, ...viewport }, [group]: { x: 200, y: 200, width: 160, height: 120 }, [child]: { x: 220, y: 212, width: 40, height: 32 }, [target]: { x: 680, y: 200, width: 72, height: 72 } }
  const arrangement = createArrangement(api, [group], layout)!
  api.setNodeProperty(arrangement, 'arrangement', { ...api.getNode(arrangement)!.arrangement!, mode: 'radial', radius: 160, rotationX: 25, rotationY: 15, orientation: 'screen' })
  const cameraId = api.getActiveCamera()!.id
  api.setNodeProperty(cameraId, 'projection', projection)
  api.setNodeProperty(cameraId, 'transform', { ...api.getActiveCamera()!.transform, x: 480, y: 270, rotationX: 13.2526, rotationY: -64.0601, rotation: 30 })
  const camera = api.getActiveCamera()!
  const context = createPlaneBuildContext(api)
  const reference = resolveCamera3D(camera, undefined, viewport)
  const selectCamera = createWorldPlaneCameraSelector()
  const selectAnimation = createWorldPlaneAnimationSelector()
  const render = (snapshot: Record<string, AnimatedValue>) => {
    const animation = selectAnimation(snapshot, context.nodesById)
    const live = resolveCamera3D(camera, snapshot[cameraId], viewport)
    const selected = selectCamera(reference, live, hasCameraFacingArrangements(context.nodesById, animation))
    const planes = buildWorldPlanes(api, layout, animation, selected, { context, independentNodes: true })
    return { planes, live, selected }
  }
  return { api, root, group, child, target, arrangement, layout, cameraId, camera, context, reference, render }
}
function expectFacing(plane: Plane3D, camera: ResolvedCamera3D) {
  const basis = cameraBasis(camera)
  for (const component of ['x', 'y', 'z'] as const) {
    expect(plane.right[component]).toBeCloseTo(basis.right[component], 8)
    expect(plane.down[component]).toBeCloseTo(basis.down[component], 8)
  }
}
afterEach(() => getAnimEngine().pause())

describe('live camera selection for arrangement world planes', () => {
  it.each(['2d', 'perspective', 'orthographic'] as const)('follows every intermediate XYZ camera keyframe in %s projection', projection => {
    const f = fixture(projection)
    const times = [0, 0.5392, 1.0054, 2.0066, 2.5407, 2.9756, 3.5428]
    const values = { rotationX: [0, 0, -6.536, -6.536, 13.2526, 13.2526, 0], rotationY: [0, 0, 51.681, 51.681, -64.0601, -64.0601, 0], rotation: [0, 0, 45, 45, -25, -25, 0] }
    for (const property of ['rotationX', 'rotationY', 'rotation'] as const) f.api.setTrack({
      id: property, nodeId: f.cameraId, propertyId: `transform.${property}`, defaultEasing: 'linear',
      keyframes: times.map((time, index) => ({ id: `${property}-${index}`, time, value: values[property][index]! })),
    })
    const engine = getAnimEngine()
    engine.attach(f.api)
    let center: Plane3D['center'] | undefined
    for (const time of [0, 0.25, 0.8, 1.5, 2.3, 2.8, 3.2, 3.5428]) {
      engine.seek(time)
      const { planes, live } = f.render(engine.getSnapshot())
      const member = planes.find(plane => plane.nodeId === f.group)!
      expectFacing(member, live)
      center ??= member.center
      expect(member.center.x).toBeCloseTo(center.x, 8)
      expect(member.center.y).toBeCloseTo(center.y, 8)
      expect(member.center.z).toBeCloseTo(center.z, 8)
    }
  })

  it('uses camera preview overrides and a transformed camera rig instead of authored Euler values', () => {
    const f = fixture('2d')
    const preview = mergeCameraAnimationPreview({ rotationX: 0, rotationY: 0, rotation: 0 }, { rotationX: 22, rotationY: -34, rotation: 61 })!
    preview.parentMatrix = new Matrix4().makeRotationY(0.45).premultiply(new Matrix4().makeTranslation(40, -30, 10)).toArray()
    const { planes, live } = f.render({ [f.cameraId]: preview })
    expectFacing(planes.find(plane => plane.nodeId === f.group)!, live)
    expect(cameraBasis(live)).not.toEqual(cameraBasis(f.reference))
  })

  it('preserves camera-independent and focus-only geometry caches', () => {
    const f = fixture()
    const select = createWorldPlaneCameraSelector()
    const live = resolveCamera3D(f.camera, { rotationX: 20, rotationY: 35 }, viewport)
    expect(select(f.reference, live, false)).toBe(f.reference)
    const first = select(f.reference, live, true)
    const changedFocus = resolveCamera3D({ ...f.camera, focusMode: 'spatial', bloomEnabled: true }, {
      rotationX: 20, rotationY: 35, focusPlaneX: 220, focusPlaneY: 380, focusPlaneZ: -120,
      focusPlaneRotationX: 28, focusPlaneRotationY: 15, bloomStrength: 2,
    }, viewport)
    expect(select(f.reference, changedFocus, true)).toBe(first)
    const movedPoi = { ...changedFocus, pointOfInterest: { ...changedFocus.pointOfInterest, x: 610 } }
    expect(select(f.reference, movedPoi, true)).toBe(movedPoi)
    expect(select(f.reference, movedPoi, false)).toBe(f.reference)
  })

  it('uses the animated facing choice when entering or leaving Face camera', () => {
    const f = fixture()
    const snapshot = { [f.cameraId]: { rotationY: 20 }, [f.arrangement]: { arrangement: { orientation: 'forward' as const } } }
    expect(f.render(snapshot).selected).toBe(f.reference)
    const facing = f.render({ ...snapshot, [f.arrangement]: { arrangement: { orientation: 'screen' } } })
    expectFacing(facing.planes.find(plane => plane.nodeId === f.group)!, facing.live)
    expect(facing.selected).not.toBe(f.reference)
    expect(f.render(snapshot).selected).toBe(f.reference)
  })

  it('resolves descendant focus positions and connection ports separately for each dissolve camera', () => {
    const f = fixture('orthographic')
    const connection = f.api.createNode('vector', f.root, { size: { width: 1, height: 1 }, connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: f.child, targetId: f.target } })
    const layout = { ...f.layout, [connection]: { x: 0, y: 0, width: 1, height: 1 } }
    const context = createPlaneBuildContext(f.api)
    const incoming = resolveCamera3D(f.camera, { rotationX: 30, rotationY: 42, rotation: 120 }, viewport)
    const outgoing = resolveCamera3D(f.camera, { rotationX: -20, rotationY: -45, rotation: -80 }, viewport)
    const pass = (camera: ResolvedCamera3D) => {
      const planes = buildWorldPlanes(f.api, layout, {}, camera, { context, independentNodes: true })
      expectFacing(planes.find(plane => plane.nodeId === f.group)!, camera)
      const child = planes.find(plane => plane.nodeId === f.child)!
      const focusCamera = resolveCamera3D({ ...f.camera, focusMode: 'target' }, undefined, viewport, child.center)
      const flows = resolveFlowConnections(context.nodesById, planes, {})
      return { child, focusCamera, flows }
    }
    const a = pass(incoming), b = pass(outgoing)
    expect(new Vector3(a.child.center.x, a.child.center.y, a.child.center.z).distanceTo(new Vector3(b.child.center.x, b.child.center.y, b.child.center.z))).toBeGreaterThan(1)
    expect(a.flows).toHaveLength(1)
    expect(b.flows).toHaveLength(1)
    expect(a.flows[0]).not.toEqual(b.flows[0])
    expect(a.focusCamera.focusWorld).not.toEqual(b.focusCamera.focusWorld)
  })
})
