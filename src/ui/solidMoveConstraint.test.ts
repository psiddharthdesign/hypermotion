// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import { sceneToBytes } from '@/scene/file'
import { solveLayout, yogaReady } from '@/layout/engine'
import { getAnimEngine } from '@/anim/engine'
import { addKeyframe } from '@/anim/tracks'
import { buildWorldPlanes, resolveCamera3D } from '@/render3d/scene3d'
import type { NodeId, Transform } from '@/scene/types'
import { useUI } from '@/state/ui'
import { createIsometricAsset } from './isometricAssetAuthoring'
import { createSolidMoveConstraint } from './solidMoveConstraint'

vi.mock('@/scene/internals', async () => {
  const { createContext } = await import('react')
  return { SceneContext: createContext(null), apiReady: Promise.resolve(null) }
})

const documents: ReturnType<typeof createSceneAPI>[] = []
function scene() {
  const api = createSceneAPI()
  api.setMeta({ canvas: { width: 1600, height: 1000 } })
  const root = api.createNode('frame', null, { size: { width: 1600, height: 1000 }, clipsContent: false })
  documents.push(api)
  const block = (x: number, y: number, parentId = root) => createIsometricAsset(api, 'block', { parentId, center: { x, y } })
  const solve = async () => solveLayout(await yogaReady, api, api.getRoot(), api.getMeta().canvas)
  const camera = () => resolveCamera3D(api.getActiveCamera()!, undefined, api.getMeta().canvas)
  return { api, root, block, solve, camera }
}
function transform(api: SceneAPI, id: NodeId, patch: Partial<Transform>) {
  api.setNodeProperty(id, 'transform', { ...api.getNode(id)!.transform, ...patch })
}
function expectDelta(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 7)
  expect(actual.y).toBeCloseTo(expected.y, 7)
  expect(actual.z).toBeCloseTo(expected.z, 7)
}

beforeEach(() => useUI.setState({ solidGridSnapEnabled: false, solidGridSize: 32, playing: false }))
afterEach(() => {
  getAnimEngine().pause()
  useUI.setState({ solidGridSnapEnabled: false, solidGridSize: 32, playing: false })
  for (const api of documents.splice(0)) api.doc.destroy()
})

