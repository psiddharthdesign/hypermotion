// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { getAnimEngine } from '@/anim'
import { solveLayout, yogaReady } from '@/layout/engine'
import { createSceneAPI } from '@/scene/doc'
import type { SceneAPI } from '@/scene'
import { buildWorldPlanes, cameraSpaceDepth, depthBlurAmount, projectWorldPoint, resolveCamera3D } from '@/render3d/scene3d'
import { nearestLayerFocus, pickLayerFocus } from './cameraFocus'

afterEach(() => getAnimEngine().pause())

function addCard(api: SceneAPI, root: string, x: number, z = 0) {
  const id = api.createNode('rect', root, { position: 'absolute', size: { width: 64, height: 64 } })
  const node = api.getNode(id)!
  api.setNodeProperty(id, 'transform', { ...node.transform, x, y: 238, z })
  api.setNodeProperty(id, 'appearance', { ...node.appearance, fill: { kind: 'solid', color: '#3B82F6' } })
  return id
}

describe('distance focus on animated layers', () => {
  it('uses animated world depth, sharpening the nearest card and blurring farther cards', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const ids = [addCard(api, root, 320, -240), addCard(api, root, 448, 240), addCard(api, root, 576, 400)]
    for (const [index, id] of ids.slice(0, 2).entries()) {
      const start = index === 0 ? -240 : 240
      api.setTrack({ id: `depth-${id}`, nodeId: id, propertyId: 'transform.z', defaultEasing: 'linear', keyframes: [{ id: 'a', time: 0, value: start }, { id: 'b', time: 1, value: -start }] })
    }
    const camera = { ...api.getActiveCamera()!, depthOfField: true, focusMode: 'plane' as const, aperture: 1, blurLevel: 24 }
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    const engine = getAnimEngine(); engine.attach(api)
    const focused: string[] = []
    for (const time of [0, 0.5, 1]) {
      engine.seek(time)
      const snapshot = engine.getSnapshot()
      const nearest = nearestLayerFocus(api, camera, layout, snapshot)!
      focused.push(nearest.nodeId)
      const resolved = resolveCamera3D({ ...camera, focusDistance: nearest.distance }, undefined, api.getMeta().canvas)
      const planes = buildWorldPlanes(api, layout, snapshot, resolved).filter((p) => ids.includes(p.nodeId))
      const depths = planes.map((p) => cameraSpaceDepth(p.center, resolved))
      expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(200)
      expect(nearest.distance).toBeCloseTo(Math.min(...depths))
      const blur = (index: number) => depthBlurAmount(depths[index]!, planes[index]!.center, resolved.focusWorld, resolved.focusDistance, 160, 180, 1, 24, resolved.focalLength, true, false)
      expect(blur(planes.findIndex((p) => p.nodeId === nearest.nodeId))).toBeCloseTo(0)
      expect(blur(depths.indexOf(Math.max(...depths)))).toBeGreaterThan(10)
    }
    expect(new Set(focused).size).toBeGreaterThan(1)
  })

  it('ignores empty, hidden and offscreen foreground layers', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const card = addCard(api, root, 448)
    const camera = api.getActiveCamera()!
    const empty = api.createNode('frame', root, { position: 'absolute', size: { width: 80, height: 80 } })
    api.setNodeProperty(empty, 'appearance', { ...api.getNode(empty)!.appearance, fill: null, stroke: null })
    api.setNodeProperty(empty, 'transform', { ...api.getNode(empty)!.transform, x: 440, y: 230, z: -200 })
    const hidden = addCard(api, root, 448, -100)
    api.setNodeProperty(hidden, 'visible', false)
    addCard(api, root, 10000, -100)
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    expect(nearestLayerFocus(api, camera, layout, {})?.nodeId).toBe(card)
    expect(pickLayerFocus(api, camera, layout, {}, { x: 480, y: 270 })?.nodeId).toBe(card)
  })
})

describe('pick distance focus on the canvas', () => {
  it('focuses the clicked point on a tilted card rather than its center', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const card = addCard(api, root, 448)
    api.setNodeProperty(card, 'transform', { ...api.getNode(card)!.transform, rotationY: 60 })
    const camera = { ...api.getActiveCamera()!, focusMode: 'plane' as const }
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    const resolved = resolveCamera3D(camera, undefined, api.getMeta().canvas)
    const plane = buildWorldPlanes(api, layout, {}, resolved).find((p) => p.nodeId === card)!
    const surface = {
      x: plane.center.x + plane.right.x * 24,
      y: plane.center.y + plane.right.y * 24,
      z: plane.center.z + plane.right.z * 24,
    }
    const point = projectWorldPoint(surface, resolved, api.getMeta().canvas)
    const picked = pickLayerFocus(api, camera, layout, {}, point)!
    expect(picked.nodeId).toBe(card)
    expect(picked.distance).toBeCloseTo(cameraSpaceDepth(surface, resolved))
    expect(Math.abs(picked.distance - plane.cameraDepth)).toBeGreaterThan(20)
    expect(picked.point.x).toBeCloseTo(surface.x)
    expect(picked.point.z).toBeCloseTo(surface.z)
  })

  it('uses the animated camera and layer depth, including locked visible cards', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const card = addCard(api, root, 448)
    api.setNodeProperty(card, 'locked', true)
    const camera = api.getActiveCamera()!
    const animated = { [camera.id]: { rotationX: 20, rotationY: -25 }, [card]: { z: -180 } }
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    const resolved = resolveCamera3D(camera, animated[camera.id], api.getMeta().canvas)
    const plane = buildWorldPlanes(api, layout, animated, resolved).find((p) => p.nodeId === card)!
    const point = projectWorldPoint(plane.center, resolved, api.getMeta().canvas)
    const picked = pickLayerFocus(api, camera, layout, animated, point)!
    expect(picked.nodeId).toBe(card)
    expect(picked.distance).toBeCloseTo(cameraSpaceDepth(plane.center, resolved))
    expect(picked.distance).not.toBeCloseTo(resolved.focalLength - 180)
    expect(api.getNode(card)!.locked).toBe(true)
  })

  it('returns no focus for empty canvas or a point outside the composition', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    addCard(api, root, 448)
    const camera = api.getActiveCamera()!
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    const before = camera.focusDistance
    expect(pickLayerFocus(api, camera, layout, {}, { x: 10, y: 10 })).toBeNull()
    expect(pickLayerFocus(api, camera, layout, {}, { x: -1, y: 270 })).toBeNull()
    expect(api.getNode(camera.id)!.kind).toBe('camera')
    expect(api.getActiveCamera()!.focusDistance).toBe(before)
  })
})
