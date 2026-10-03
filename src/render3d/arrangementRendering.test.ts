// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { Box3, Matrix4, Object3D, Vector3 } from 'three'
import { getAnimEngine, type AnimatedValue } from '@/anim'
import { createSceneAPI } from '@/scene/doc'
import { createArrangement } from '@/scene/arrangementActions'
import { arrangementSlots, animatedArrangement } from '@/scene/arrangement'
import { createNullResolver } from '@/scene/nullObject'
import { DEFAULT_FLOW_CONNECTION } from '@/scene/flowConnection'
import { resolveCameraDomProjection } from '@/render/cameraDomProjection'
import { buildWorldPlanes, cameraBasis, createPlaneBuildContext, hitTestPlanes, projectWorldPoint, resolveCamera3D, viewportPointToRay, type Plane3D } from './scene3d'
import { extrusionWorldMatrix } from './extrusionScene'
import { flowAssetBounds, resolveFlowConnections } from './flowConnections'
import { applyNullPlaneMatrix } from './nullPlaneMatrix'
import { clipContainsPoint } from './planeClipping'
import { createThreeCamera, syncThreeCamera } from './threeCamera'
import { createWorldPlaneAnimationSelector } from './planeAnimationSnapshot'

const viewport = { width: 960, height: 540 }
const matrix = (plane: Plane3D) => new Matrix4().fromArray(extrusionWorldMatrix(plane))
const vector = (point: { x: number; y: number; z: number }) => new Vector3(point.x, point.y, point.z)
const expectVector = (actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 7)
  expect(actual.y).toBeCloseTo(expected.y, 7)
  expect(actual.z).toBeCloseTo(expected.z, 7)
}
const expectMatrix = (actual: Matrix4, expected: Matrix4) => actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index]!, 7))

function fixture() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: viewport, clipsContent: false })
  const transform = { x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 }
  const group = api.createNode('frame', root, { size: { width: 160, height: 120 }, clipsContent: false, transform: { ...transform, renderMode: 'group3d' } })
  const solid = api.createNode('rect', group, { size: { width: 100, height: 60 }, extrusion: { depth: 80, sideColor: '#2563eb' }, transform: { ...transform, z: -80, rotation: 15 } })
  const hidden = api.createNode('ellipse', group, { visible: false, size: { width: 40, height: 40 }, extrusion: { depth: 20, sideColor: '#2563eb' } })
  const target = api.createNode('ellipse', root, { size: { width: 80, height: 80 }, extrusion: { depth: 40, sideColor: '#2563eb' } })
  const layout = { [root]: { x: 0, y: 0, ...viewport }, [group]: { x: 100, y: 120, width: 160, height: 120 }, [solid]: { x: 120, y: 130, width: 100, height: 60 }, [hidden]: { x: 100, y: 120, width: 40, height: 40 }, [target]: { x: 650, y: 220, width: 80, height: 80 } }
  const camera = { ...api.getActiveCamera()!, projection: 'orthographic' as const }
  const resolved = resolveCamera3D(camera, { x: 480, y: 270, rotationX: 35.2643897, rotationY: 45, rotation: 120 }, viewport)
  const planes = (animated: Record<string, AnimatedValue> = {}) => buildWorldPlanes(api, layout, animated, resolved)
  return { api, root, group, solid, hidden, target, layout, camera, resolved, planes }
}

afterEach(() => getAnimEngine().pause())

