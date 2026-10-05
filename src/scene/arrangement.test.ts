// SPDX-License-Identifier: Apache-2.0
import { getProjectAPI } from '@/project/doc'
import { exportCompositionToHypeBytes, importScenesFromHypeBytes } from '@/project/sceneTransfer'
import { DEFAULT_FLOW_CONNECTION } from './flowConnection'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { createWorldPlaneAnimationSelector } from '@/render3d/planeAnimationSnapshot'
import * as Y from 'yjs'
import { afterEach, describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createSceneAPI } from './doc'
import { defaultArrangement, arrangementSlots, normalizeArrangement } from './arrangement'
import { addArrangementBlueSquares, createArrangement, duplicateArrangement, dissolveArrangement, removeArrangementMember, addArrangementMembers, arrangementMemberCandidates } from './arrangementActions'
import { solveLayout, yogaReady } from '@/layout/engine'
import { buildWorldPlanes, resolveCamera3D } from '@/render3d/scene3d'
import { getAnimEngine } from '@/anim'
import { applyBytesToScene, applyJsonToScene, sceneToBytes, sceneToJson } from './file'

async function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const ids = Array.from({ length: 4 }, (_, i) => api.createNode('rect', root, { name: `Layer ${i + 1}`, size: { width: 80, height: 40 } }))
  const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
  const controller = createArrangement(api, ids, layout)!
  const planes = (animated = {}) => buildWorldPlanes(api, layout, animated, resolveCamera3D(api.getActiveCamera()!, undefined, api.getMeta().canvas))
  return { api, root, ids, layout, controller, planes }
}
afterEach(() => getAnimEngine().pause())
describe('native arrangements', () => {
  it('saves and restores fixed card facing without turning slot axes with the pattern', () => {
    const settings = normalizeArrangement({ ...defaultArrangement('radial'), memberIds: ['card'], orientation: 'fixed', rotationX: 65, rotationY: 35, rotation: 20 })!
    expect(normalizeArrangement(JSON.parse(JSON.stringify(settings)))?.orientation).toBe('fixed')
    const slot = arrangementSlots(settings).get('card')!
    expect(new Vector3(1, 0, 0).transformDirection(slot.matrix).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-8)
    expect(Math.abs(slot.position.z)).toBeGreaterThan(1)
  })

  it('excludes attached flow lines from member selection without changing their endpoints', async () => {
    const { api, root, ids, controller } = await setup()
    const flow = api.createNode('vector', root, { connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: ids[0]!, targetId: ids[1]! } })
    expect(arrangementMemberCandidates(api).some(node => node.id === flow)).toBe(false)
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    addArrangementMembers(api, controller, [flow], layout)
    expect(api.getNode(controller)!.arrangement!.memberIds).toEqual(ids)
    expect(api.getNode(flow)?.transformParent).toBeNull()
    expect(api.getNode(flow)?.connection?.sourceId).toBe(ids[0])
  })

  it('duplicates an arranged solid assembly with its internal flow attached to the copied parts', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const assembly = api.createNode('frame', root, { name: 'Assembly', position: 'absolute', size: { width: 200, height: 160 } })
    api.setNodeProperty(assembly, 'transform', { ...api.getNode(assembly)!.transform, renderMode: 'group3d' })
    const body = api.createNode('rect', assembly, { name: 'Body', extrusion: { depth: 80, sideColor: '#2563eb' } })
    const port = api.createNode('ellipse', assembly, { name: 'Port', extrusion: { depth: 24, sideColor: '#2563eb' } })
    api.createNode('vector', assembly, { name: 'Flow', connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: body, targetId: port } })
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    const controller = createArrangement(api, [assembly], layout)!
    const copied = duplicateArrangement(api, controller)!
    const copiedAssembly = api.getNode(copied)!.arrangement!.memberIds[0]!
    const children = api.getChildren(copiedAssembly)
    const copiedBody = children.find(node => node.name === 'Body copy')!
    const copiedPort = children.find(node => node.name === 'Port copy')!
    const copiedFlow = children.find(node => node.name === 'Flow copy')!
    expect(copiedBody.id).not.toBe(body)
    expect(copiedPort.id).not.toBe(port)
    expect(copiedBody.extrusion).toEqual(api.getNode(body)!.extrusion)
    expect(copiedFlow.connection).toMatchObject({ sourceId: copiedBody.id, targetId: copiedPort.id })
    expect(api.getNode(copiedAssembly)!.transformParent!.nodeId).toBe(copied)
  })

  it('transfers arrangements together with isometric solids, flow links, camera focus, and their keyframes', async () => {
    const { api, controller, ids, root } = await setup()
    api.setNodeProperty(ids[0]!, 'extrusion', { depth: 96, sideColor: '#2563eb' })
    api.createNode('vector', root, { name: 'Attached flow', connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: ids[0]!, targetId: ids[1]! } })
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'projection', 'orthographic')
    api.setNodeProperty(camera.id, 'focusMode', 'spatial')
    api.setNodeProperty(camera.id, 'focusPlaneRotationX', 35)
    api.setTrack({ id: 'orbit-transfer', nodeId: controller, propertyId: 'arrangement.orbit', defaultEasing: 'linear', keyframes: [{ id: 'start', time: 0, value: 0 }, { id: 'end', time: 2, value: 360 }] })
    const project = getProjectAPI(api)
    project.ensureInitialized()
    const bytes = exportCompositionToHypeBytes(project, project.getActiveScene()!.id)
    const target = createSceneAPI()
    target.createNode('frame', null)
    const targetProject = getProjectAPI(target)
    targetProject.ensureInitialized()
    importScenesFromHypeBytes(targetProject, bytes)
    const copy = target.getAllNodeIds().map(id => target.getNode(id)!).find(node => node.kind === 'arrangement')!
    const members = copy.arrangement!.memberIds
    expect(members).toHaveLength(ids.length)
    expect(members.every(id => !ids.includes(id))).toBe(true)
    for (const id of members) expect(target.getNode(id)!.transformParent!.nodeId).toBe(copy.id)
    expect(target.getNode(members[0]!)!.extrusion).toEqual(api.getNode(ids[0]!)!.extrusion)
    const copiedFlow = target.getAllNodeIds().map(id => target.getNode(id)!).find(node => node.name === 'Attached flow')!
    expect(copiedFlow.connection).toMatchObject({ sourceId: members[0], targetId: members[1] })
    const importedCamera = target.getAllNodeIds().map(id => target.getNode(id)!).find(node => node.kind === 'camera' && node.projection === 'orthographic')!
    expect(importedCamera).toMatchObject({ focusMode: 'spatial', focusPlaneRotationX: 35 })
    expect(target.getTracksForNode(copy.id)[0]?.keyframes.map(key => key.value)).toEqual([0, 360])
  })

  it('starts with nine centered blue squares and undoes creation together', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const frame = api.getNode(root)!
    if (frame.kind !== 'frame') throw new Error('Expected frame')
    api.setNodeProperty(root, 'layout', { ...frame.layout, mode: 'flex', padding: { top: 24, right: 24, bottom: 24, left: 24 } })
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    const controller = createArrangement(api, [], {})!
    const ids = api.getNode(controller)!.arrangement!.memberIds
    expect(ids).toHaveLength(9)
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    const planes = buildWorldPlanes(api, layout, {}, resolveCamera3D(api.getActiveCamera()!, undefined, api.getMeta().canvas)).filter((p) => ids.includes(p.nodeId))
    expect(planes).toHaveLength(9)
    expect(new Set(planes.map((p) => Math.round(p.center.x))).size).toBe(3)
    expect(new Set(planes.map((p) => Math.round(p.center.y))).size).toBe(3)
    expect(planes.reduce((sum, p) => sum + p.center.x, 0) / 9).toBeCloseTo(api.getMeta().canvas.width / 2)
    expect(planes.reduce((sum, p) => sum + p.center.y, 0) / 9).toBeCloseTo(api.getMeta().canvas.height / 2)
    for (const id of ids) {
      const node = api.getNode(id)!
      expect(node.kind).toBe('rect')
      expect(node.appearance.fill).toEqual({ kind: 'solid', color: '#3B82F6' })
      expect(node.position).toBe('absolute')
    }
    undo.undo()
    expect(api.getNode(controller)).toBeNull()
    expect(ids.every((id) => !api.getNode(id))).toBe(true)
    undo.destroy()
  })
  it('populates existing empty arrangements and respects locking', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const id = api.createNode('arrangement', root, { arrangement: defaultArrangement() })
    api.setNodeProperty(id, 'locked', true)
    expect(addArrangementBlueSquares(api, id)).toEqual([])
    api.setNodeProperty(id, 'locked', false)
    expect(addArrangementBlueSquares(api, id)).toHaveLength(9)
  })
  it('switches pattern choices at keyframes and interpolates matching custom paths', async () => {
    const { api, controller } = await setup()
    const choices = { mode: ['rectangular', 'path'], orientation: ['forward', 'path'], shape: ['ellipse', 'custom'], scaleMode: ['off', 'ripple'] }
    for (const [key, values] of Object.entries(choices)) api.setTrack({ id: key, nodeId: controller, propertyId: `arrangement.${key}` as 'arrangement.mode', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: values[0]! }, { id: 'b', time: 1, value: values[1]! }] })
    const path = defaultArrangement().path
    const end = { ...path, points: path.points.map((p) => ({ ...p, x: p.x * 2, inX: p.inX * 2, outX: p.outX * 2 })) }
    api.setTrack({ id: 'path', nodeId: controller, propertyId: 'arrangement.path', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: path }, { id: 'b', time: 1, value: end }] })
    const engine = getAnimEngine(); engine.attach(api)
    for (const time of [0.5, 1, 0]) {
      engine.seek(time)
      const live = engine.getSnapshot()[controller]!.arrangement!
      for (const [key, values] of Object.entries(choices)) expect(live[key as keyof typeof live]).toBe(values[time >= 1 ? 1 : 0])
      expect(live.path!.points.at(-1)!.x).toBeCloseTo(path.points.at(-1)!.x * (1 + time))
    }
    const doc = new Y.Doc(); applyBytesToScene(doc, sceneToBytes(api.doc))
    expect(createSceneAPI(doc).getTracksForNode(controller)).toEqual(api.getTracksForNode(controller))
  })
  it('moves cards along a fixed tilted ring through keyframed laps with independent facing', async () => {
    const { api, controller, ids, planes } = await setup()
    const arrangement = { ...defaultArrangement('radial'), memberIds: ids, radius: 180, rotationX: 65, rotationY: 35, rotation: 20, orientation: 'screen' as const }
    api.setNodeProperty(controller, 'arrangement', arrangement)
    api.setTrack({ id: 'orbit', nodeId: controller, propertyId: 'arrangement.orbit', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 4, value: 720 }] })
    const tilt = new Quaternion().setFromEuler(new Euler(65 * Math.PI / 180, 35 * Math.PI / 180, 20 * Math.PI / 180, 'ZYX'))
    const center = new Vector3(api.getMeta().canvas.width / 2, api.getMeta().canvas.height / 2, 0)
    const engine = getAnimEngine(); engine.attach(api)
    const initial = planes().find((p) => p.nodeId === ids[0])!
    for (const time of [0, 0.5, 1, 2, 3.5, 4, 0.5]) {
      engine.seek(time)
      const snapshot = createWorldPlaneAnimationSelector()(engine.getSnapshot())
      expect(snapshot[controller]!.arrangement!.orbit).toBe(time * 180)
      const plane = planes(snapshot).find((p) => p.nodeId === ids[0])!
      const local = new Vector3(plane.center.x, plane.center.y, plane.center.z).sub(center).applyQuaternion(tilt.clone().invert())
      const angle = (time * 180 - 90) * Math.PI / 180
      expect(local.z).toBeCloseTo(0)
      expect(local.x).toBeCloseTo(Math.cos(angle) * 180)
      expect(local.y).toBeCloseTo(Math.sin(angle) * 180)
      expect(plane.right).toEqual(initial.right)
    }
    const follow = { ...arrangement, orientation: 'forward' as const }
    const before = arrangementSlots(follow).get(ids[0]!)!
    const after = arrangementSlots({ ...follow, orbit: 90 }).get(ids[0]!)!
    expect(after.position.distanceTo(before.position)).toBeGreaterThan(100)
    expect(new Vector3(0, 0, 1).transformDirection(after.matrix)).toEqual(new Vector3(0, 0, 1).transformDirection(before.matrix))
  })
  it('rotates every pattern around all three axes and carries card headings through the tilt', () => {
    const rotation = new Quaternion().setFromEuler(new Euler(Math.PI / 3, Math.PI / 4, Math.PI / 6, 'ZYX'))
    for (const mode of ['rectangular', 'radial', 'path', 'spherical'] as const) {
      for (const orientation of ['forward', 'center', 'outward', 'path'] as const) {
        const base = { ...defaultArrangement(mode), memberIds: ['a', 'b', 'c', 'd'], orientation }
        const original = arrangementSlots(base)
        const tilted = arrangementSlots({ ...base, rotationX: 60, rotationY: 45, rotation: 30 })
        for (const [id, slot] of tilted) {
          expect(slot.position.distanceTo(original.get(id)!.position.clone().applyQuaternion(rotation))).toBeLessThan(1e-8)
          if (mode !== 'spherical' && orientation !== 'path') {
            const normal = new Vector3(0, 0, 1).transformDirection(slot.matrix)
            expect(normal.distanceTo(new Vector3(0, 0, 1).applyQuaternion(rotation))).toBeLessThan(1e-8)
          }
        }
      }
    }
  })
  it('animates a tilted orbit while cards remain camera-facing in render planes', async () => {
    const { api, controller, ids, planes } = await setup()
    api.setNodeProperty(controller, 'arrangement', { ...defaultArrangement('radial'), memberIds: ids, orientation: 'screen' })
    for (const [axis, value] of [['rotationX', 120], ['rotationY', 90], ['rotation', 60]] as const) {
      api.setTrack({ id: axis, nodeId: controller, propertyId: `arrangement.${axis}`, defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 1, value }] })
    }
    const engine = getAnimEngine(); engine.attach(api)
    const initial = planes().find((p) => p.nodeId === ids[0])!
    for (const time of [0.5, 1, 0]) {
      engine.seek(time)
      const snapshot = createWorldPlaneAnimationSelector()(engine.getSnapshot())
      const plane = planes(snapshot).find((p) => p.nodeId === ids[0])!
      expect(plane.right.x).toBeCloseTo(initial.right.x)
      expect(plane.right.y).toBeCloseTo(initial.right.y)
      expect(plane.right.z).toBeCloseTo(initial.right.z)
      const offset = arrangementSlots({ ...defaultArrangement('radial'), memberIds: ids, rotationX: 120 * time, rotationY: 90 * time, rotation: 60 * time }).get(ids[0]!)!.position
      expect(plane.center.x).toBeCloseTo(api.getMeta().canvas.width / 2 + offset.x)
      expect(plane.center.y).toBeCloseTo(api.getMeta().canvas.height / 2 + offset.y)
      expect(plane.center.z).toBeCloseTo(offset.z)
      if (time === 0.5) expect(Math.abs(plane.center.z - initial.center.z)).toBeGreaterThan(1)
      if (time === 0) expect(plane.center).toEqual(initial.center)
    }
  })
  it('places independent layers around its origin without changing the layer stack', async () => {
    const { api, root, ids, controller, planes } = await setup()
    expect(api.getNode(controller)?.kind).toBe('arrangement')
    expect(api.getNode(controller)?.arrangement?.memberIds).toEqual(ids)
    expect(api.getChildren(root).slice(0, 4).map((n) => n.id)).toEqual(ids)
    const p = planes().find((p) => p.nodeId === ids[0])!
    expect(p.center.x).toBeCloseTo(api.getMeta().canvas.width / 2 - 160)
    expect(p.center.y).toBeCloseTo(api.getMeta().canvas.height / 2 - 80)
    expect(planes().some((p) => p.nodeId === controller)).toBe(false)
  })
  it('has deterministic radial, path, and evenly distributed sphere placements', () => {
    const base = { ...defaultArrangement(), memberIds: ['a', 'b', 'c', 'd'] }
    for (const mode of ['radial', 'path', 'spherical'] as const) {
      const slots = arrangementSlots({ ...base, mode })
      expect(slots.size).toBe(4)
      for (const slot of slots.values()) expect(slot.position.length()).toBeCloseTo(base.radius)
    }
    const a = { ...base, shuffle: 3, randomOffset: 80, seed: 47 }
    expect([...arrangementSlots(a)].map(([id, slot]) => [id, slot.matrix.toArray()])).toEqual([...arrangementSlots(a)].map(([id, slot]) => [id, slot.matrix.toArray()]))
    expect([...arrangementSlots({ ...a, seed: 48 })].map(([id]) => id)).not.toEqual([...arrangementSlots(a)].map(([id]) => id))
  })
  it('handles custom paths, reversed trims, zero radius, empty grids and malformed numeric input', () => {
    expect(arrangementSlots(defaultArrangement()).size).toBe(0)
    const a = normalizeArrangement({ memberIds: ['a', 'b'], mode: 'path', shape: 'custom', radius: NaN, columns: -2, trimStart: 1, trimEnd: 0 })!
    expect(a.columns).toBe(1)
    expect(arrangementSlots(a).get('a')!.position.x).toBeCloseTo(240)
    expect(arrangementSlots(a).get('b')!.position.x).toBeCloseTo(0)
    for (const mode of ['radial', 'spherical'] as const) expect(arrangementSlots({ ...a, mode, radius: 0 }).get('a')!.matrix.elements.every(Number.isFinite)).toBe(true)
  })
  it('focuses a chosen sphere member on the front using fractional shortest rotations', () => {
    const a = { ...defaultArrangement('spherical'), memberIds: ['a', 'b', 'c', 'd'], focusTarget: 3 }
    expect(arrangementSlots(a).get('c')!.position.z).toBeCloseTo(a.radius)
    const intermediate = arrangementSlots({ ...a, focusTarget: 2.5 })
    for (const slot of intermediate.values()) expect(slot.position.length()).toBeCloseTo(a.radius)
  })
  it('evaluates spacing keyframes and retains independent layer animation in preview/export planes', async () => {
    const { api, ids, controller, planes } = await setup()
    api.setTrack({ id: 'spacing', nodeId: controller, propertyId: 'arrangement.spacingX', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 160 }, { id: 'b', time: 1, value: 320 }] })
    api.setTrack({ id: 'layer', nodeId: ids[0]!, propertyId: 'transform.x', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 1, value: 40 }] })
    const engine = getAnimEngine(); engine.attach(api); engine.seek(0.5)
    const a = engine.getSnapshot()
    expect(a[controller]?.arrangement?.spacingX).toBe(240)
    expect(planes(a).find((p) => p.nodeId === ids[0])!.center.x).toBeCloseTo(api.getMeta().canvas.width / 2 - 240 + 20)
  })
  it('preserves animated arrangement opacity through the preview projection', async () => {
    const { api, controller, ids, planes } = await setup()
    api.setTrack({ id: 'opacity', nodeId: controller, propertyId: 'arrangement.opacity', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 1, value: 1 }] })
    const engine = getAnimEngine(); engine.attach(api); engine.seek(0.25)
    const snapshot = createWorldPlaneAnimationSelector()(engine.getSnapshot())
    expect(planes(snapshot).find((p) => p.nodeId === ids[0])!.opacity).toBeCloseTo(0.25)
  })
  it('detaches and dissolves without deleting members or jumping positions', async () => {
    const { api, ids, controller, planes } = await setup()
    const before = planes().find((p) => p.nodeId === ids[0])!.center
    removeArrangementMember(api, controller, ids[0]!)
    expect(planes().find((p) => p.nodeId === ids[0])!.center).toEqual(before)
    dissolveArrangement(api, controller)
    expect(api.getNode(controller)).toBeNull()
    expect(ids.every((id) => api.getNode(id) && !api.getNode(id)!.transformParent)).toBe(true)
  })
  it('dissolves every member at its original pose without compacting the pattern', async () => {
    const { api, ids, controller, planes, layout } = await setup()
    const c = api.getNode(controller)!
    api.setNodeProperty(controller, 'arrangement', { ...c.arrangement!, orientation: 'screen', opacity: 0.4 })
    api.setNodeProperty(controller, 'transform', { ...c.transform, rotationY: 40, rotation: 15 })
    const before = new Map(planes().filter((p) => ids.includes(p.nodeId)).map((p) => [p.nodeId, p]))
    dissolveArrangement(api, controller, {}, layout)
    for (const plane of planes().filter((p) => ids.includes(p.nodeId))) {
      const original = before.get(plane.nodeId)!
      expect(plane.center.x).toBeCloseTo(original.center.x)
      expect(plane.center.y).toBeCloseTo(original.center.y)
      expect(plane.center.z).toBeCloseTo(original.center.z)
      expect(plane.opacity).toBeCloseTo(original.opacity)
      expect(plane.right.x).toBeCloseTo(original.right.x)
      expect(plane.right.z).toBeCloseTo(original.right.z)
    }
  })
  it('cleans membership on layer deletion and handles direct controller deletion', async () => {
    const { api, controller, ids, planes } = await setup()
    api.deleteNode(ids[0]!)
    expect(api.getNode(controller)!.arrangement!.memberIds).toEqual(ids.slice(1))
    const before = planes().find((p) => p.nodeId === ids[1])!
    api.deleteNode(controller)
    expect(planes().find((p) => p.nodeId === ids[1])!.center).toEqual(before.center)
  })
  it('duplicates members, references and tracks without linking the copy to the original', async () => {
    const { api, controller, ids } = await setup()
    const copy = duplicateArrangement(api, controller)!
    const copied = api.getNode(copy)!.arrangement!.memberIds
    expect(copied).toHaveLength(ids.length)
    expect(copied.some((id) => ids.includes(id))).toBe(false)
    for (const id of copied) expect(api.getNode(id)!.transformParent!.nodeId).toBe(copy)
  })
  it('undoes dissolution atomically and remaps arrangements in duplicated compositions', async () => {
    const { api, controller, ids, layout } = await setup()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    dissolveArrangement(api, controller, {}, layout)
    undo.undo()
    expect(api.getNode(controller)!.arrangement!.memberIds).toEqual(ids)
    for (const id of ids) expect(api.getNode(id)!.transformParent!.nodeId).toBe(controller)
    undo.destroy()
    const project = getProjectAPI(api); project.ensureInitialized()
    const copy = project.duplicateScene(project.getActiveScene()!.id)!
    const copied = api.getChildren(copy.rootNodeId).find((node) => node.kind === 'arrangement')!
    expect(copied.arrangement!.memberIds).toHaveLength(4)
    for (const id of copied.arrangement!.memberIds) {
      expect(ids).not.toContain(id)
      expect(api.getNode(id)!.transformParent!.nodeId).toBe(copied.id)
    }
  })
  it('persists native scenes and remaps references on JSON import', async () => {
    const { api, controller } = await setup()
    const doc = new Y.Doc(); applyBytesToScene(doc, sceneToBytes(api.doc)); const restored = createSceneAPI(doc)
    expect(restored.getNode(controller)!.arrangement).toEqual(api.getNode(controller)!.arrangement)
    const json = applyJsonToScene(new Y.Doc(), sceneToJson(api))
    const c = json.getAllNodeIds().map((id) => json.getNode(id)).find((n) => n?.kind === 'arrangement')!
    expect(c.arrangement!.memberIds).toHaveLength(4)
    for (const id of c.arrangement!.memberIds) expect(json.getNode(id)!.transformParent!.nodeId).toBe(c.id)
  })
  it('adds members after creation and keeps opacity multiplicative and camera-facing orientation stable', async () => {
    const { api, root, controller, layout, ids, planes } = await setup()
    const extra = api.createNode('ellipse', root, { size: { width: 40, height: 40 } })
    const solved = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    addArrangementMembers(api, controller, [extra], solved)
    const node = api.getNode(controller)!
    api.setNodeProperty(controller, 'arrangement', { ...node.arrangement!, opacity: 0.5, orientation: 'screen' })
    api.setNodeProperty(controller, 'transform', { ...node.transform, rotationY: 70 })
    const plane = planes().find((p) => p.nodeId === ids[0])!
    expect(plane.opacity).toBeCloseTo(0.5)
    expect(new Vector3(plane.right.x, plane.right.y, plane.right.z).length()).toBeCloseTo(1)
    expect(plane.right.z).toBeCloseTo(0)
    expect(api.getNode(controller)!.arrangement!.memberIds).toContain(extra)
    expect(layout[controller]).toBeUndefined()
  })
})
