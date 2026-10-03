// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { AnimatedValue } from '@/anim'
import { getAnimEngine } from '@/anim/engine'
import { addKeyframe } from '@/anim/tracks'
import type { CameraNode } from '@/scene'
import { createSceneAPI } from '@/scene/doc'
import { ISOMETRIC_CAMERA_ROTATION, ISOMETRIC_CAMERA_VIEWS } from '@/scene/cameraProjection'
import { resolveCameraDomProjection } from '@/render/cameraDomProjection'
import { createThreeCamera, syncThreeCamera } from './threeCamera'
import { add3, mul3, type Vec3 } from './math'
import { buildWorldPlanes, cameraBasis, cameraFrustumCorners, hitTestPlanes, projectWorldPoint, resolveCamera3D, viewportPointToRay } from './scene3d'
import { depthOfFieldTexturePadding } from './depthOfFieldPadding'

const viewport = { width: 960, height: 540 }
function fixture() {
  const api = createSceneAPI()
  const camera: CameraNode = {
    ...api.getActiveCamera()!,
    projection: 'orthographic',
    transform: { ...api.getActiveCamera()!.transform, x: 480, y: 270, ...ISOMETRIC_CAMERA_ROTATION },
  }
  return { api, camera }
}
function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 8)
  expect(actual.y).toBeCloseTo(expected.y, 8)
}

