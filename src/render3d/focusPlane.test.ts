// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { createSceneAPI } from '@/scene/doc'
import { getAnimEngine } from '@/anim/engine'
import { solveLayout, yogaReady } from '@/layout/engine'
import { pickLayerFocus } from '@/ui/cameraFocus'
import { buildWorldPlanes, cameraBasis, focusPlaneCorners, focusPlanePose, focusPlaneShaderState, projectWorldPoint, resolveCamera3D } from './scene3d'
import { dot3, sub3, type Vec3 } from './math'

const viewport = { width: 960, height: 540 }
const camera = () => createSceneAPI().getActiveCamera()!

describe('continuous focus planes', () => {
  it('puts a picked point on the sharp plane even when the rest of its tilted card has a different depth', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: viewport })
    const card = api.createNode('rect', root, { position: 'absolute', size: { width: 400, height: 240 } })
    const node = api.getNode(card)!
    api.setNodeProperty(card, 'transform', { ...node.transform, x: 280, y: 150, rotationY: 60 })
    const authored = { ...api.getActiveCamera()!, focusMode: 'plane' as const, depthOfField: true, aperture: 1, blurLevel: 24 }
    const layout = solveLayout(await yogaReady, api, root, viewport)
    const initial = resolveCamera3D(authored, undefined, viewport)
    const plane = buildWorldPlanes(api, layout, {}, initial).find(p => p.nodeId === card)!
    const point = { x: plane.center.x + plane.right.x * 160, y: plane.center.y + plane.right.y * 160, z: plane.center.z + plane.right.z * 160 }
    const picked = pickLayerFocus(api, authored, layout, {}, projectWorldPoint(point, initial, viewport))!
    const resolved = resolveCamera3D({ ...authored, focusDistance: picked.distance }, undefined, viewport)
    const state = focusPlaneShaderState(resolved)!
    const basis = cameraBasis(resolved)
    const signedDistance = (world: Vec3) => {
      const delta = sub3(world, resolved.position)
      return dot3(state.normal, { x: dot3(delta, basis.right), y: -dot3(delta, basis.down), z: -dot3(delta, basis.forward) }) + state.constant
    }
    expect(signedDistance(point)).toBeCloseTo(0)
    expect(Math.abs(signedDistance(plane.center))).toBeGreaterThan(100)
    expect(state.maxBlurPx).toBe(24)
  })

  it.each(['perspective', 'orthographic'] as const)('keeps an independent plane fixed under a moving %s camera with exact shader distances', (projection) => {
    const base = { ...camera(), projection, depthOfField: true, focusMode: 'spatial' as const, focusPlaneX: 460, focusPlaneY: 250, focusPlaneZ: 100, focusPlaneRotationX: 25, focusPlaneRotationY: -30, focusPlaneRotationZ: 17 }
    const first = resolveCamera3D(base, undefined, viewport)
    const moved = resolveCamera3D(base, { x: 570, z: -200, rotationX: 20, rotationY: 15, rotation: 30 }, viewport)
    expect(moved.focusWorld).toEqual(first.focusWorld)
    expect(moved.focusPlaneNormal).toEqual(first.focusPlaneNormal)
    const state = focusPlaneShaderState(moved)!
    const basis = cameraBasis(moved)
    const view = new Matrix4().makeBasis(
      new Vector3(basis.right.x, basis.right.y, basis.right.z),
      new Vector3(-basis.down.x, -basis.down.y, -basis.down.z),
      new Vector3(-basis.forward.x, -basis.forward.y, -basis.forward.z),
    ).setPosition(moved.position.x, moved.position.y, moved.position.z).invert()
    for (const point of [moved.focusWorld, { x: 100, y: 400, z: -200 }, { x: 900, y: 20, z: 750 }]) {
      const inView = new Vector3(point.x, point.y, point.z).applyMatrix4(view)
      expect(dot3(state.normal, inView) + state.constant).toBeCloseTo(dot3(moved.focusPlaneNormal, sub3(point, moved.focusWorld)))
    }
  })

  it('starts the independent plane at the same pose as the current focus, including camera roll', () => {
    const base = { ...camera(), focusMode: 'plane' as const, focusDistance: 750 }
    const source = resolveCamera3D(base, { rotationX: 30, rotationY: -20, rotation: 45 }, viewport)
    const spatial = resolveCamera3D({ ...base, focusMode: 'spatial', ...focusPlanePose(source) }, undefined, viewport)
    expect(spatial.focusWorld).toEqual(source.focusWorld)
    for (const key of ['x', 'y', 'z'] as const) expect(spatial.focusPlaneNormal[key]).toBeCloseTo(source.focusPlaneNormal[key])
  })

  it('sizes an orthographic plane guide from zoom independently of its depth', () => {
    const authored = { ...camera(), projection: 'orthographic' as const, focusMode: 'spatial' as const, focusPlaneX: 460, focusPlaneY: 250, focusPlaneZ: 100, focusPlaneRotationX: 25, focusPlaneRotationY: -30, focusPlaneRotationZ: 17 }
    const resolved = resolveCamera3D(authored, { scaleX: 0.5, rotationX: 35, rotationY: -45 }, viewport)
    const corners = focusPlaneCorners(resolved, viewport)
    const far = resolveCamera3D({ ...authored, focusPlaneZ: 1000 }, { scaleX: 0.5, rotationX: 35, rotationY: -45 }, viewport)
    const farCorners = focusPlaneCorners(far, viewport)
    const width = new Vector3().subVectors(corners[1]!, corners[0]!).length()
    const height = new Vector3().subVectors(corners[3]!, corners[0]!).length()
    expect(width).toBeCloseTo(viewport.width / resolved.zoomX * 0.6)
    expect(height).toBeCloseTo(viewport.height / resolved.zoomY * 0.6)
    expect(new Vector3().subVectors(farCorners[1]!, farCorners[0]!).length()).toBeCloseTo(width)
    for (const corner of corners) expect(dot3(sub3(corner, resolved.focusWorld), resolved.focusPlaneNormal)).toBeCloseTo(0)
    const center = corners.reduce<Vector3>((sum, corner) => sum.add(new Vector3(corner.x, corner.y, corner.z)), new Vector3()).multiplyScalar(0.25)
    expect(center.distanceTo(new Vector3(resolved.focusWorld.x, resolved.focusWorld.y, resolved.focusWorld.z))).toBeCloseTo(0)
  })

  it('evaluates all six plane channels deterministically when seeking an isometric animation', () => {
    const api = createSceneAPI()
    const id = api.getActiveCamera()!.id
    api.setNodeProperty(id, 'projection', 'orthographic')
    api.setNodeProperty(id, 'focusMode', 'spatial')
    api.setNodeProperty(id, 'depthOfField', true)
    const channels = [
      ['focusPlaneX', 400, 560], ['focusPlaneY', 210, 330], ['focusPlaneZ', 0, 160],
      ['focusPlaneRotationX', 0, 60], ['focusPlaneRotationY', 0, -40], ['focusPlaneRotationZ', 0, 30],
    ] as const
    for (const [field, start, end] of channels) api.setTrack({
      id: field, nodeId: id, propertyId: `camera.${field}`, defaultEasing: 'linear',
      keyframes: [{ id: `${field}-a`, time: 0, value: start }, { id: `${field}-b`, time: 2, value: end }],
    })
    const authored = api.getActiveCamera()!
    const engine = getAnimEngine()
    engine.attach(api)
    const sample = (time: number) => {
      engine.seek(time)
      return resolveCamera3D(authored, { rotationX: -35.264, rotationY: 45, ...engine.getSnapshot()[id] }, viewport)
    }
    const midway = sample(1)
    expect(midway.focusWorld).toEqual({ x: 480, y: 270, z: 80 })
    const pose = focusPlanePose(midway)
    expect(pose.focusPlaneRotationX).toBeCloseTo(30)
    expect(pose.focusPlaneRotationY).toBeCloseTo(-20)
    expect(pose.focusPlaneRotationZ).toBeCloseTo(15)
    const state = focusPlaneShaderState(midway)
    const end = sample(2)
    expect(end.focusWorld).toEqual({ x: 560, y: 330, z: 160 })
    expect(sample(3)).toEqual(end)
    sample(0)
    expect(sample(1)).toEqual(midway)
    expect(focusPlaneShaderState(sample(1))).toEqual(state)
    expect(api.getTracksForNode(id)).toHaveLength(6)
  })

  it('does not let stale target coordinates override Distance or an independent plane', () => {
    const base = { ...camera(), focusMode: 'plane' as const, focusDistance: 777 }
    const resolved = resolveCamera3D(base, undefined, viewport, { x: 1, y: 2, z: 9999 })
    expect(resolved.focusDistance).toBeCloseTo(777)
    expect(focusPlaneShaderState({ ...resolved, focusMode: 'screen' })).toBeUndefined()
  })
})
