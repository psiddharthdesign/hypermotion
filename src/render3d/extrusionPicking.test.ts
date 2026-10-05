// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { intersectExtrusion } from './extrusionPicking'

const box = { kind: 'rect' as const, width: 100, height: 60, depth: 20 }
const identity = new Matrix4().toArray()

describe('extrusion picking', () => {
  it('selects front, back and side surfaces, including edge-on views', () => {
    const front = intersectExtrusion({ origin: { x: 10, y: 5, z: -40 }, direction: { x: 0, y: 0, z: 1 } }, box, identity)!
    expect(front).toMatchObject({ t: 40, point: { x: 10, y: 5, z: 0 }, surface: 'front', localNormal: { x: 0, y: 0, z: -1 } })
    expect(intersectExtrusion({ origin: { x: 0, y: 0, z: 50 }, direction: { x: 0, y: 0, z: -1 } }, box, identity)).toMatchObject({ t: 30, surface: 'back', localNormal: { x: 0, y: 0, z: 1 } })
    expect(intersectExtrusion({ origin: { x: 80, y: 0, z: 10 }, direction: { x: -1, y: 0, z: 0 } }, box, identity)).toMatchObject({ t: 30, point: { x: 50, y: 0, z: 10 }, surface: 'side', localNormal: { x: 1, y: 0, z: 0 } })
  })
  it('returns the forward exit for a ray starting inside a solid', () => {
    expect(intersectExtrusion({ origin: { x: 0, y: 0, z: 10 }, direction: { x: 0, y: 1, z: 0 } }, box, identity)).toMatchObject({ t: 30, surface: 'side' })
  })
  it('rejects empty ellipse corners and rounded rectangle corners', () => {
    const ray = { origin: { x: 49, y: 29, z: -20 }, direction: { x: 0, y: 0, z: 1 } }
    expect(intersectExtrusion(ray, { ...box, kind: 'ellipse' }, identity)).toBeNull()
    expect(intersectExtrusion(ray, { ...box, cornerRadius: 20 }, identity)).toBeNull()
    expect(intersectExtrusion(ray, box, identity)?.surface).toBe('front')
  })
  it('keeps world hit distances under inherited rotation, nonuniform scale, reflection and shear', () => {
    const matrix = new Matrix4().compose(new Vector3(120, 60, 200), new Quaternion().setFromEuler(new Euler(0.5, 0.7, -0.2)), new Vector3(-2, 0.7, 1.5))
    matrix.multiply(new Matrix4().set(1, 0.2, 0, 0, 0, 1, 0.3, 0, 0, 0, 1, 0, 0, 0, 0, 1))
    const start = new Vector3(10, 5, -40).applyMatrix4(matrix)
    const end = new Vector3(10, 5, 0).applyMatrix4(matrix)
    const direction = end.clone().sub(start).multiplyScalar(1 / 40)
    const hit = intersectExtrusion({ origin: start, direction }, box, matrix.toArray())!
    expect(hit.t).toBeCloseTo(40)
    expect(hit.point.x).toBeCloseTo(end.x)
    expect(hit.point.y).toBeCloseTo(end.y)
    expect(hit.point.z).toBeCloseTo(end.z)
    expect(hit.localPoint.x).toBeCloseTo(10)
    expect(hit.localPoint.y).toBeCloseTo(5)
    expect(hit.localPoint.z).toBeCloseTo(0)
  })
  it('makes nearest-depth selection independent of layer paint order', () => {
    const ray = { origin: { x: 0, y: 0, z: -100 }, direction: { x: 0, y: 0, z: 2 } }
    const far = intersectExtrusion(ray, box, new Matrix4().makeTranslation(0, 0, 80).toArray())!
    const near = intersectExtrusion(ray, box, identity)!
    expect(near.t).toBe(50)
    expect(far.t).toBe(90)
    expect([far, near].sort((a, b) => a.t - b.t)[0]).toBe(near)
  })
  it('rejects flat, singular, behind-camera, parallel and invalid rays', () => {
    const ray = { origin: { x: 0, y: 0, z: -100 }, direction: { x: 0, y: 0, z: 1 } }
    expect(intersectExtrusion(ray, { ...box, depth: 0 }, identity)).toBeNull()
    expect(intersectExtrusion(ray, box, new Matrix4().makeScale(0, 1, 1).toArray())).toBeNull()
    expect(intersectExtrusion({ ...ray, direction: { x: 0, y: 0, z: -1 } }, box, identity)).toBeNull()
    expect(intersectExtrusion({ ...ray, direction: { x: 1, y: 0, z: 0 } }, box, identity)).toBeNull()
    expect(intersectExtrusion({ ...ray, direction: { x: NaN, y: 0, z: 1 } }, box, identity)).toBeNull()
  })
})