describe('manual movement of native isometric assets', () => {
  it('leaves default-off movement unchanged, including motion that crosses another block', async () => {
    const f = scene(), moving = f.block(240, 270)
    f.block(600, 270)
    const constraint = createSolidMoveConstraint(f.api, moving, await f.solve(), {}, f.camera())!
    expect(constraint).toBeTypeOf('function')
    const before = sceneToBytes(f.api.doc)
    expectDelta(constraint({ x: 800, y: 7 }), { x: 800, y: 7, z: 0 })
    expectDelta(constraint({ x: -21, y: 11, z: -33 }), { x: -21, y: 11, z: -33 })
    expect(sceneToBytes(f.api.doc)).toEqual(before)
  })

  it('snaps the asset world center/base to the grid instead of rounding the pointer delta', async () => {
    const f = scene(), moving = f.block(240, 270)
    useUI.setState({ solidGridSnapEnabled: true, solidGridSize: 32 })
    const constraint = createSolidMoveConstraint(f.api, moving, await f.solve(), {}, f.camera())!
    // Target (260,280) snaps to (256,288); the starting center is (240,270).
    expectDelta(constraint({ x: 20, y: 10 }), { x: 16, y: 18, z: 0 })
    expectDelta(constraint({ x: 20, y: 10, z: -17 }), { x: 16, y: 18, z: -32 })
    expectDelta(constraint({ x: 20, y: 10 }, true), { x: 20, y: 10, z: 0 })
    expectDelta(constraint({ x: 20, y: 10 }, false, false), { x: 20, y: 10, z: 0 })
  })

  it('stops an unprotected moving asset at a stationary protected asset', async () => {
    const f = scene(), moving = f.block(240, 270), obstacle = f.block(600, 270)
    f.api.setNodeProperty(obstacle, 'preventOverlap', true)
    const constraint = createSolidMoveConstraint(f.api, moving, await f.solve(), {}, f.camera())!
    // Both blocks are 160px wide: the empty space between them is 200px.
    expectDelta(constraint({ x: 800, y: 0 }), { x: 200, y: 0, z: 0 })
    expectDelta(constraint({ x: 800, y: 0 }, true), { x: 800, y: 0, z: 0 })
    expectDelta(constraint({ x: -800, y: 0 }), { x: -800, y: 0, z: 0 })
  })

  it('converts snapping back through a rotated, nonuniformly scaled parent', async () => {
    const f = scene()
    const parent = f.api.createNode('frame', f.root, { size: { width: 400, height: 400 }, clipsContent: false })
    transform(f.api, parent, { x: 200, y: 120, rotation: 90, scaleX: 2, scaleY: 3, renderMode: 'group3d' })
    const moving = f.block(180, 200, parent)
    const layout = await f.solve(), camera = f.camera()
    const planes = buildWorldPlanes(f.api, layout, {}, camera, { independentNodes: true })
    const part = f.api.getChildren(moving)[0]!
    const body = planes.find(plane => plane.nodeId === part.id)!
    const initial = body.center
    useUI.setState({ solidGridSnapEnabled: true, solidGridSize: 32 })
    const constraint = createSolidMoveConstraint(f.api, moving, layout, {}, camera)!
    // Parent +90° maps local (10,5) to world (-15,20), including parent scales.
    const worldDx = Math.round((initial.x - 15) / 32) * 32 - initial.x
    const worldDy = Math.round((initial.y + 20) / 32) * 32 - initial.y
    const actual = constraint({ x: 10, y: 5 })
    expectDelta(actual, { x: worldDy / 2, y: -worldDx / 3, z: 0 })
    expectDelta(constraint({ x: 10, y: 5 }, true), { x: 10, y: 5, z: 0 })
  })

  it('keeps a tilted parent’s two-axis edit on its own plane when snapping', async () => {
    const f = scene()
    const parent = f.api.createNode('frame', f.root, { size: { width: 400, height: 400 }, clipsContent: false })
    transform(f.api, parent, { rotationX: 35, rotationY: 20, renderMode: 'group3d' })
    const moving = f.block(180, 200, parent)
    useUI.setState({ solidGridSnapEnabled: true })
    const constraint = createSolidMoveConstraint(f.api, moving, await f.solve(), {}, f.camera())!
    const actual = constraint({ x: 17, y: 11 })
    expect(actual.z).toBeCloseTo(0, 7)
    expect([actual.x, actual.y, actual.z].every(Number.isFinite)).toBe(true)
    expectDelta(constraint({ x: 17, y: 11 }, true), { x: 17, y: 11, z: 0 })
  })

  it('allows manual adjustment of parts inside a protected native assembly', async () => {
    const f = scene()
    const server = createIsometricAsset(f.api, 'server', { center: { x: 240, y: 300 } })
    f.api.setNodeProperty(server, 'preventOverlap', true)
    const module = f.api.getChildren(server)[0]!
    const housing = f.api.getChildren(module.id).find(node => node.name === 'Housing')!
    const constraint = createSolidMoveConstraint(f.api, housing.id, await f.solve(), {}, f.camera())!
    expectDelta(constraint({ x: 0, y: 65 }), { x: 0, y: 65, z: 0 })
  })

  it('never snaps or collision-clamps animation evaluation, even after a manual placement session', async () => {
    const f = scene(), moving = f.block(240, 270), obstacle = f.block(600, 270)
    f.api.setNodeProperty(obstacle, 'preventOverlap', true)
    const base = f.api.getNode(moving)!.transform.x
    addKeyframe(f.api, moving, 'transform.x', 0, base)
    addKeyframe(f.api, moving, 'transform.x', 2, base + 410)
    const track = f.api.getTracksForNode(moving)[0]!
    f.api.setTrack({ ...track, defaultEasing: 'linear', keyframes: track.keyframes.map(key => ({ ...key, easingOut: 'linear' })) })
    const engine = getAnimEngine()
    engine.attach(f.api)
    engine.seek(0)
    const layout = await f.solve(), camera = f.camera()
    const constraint = createSolidMoveConstraint(f.api, moving, layout, engine.getSnapshot(), camera)!
    useUI.setState({ solidGridSnapEnabled: true, solidGridSize: 32, playing: true })
    expect(constraint({ x: 800, y: 0 }).x).toBeCloseTo(200)
    const before = sceneToBytes(f.api.doc)
    engine.seek(1)
    expect(engine.getSnapshot()[moving]?.x).toBeCloseTo(base + 205)
    const animatedPlanes = buildWorldPlanes(f.api, layout, engine.getSnapshot(), camera, { independentNodes: true })
    const partId = f.api.getChildren(moving)[0]!.id
    expect(animatedPlanes.find(plane => plane.nodeId === partId)?.center.x).toBeCloseTo(445)
    expect(sceneToBytes(f.api.doc)).toEqual(before)
    expect(f.api.getNode(moving)?.transform.x).toBe(base)
  })

  it('does not create a constraint for ordinary flat layers or unavailable geometry', async () => {
    const f = scene(), flat = f.api.createNode('rect', f.root)
    const moving = f.block(240, 270)
    const layout = await f.solve()
    expect(createSolidMoveConstraint(f.api, flat, layout, {}, f.camera())).toBeNull()
    expect(createSolidMoveConstraint(f.api, moving, {}, {}, f.camera())).toBeNull()
  })
})