describe('Arrangement rendering with native isometric assets', () => {
  it('carries an entire solid group through a tilted and nonuniformly scaled pattern using one affine basis', () => {
    const { api, group, solid, target, layout, planes } = fixture()
    const before = matrix(planes().find(plane => plane.nodeId === solid)!)
    const controller = createArrangement(api, [group, target], layout)!
    const owner = api.getNode(controller)!
    api.setNodeProperty(controller, 'arrangement', { ...owner.arrangement!, mode: 'radial', radius: 220, rotationX: 55, rotationY: 30, rotation: 20, scaleFront: 1.5 })
    api.setNodeProperty(controller, 'transform', { ...owner.transform, scaleX: 1.8, scaleY: 0.7 })
    const plane = planes().find(plane => plane.nodeId === solid)!
    const delta = createNullResolver(id => api.getNode(id)).delta(api.getNode(group)!)
    const expected = delta.multiply(before)
    expectMatrix(matrix(plane), expected)
    const object = new Object3D()
    expect(applyNullPlaneMatrix(object, plane)).toBe(true)
    expectMatrix(object.matrix, expected)
    expect(object.matrixAutoUpdate).toBe(false)
    // Authoring previews replace the center without mutating the frozen rig basis.
    const movedCenter = vector(plane.center).add(new Vector3(24, -16, 8))
    const preview = { ...plane, center: movedCenter }
    const previewObject = new Object3D()
    applyNullPlaneMatrix(previewObject, preview)
    expectMatrix(matrix(preview), previewObject.matrix)
    expectVector(new Vector3().applyMatrix4(matrix(preview)), movedCenter)
    const bounds = new Box3()
    for (const x of [-50, 50]) for (const y of [-30, 30]) for (const z of [0, 80]) bounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(expected))
    expectVector(flowAssetBounds([plane])!.min, bounds.min)
    expectVector(flowAssetBounds([plane])!.max, bounds.max)
  })

  it('keeps the group center on its orbit and preserves all child geometry when facing an orthographic camera', () => {
    const { api, group, solid, target, layout, resolved, planes } = fixture()
    const baseGroup = matrix(planes().find(plane => plane.nodeId === group)!)
    const baseSolid = matrix(planes().find(plane => plane.nodeId === solid)!)
    // A noncentral authored pivot must not move the arranged center when facing changes.
    const member = api.getNode(group)!
    api.setNodeProperty(group, 'transform', { ...member.transform, anchorX: 0, anchorY: 0 })
    const controller = createArrangement(api, [group, target], layout)!
    const owner = api.getNode(controller)!
    const settings = { ...owner.arrangement!, mode: 'radial' as const, radius: 200, rotationX: 60, rotationY: 30, orientation: 'screen' as const, scaleFront: 1.6 }
    api.setNodeProperty(controller, 'arrangement', settings)
    for (const orbit of [0, 90, 180, 360]) {
      const current = planes({ [controller]: { arrangement: { orbit } } })
      const memberPlane = current.find(plane => plane.nodeId === group)!
      const solidPlane = current.find(plane => plane.nodeId === solid)!
      const slot = arrangementSlots(animatedArrangement(settings, { orbit })).get(group)!
      expectVector(memberPlane.center, slot.position.clone().add(new Vector3(owner.transform.x, owner.transform.y, owner.transform.z)))
      const basis = cameraBasis(resolved)
      expectVector(memberPlane.right, basis.right)
      expectVector(memberPlane.down, basis.down)
      expectVector(new Vector3(0, 0, 1).transformDirection(matrix(memberPlane)), basis.forward)
      expect(matrix(memberPlane).determinant()).toBeGreaterThan(0)
      const groupDelta = matrix(memberPlane).multiply(baseGroup.clone().invert())
      expectMatrix(matrix(solidPlane), groupDelta.multiply(baseSolid))
    }
  })

  it('picks arranged solid surfaces and sheared flat cards at their actual local coordinates', () => {
    const { api, group, solid, target, layout, resolved, planes } = fixture()
    const controller = createArrangement(api, [group, target], layout)!
    const owner = api.getNode(controller)!
    api.setNodeProperty(controller, 'transform', { ...owner.transform, scaleX: 1.8, scaleY: 0.7 })
    api.setNodeProperty(controller, 'arrangement', { ...owner.arrangement!, rotationX: 25, rotationY: 20 })
    for (const depth of [80, 0]) {
      api.setNodeProperty(solid, 'extrusion', { depth, sideColor: '#2563eb' })
      const plane = planes().find(item => item.nodeId === solid)!
      const local = new Vector3(16, -11, 0)
      const world = local.clone().applyMatrix4(matrix(plane))
      const normal = vector(plane.normal)
      const hit = hitTestPlanes([plane], { origin: world.clone().addScaledVector(normal, -1000), direction: normal }, resolved, viewport)!
      expect(hit?.nodeId).toBe(solid)
      expectVector(hit.point, world)
      expect(hit.localX).toBeCloseTo(66)
      expect(hit.localY).toBeCloseTo(19)
      const screen = projectWorldPoint(plane.center, resolved, viewport)
      expect(hitTestPlanes([plane], viewportPointToRay(resolved, screen.x, screen.y, viewport), resolved, viewport)?.nodeId).toBe(solid)
    }
  })

  it('gates group descendants and connections through the Arrangement eye without rewriting member visibility', () => {
    const { api, root, group, solid, hidden, target, layout, resolved } = fixture()
    const controller = createArrangement(api, [group, target], layout)!
    const connection = api.createNode('vector', root, { size: { width: 1, height: 1 }, connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: group, targetId: target } })
    const fullLayout = { ...layout, [connection]: { x: 0, y: 0, width: 1, height: 1 } }
    const render = () => {
      const context = createPlaneBuildContext(api)
      const planes = buildWorldPlanes(api, fullLayout, {}, resolved, { context })
      return { planes, connections: resolveFlowConnections(context.nodesById, planes, {}) }
    }
    expect(render().connections).toHaveLength(1)
    api.setNodeProperty(controller, 'visible', false)
    expect(render().planes.map(plane => plane.nodeId)).not.toContain(solid)
    expect(render().connections).toHaveLength(0)
    expect(api.getNode(solid)!.visible).toBe(true)
    expect(api.getNode(hidden)!.visible).toBe(false)
    api.setNodeProperty(controller, 'visible', true)
    expect(render().planes.map(plane => plane.nodeId)).toContain(solid)
    expect(render().planes.map(plane => plane.nodeId)).not.toContain(hidden)
    expect(render().connections).toHaveLength(1)
  })

  it('animates arrangement opacity once for every member subtree while preserving solid depth keys', () => {
    const { api, group, solid, target, layout, planes } = fixture()
    const controller = createArrangement(api, [group, target], layout)!
    api.setTrack({ id: 'opacity', nodeId: controller, propertyId: 'arrangement.opacity', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 1, value: 1 }] })
    api.setTrack({ id: 'solid-depth', nodeId: solid, propertyId: 'extrusion.depth', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 40 }, { id: 'b', time: 1, value: 120 }] })
    const engine = getAnimEngine(); engine.attach(api); engine.seek(0.25)
    const snapshot = createWorldPlaneAnimationSelector()(engine.getSnapshot())
    const plane = planes(snapshot).find(item => item.nodeId === solid)!
    expect(plane.opacity).toBeCloseTo(0.25)
    expect(plane.extrusion?.depth).toBe(60)
    expect(plane.transformMatrix).toBeDefined()
    expect(snapshot[group]?.parentMatrix).toBeDefined()
  })

  it('clips a sheared arranged frame along its transformed perimeter', () => {
    const { api, group, solid, target, layout, planes } = fixture()
    const node = api.getNode(group)!
    api.setNodeProperty(group, 'clipsContent', true)
    api.setNodeProperty(group, 'transform', { ...node.transform, rotation: 35 })
    const controller = createArrangement(api, [group, target], layout)!
    const owner = api.getNode(controller)!
    api.setNodeProperty(controller, 'transform', { ...owner.transform, scaleX: 2, scaleY: 0.5 })
    const current = planes()
    const memberPlane = current.find(plane => plane.nodeId === group)!
    const solidPlane = current.find(plane => plane.nodeId === solid)!
    const clip = solidPlane.clips![0]!
    expect(clip.outline).toHaveLength(4)
    const world = (x: number, y: number) => new Vector3(x, y, 0).applyMatrix4(matrix(memberPlane))
    expect(clipContainsPoint(clip, world(79, -59))).toBe(true)
    expect(clipContainsPoint(clip, world(-79, 59))).toBe(true)
    expect(clipContainsPoint(clip, world(81, -59))).toBe(false)
    expect(clipContainsPoint(clip, world(-79, 61))).toBe(false)
  })

  it('matches Three and DOM orthographic projection after a Null rig moves the camera', () => {
    const { camera } = fixture()
    const parentMatrix = new Matrix4().makeRotationZ(0.4).multiply(new Matrix4().makeTranslation(100, 200, -90)).toArray()
    const animated = { rotationX: 35.2643897, rotationY: 45, rotation: 120, scaleX: 1.2, parentMatrix }
    const resolved = resolveCamera3D(camera, animated, viewport)
    const three = createThreeCamera('orthographic')
    syncThreeCamera(three, resolved, viewport.width, viewport.height)
    const dom = resolveCameraDomProjection(camera, animated, viewport)
    for (const point of [new Vector3(0, 0, 0), new Vector3(600, 320, -200)]) {
      const expected = projectWorldPoint(point, resolved, viewport)
      const projected = point.clone().project(three)
      const affine = point.clone().applyMatrix4(new Matrix4().fromArray(dom.matrix))
      expect((projected.x + 1) * viewport.width / 2).toBeCloseTo(expected.x)
      expect((1 - projected.y) * viewport.height / 2).toBeCloseTo(expected.y)
      expect(affine.x).toBeCloseTo(expected.x)
      expect(affine.y).toBeCloseTo(expected.y)
    }
  })
})