describe('orthographic isometric camera', () => {
  it('keeps identical screen size at every depth and dollies without changing magnification', () => {
    const { camera } = fixture()
    const resolved = resolveCamera3D(camera, undefined, viewport)
    const { right, forward } = cameraBasis(resolved)
    const extent = (center: Vec3) => {
      const a = projectWorldPoint(center, resolved, viewport)
      const b = projectWorldPoint(add3(center, mul3(right, 100)), resolved, viewport)
      return Math.hypot(b.x - a.x, b.y - a.y)
    }
    expect(extent(add3(resolved.pointOfInterest, mul3(forward, -400)))).toBeCloseTo(100)
    expect(extent(add3(resolved.pointOfInterest, mul3(forward, 800)))).toBeCloseTo(100)
    const moved = resolveCamera3D(camera, { z: 300 }, viewport)
    expectPoint(projectWorldPoint({ x: 700, y: 300, z: 100 }, moved, viewport),
      projectWorldPoint({ x: 700, y: 300, z: 100 }, resolved, viewport))
  })

  it('projects three equal axes equally and aligns XY edges to the 30° grid', () => {
    const { camera } = fixture()
    const resolved = resolveCamera3D(camera, undefined, viewport)
    const center = resolved.pointOfInterest
    const start = projectWorldPoint(center, resolved, viewport)
    const ends = [{ x: 100, y: 0, z: 0 }, { x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 100 }]
      .map(axis => projectWorldPoint(add3(center, axis), resolved, viewport))
    const lengths = ends.map(end => Math.hypot(end.x - start.x, end.y - start.y))
    expect(lengths[0]).toBeCloseTo(100 * Math.sqrt(2 / 3))
    expect(lengths[1]).toBeCloseTo(lengths[0]!)
    expect(lengths[2]).toBeCloseTo(lengths[0]!)
    expect((ends[0]!.y - start.y) / (ends[0]!.x - start.x)).toBeCloseTo(Math.tan(Math.PI / 6))
    expect((ends[1]!.y - start.y) / (ends[1]!.x - start.x)).toBeCloseTo(-Math.tan(Math.PI / 6))
    expect(ends[2]!.x).toBeCloseTo(start.x)
  })

  it.each(ISOMETRIC_CAMERA_VIEWS)('keeps $label upright with equal axes from its named corner', ({ id, rotation }) => {
    const { camera } = fixture()
    const resolved = resolveCamera3D({ ...camera, transform: { ...camera.transform, ...rotation } }, undefined, viewport)
    const center = resolved.pointOfInterest
    const start = projectWorldPoint(center, resolved, viewport)
    const x = projectWorldPoint(add3(center, { x: 100, y: 0, z: 0 }), resolved, viewport)
    const y = projectWorldPoint(add3(center, { x: 0, y: 100, z: 0 }), resolved, viewport)
    const z = projectWorldPoint(add3(center, { x: 0, y: 0, z: 100 }), resolved, viewport)
    for (const endpoint of [x, y, z]) {
      expect(Math.hypot(endpoint.x - start.x, endpoint.y - start.y)).toBeCloseTo(100 * Math.sqrt(2 / 3))
    }
    for (const endpoint of [x, y]) {
      expect(Math.abs((endpoint.y - start.y) / (endpoint.x - start.x))).toBeCloseTo(Math.tan(Math.PI / 6))
    }
    expect(z.x).toBeCloseTo(start.x)
    // Extrusion extends behind the top surface along +Z; height rises along -Z.
    expect(z.y).toBeGreaterThan(start.y)
    expect(Math.sign(resolved.position.x - center.x)).toBe(id.endsWith('left') ? -1 : 1)
    expect(Math.sign(resolved.position.y - center.y)).toBe(id.startsWith('front') ? -1 : 1)
    expect(resolved.position.z).toBeLessThan(center.z)
  })

  it('matches Three and DOM projections with animated rotation, pan, uniform zoom and depth', () => {
    const { camera } = fixture()
    const animation = { x: 410, y: 210, z: -200, rotationX: 23, rotationY: -48, rotation: 19, scaleX: 0.5, scaleY: 0.75 }
    const resolved = resolveCamera3D(camera, animation, viewport)
    const three = createThreeCamera(resolved.projection)
    expect(three).toBeInstanceOf(THREE.OrthographicCamera)
    syncThreeCamera(three, resolved, viewport.width, viewport.height)
    const dom = resolveCameraDomProjection(camera, animation, viewport)
    expect(dom.perspective).toBe('none')
    for (const point of [{ x: 0, y: 0, z: 0 }, { x: 690, y: 130, z: 250 }, { x: 350, y: 300, z: -300 }]) {
      const expected = projectWorldPoint(point, resolved, viewport)
      const projected = new THREE.Vector3(point.x, point.y, point.z).project(three)
      expectPoint({ x: (projected.x + 1) * viewport.width / 2, y: (1 - projected.y) * viewport.height / 2 }, expected)
      const affine = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(new THREE.Matrix4().fromArray(dom.matrix))
      expectPoint(affine, expected)
    }
  })

  it('ignores hidden legacy Y-scale keys and holds the final isometric pose after the last key', () => {
    const { api, camera } = fixture()
    const end = 2.0013523020636454
    api.setNodeProperty(camera.id, 'projection', 'orthographic')
    api.setNodeProperty(camera.id, 'transform', {
      ...camera.transform,
      scaleX: 0.12332155428582127,
      scaleY: 0.09991498615835402,
    })
    addKeyframe(api, camera.id, 'transform.scaleX', 0, 0.12304043354744579)
    addKeyframe(api, camera.id, 'transform.scaleX', end, 0.12332155428582127)
    addKeyframe(api, camera.id, 'transform.scaleY', 1.9121180854171318, 0.10422374317111834)
    addKeyframe(api, camera.id, 'transform.scaleY', end, 0.09991498615835402)
    const savedCamera = api.getActiveCamera()!
    const engine = getAnimEngine()
    engine.attach(api)
    const sample = (time: number) => {
      engine.seek(time)
      return resolveCamera3D(savedCamera, engine.getSnapshot()[camera.id], viewport)
    }
    for (const time of [0, 1.9121180854171318, 1.95, end, end + 0.01, 3]) {
      const resolved = sample(time)
      expect(resolved.zoomY).toBe(resolved.zoomX)
      const center = resolved.pointOfInterest
      const start = projectWorldPoint(center, resolved, viewport)
      const x = projectWorldPoint(add3(center, { x: 100, y: 0, z: 0 }), resolved, viewport)
      expect(Math.abs((x.y - start.y) / (x.x - start.x))).toBeCloseTo(Math.tan(Math.PI / 6))
    }
    expect(sample(end + 0.01)).toEqual(sample(end))
    expect(sample(3)).toEqual(sample(end))
    // Reading the lens does not rewrite authored project data.
    expect(api.getActiveCamera()!.transform.scaleY).toBe(0.09991498615835402)
    expect(api.getTracksForNode(camera.id).find(track => track.propertyId === 'transform.scaleY')!.keyframes).toHaveLength(2)
  })

  it('uses parallel offset rays and exact focus hits on animated cards', () => {
    const { api, camera } = fixture()
    const root = api.createNode('frame', null, { size: viewport })
    const card = api.createNode('rect', root, { size: { width: 120, height: 80 } })
    const layout = { [root]: { x: 0, y: 0, ...viewport }, [card]: { x: 400, y: 220, width: 120, height: 80 } }
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const resolved = resolveCamera3D(camera, { scaleX: 1 - t / 2, scaleY: 1 - t / 2 }, viewport)
      const animated: Record<string, AnimatedValue> = { [card]: { x: t * 200, y: t * 60, z: t * 300, rotationX: t * 25, rotationY: t * 30, rotation: t * 90, scaleX: 1 + t, scaleY: 1 - t / 2 } }
      const planes = buildWorldPlanes(api, layout, animated, resolved)
      const plane = planes.find(p => p.nodeId === card)!
      const screen = projectWorldPoint(plane.center, resolved, viewport)
      const ray = viewportPointToRay(resolved, screen.x, screen.y, viewport)
      const otherRay = viewportPointToRay(resolved, screen.x + 100, screen.y + 50, viewport)
      expect(otherRay.direction).toEqual(ray.direction)
      expect(otherRay.origin).not.toEqual(ray.origin)
      const hit = hitTestPlanes(planes, ray, resolved, viewport)!
      expect(hit.nodeId).toBe(card)
      expectPoint(hit.point, plane.center)
      expect(hit.point.z).toBeCloseTo(plane.center.z)
    }
  })

  it('keeps frustum dimensions and blur support constant across depth while DOF retains real depth', () => {
    const { camera } = fixture()
    const resolved = resolveCamera3D({ ...camera, depthOfField: true, focusMode: 'plane', focusDistance: 1900 }, undefined, viewport)
    for (const depth of [100, 4000]) {
      const corners = cameraFrustumCorners(resolved, viewport, depth)
      expectPoint(projectWorldPoint(corners[0]!, resolved, viewport), { x: 0, y: 0 })
      expectPoint(projectWorldPoint(corners[2]!, resolved, viewport), { x: viewport.width, y: viewport.height })
    }
    const basis = cameraBasis(resolved)
    const plane = { rect: { x: 0, y: 0, width: 100, height: 100 }, center: resolved.pointOfInterest, right: basis.right, down: basis.down, scaleX: 1, scaleY: 1 }
    const near = depthOfFieldTexturePadding(plane, resolved, 24)
    const far = depthOfFieldTexturePadding({ ...plane, center: add3(plane.center, mul3(basis.forward, 1000)) }, resolved, 24)
    expect(far).toEqual(near)
  })
})
