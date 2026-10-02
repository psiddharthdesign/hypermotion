// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SolidFaceControls } from './SolidFaceControls'
import * as Y from 'yjs'
import { Matrix4, Vector3 } from 'three'
import type { Transform } from '@/scene'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { addKeyframe } from '@/anim/tracks'
import { buildWorldPlanes, projectWorldPoint, resolveCamera3D, type Plane3D } from '@/render3d/scene3d'
import { extrusionWorldMatrix } from '@/render3d/extrusionScene'
import { createSolidPlacementSession, constrainSolidResize } from './solidPlacement'
import { commitSolidFaceEdit, solidEditableFaces, solidEditableOutline, solidFaceHighlightKey, solidFaceDragDelta, solidFaceEdit, snapSolidFaceDelta, solidFaceEffectiveDelta, solidFacePreviewPlane } from './solidFaceEditing'

function fixture(kind: 'rect' | 'ellipse' = 'rect', transform: Partial<Transform> = {}, parentTransform: Partial<Transform> = {}) {
  const api = createSceneAPI()
  const viewport = { width: 960, height: 540 }
  const root = api.createNode('frame', null, { size: viewport })
  const group = api.createNode('frame', root, { size: viewport, clipsContent: false })
  api.setNodeProperty(group, 'transform', { ...api.getNode(group)!.transform, ...parentTransform, renderMode: 'group3d' })
  const id = api.createNode(kind, group, { size: { width: 100, height: 60 }, extrusion: { depth: 40, sideColor: '#2563eb' } })
  api.setNodeProperty(id, 'transform', { ...api.getNode(id)!.transform, ...transform })
  const layout = { [root]: { x: 0, y: 0, ...viewport }, [group]: { x: 0, y: 0, ...viewport }, [id]: { x: 0, y: 0, width: 100, height: 60 } }
  const camera = { ...resolveCamera3D(api.getActiveCamera()!, undefined, viewport), projection: 'orthographic' as const, zoomX: 1, zoomY: 1,
    position: { x: -200, y: -150, z: -400 }, pointOfInterest: { x: 50, y: 30, z: 0 } }
  const plane = () => buildWorldPlanes(api, layout, {}, camera, { independentNodes: true }).find(plane => plane.nodeId === id)!
  return { api, id, group, layout, viewport, camera, plane }
}
const worldPoint = (plane: Plane3D, x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(new Matrix4().fromArray(extrusionWorldMatrix(plane)))
const expectPoint = (actual: Vector3, expected: Vector3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

describe('solid face extension', () => {
  it.each(['front', 'back'] as const)('keeps the opposite cap fixed while extending the %s under nested rotations', cap => {
    const f = fixture('rect', { rotationX: 32, rotationY: -19, rotation: 12 }, { rotationY: 22, rotation: 30, scaleX: 1.4, scaleY: 0.8 })
    const initial = f.plane()
    const opposite = worldPoint(initial, 0, 0, cap === 'front' ? 40 : 0)
    const edit = solidFaceEdit(initial, { axis: 'depth', normal: { x: 0, y: 0, z: cap === 'front' ? -1 : 1 } }, 35)!
    commitSolidFaceEdit(f.api, f.id, edit, 0, false)
    expect(f.api.getNode(f.id)?.extrusion?.depth).toBe(75)
    expectPoint(worldPoint(f.plane(), 0, 0, cap === 'front' ? 75 : 0), opposite)
    expect(f.api.getTracksForNode(f.id)).toHaveLength(0)
    f.api.doc.destroy()
  })

  it.each([{ axis: 'width' as const, sign: 1 }, { axis: 'width' as const, sign: -1 }, { axis: 'height' as const, sign: 1 }, { axis: 'height' as const, sign: -1 }])('keeps opposite $axis side fixed for sign $sign with an off-center anchor', ({ axis, sign }) => {
    const f = fixture('rect', { rotationX: 13, rotationY: -23, rotation: 21, anchorX: 0.2, anchorY: 0.8 }, { rotationX: -15, rotationY: 40, rotation: 5, scaleX: 1.7, scaleY: 0.75 })
    const before = f.plane()
    const opposite = worldPoint(before, axis === 'width' ? -sign * 50 : 0, axis === 'height' ? -sign * 30 : 0, 20)
    const edit = solidFaceEdit(before, { axis, normal: { x: axis === 'width' ? sign : 0, y: axis === 'height' ? sign : 0, z: 0 } }, 60)!
    expect(Object.keys(edit.size!)).toEqual([axis])
    commitSolidFaceEdit(f.api, f.id, edit, 0, false)
    f.layout[f.id] = { ...f.layout[f.id]!, ...edit.size }
    expectPoint(worldPoint(f.plane(), axis === 'width' ? -sign * 80 : 0, axis === 'height' ? -sign * 60 : 0, 20), opposite)
    f.api.doc.destroy()
  })

  it('resizes a cylinder diameter evenly and preserves the opposite tangent', () => {
    const f = fixture('ellipse')
    const before = f.plane()
    const opposite = worldPoint(before, -50, 0, 20)
    const edit = solidFaceEdit(before, { axis: 'diameter', normal: { x: 1, y: 0, z: 0 } }, 50)!
    expect(edit.size).toEqual({ width: 150, height: 90 })
    commitSolidFaceEdit(f.api, f.id, edit, 0, false)
    f.layout[f.id] = { ...f.layout[f.id]!, ...edit.size }
    expectPoint(worldPoint(f.plane(), -75, 0, 20), opposite)
    f.api.doc.destroy()
  })

  it('clamps depth and dimensions without moving the opposite cap past the surface', () => {
    const f = fixture()
    const plane = f.plane()
    expect(solidFaceEdit(plane, { axis: 'depth', normal: { x: 0, y: 0, z: -1 } }, -1000)).toMatchObject({ depth: 0, translationDelta: { z: 40 } })
    expect(solidFaceEdit(plane, { axis: 'width', normal: { x: -1, y: 0, z: 0 } }, -1000)?.size?.width).toBe(1)
    expect(solidFaceEdit(plane, { axis: 'width', normal: { x: -1, y: 0, z: 0 } }, NaN)).toBeNull()
    f.api.doc.destroy()
  })
})

describe('face picking and projected drags', () => {
  it.each(['orthographic', 'perspective'] as const)('maps a rotated outward movement back to exact authored pixels in %s', projection => {
    const f = fixture('rect', { rotationX: 22, rotationY: -16 })
    const camera = { ...f.camera, projection }
    const faces = solidEditableFaces(f.plane(), camera, f.viewport)
    expect(faces.length).toBeGreaterThanOrEqual(2)
    for (const face of faces) {
      const start = projectWorldPoint(face.worldCenter, camera, f.viewport)
      const end = projectWorldPoint({ x: face.worldCenter.x + face.worldAxis.x * 24, y: face.worldCenter.y + face.worldAxis.y * 24, z: face.worldCenter.z + face.worldAxis.z * 24 }, camera, f.viewport)
      expect(solidFaceDragDelta(start, end, face, camera, f.viewport)).toBeCloseTo(24, 5)
      expect(solidFaceDragDelta(start, end, face, camera, f.viewport, true)).toBeCloseTo(240, 5)
    }
    f.api.doc.destroy()
  })

  it('exposes only camera-facing surfaces and falls back to vertical extension for a head-on cap', () => {
    const f = fixture()
    const camera = { ...f.camera, position: { x: 50, y: 30, z: -400 }, pointOfInterest: { x: 50, y: 30, z: 0 }, zoomX: 2, zoomY: 2 }
    const faces = solidEditableFaces(f.plane(), camera, f.viewport)
    expect(faces.map(face => face.id)).toEqual(['front'])
    expect(solidFaceDragDelta({ x: 480, y: 270 }, { x: 480, y: 230 }, faces[0]!, camera, f.viewport)).toBeCloseTo(20)
    f.api.doc.destroy()
  })

  it('keeps a zero-depth front face available for pulling a flattened solid back out', () => {
    const f = fixture()
    f.api.setNodeProperty(f.id, 'extrusion', { depth: 0, sideColor: '#2563eb' })
    expect(solidEditableFaces(f.plane(), f.camera, f.viewport).map(face => face.id)).toEqual(['front'])
    f.api.doc.destroy()
  })
})

describe('solid face keyframes and undo', () => {
  it('commits the dimension and anchored position together in one undo and stamps only changed properties', () => {
    const f = fixture()
    const undo = new Y.UndoManager(f.api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    const edit = solidFaceEdit(f.plane(), { axis: 'width', normal: { x: -1, y: 0, z: 0 } }, 40)!
    commitSolidFaceEdit(f.api, f.id, edit, 1.25, true)
    expect(f.api.getTracksForNode(f.id).map(track => track.propertyId).sort()).toEqual(['size.width', 'transform.x'])
    expect(f.api.getTracksForNode(f.id).every(track => track.keyframes[0]!.time === 1.25)).toBe(true)
    expect(undo.undoStack).toHaveLength(1)
    undo.undo()
    expect(f.api.getNode(f.id)).toMatchObject({ size: { width: 100 }, transform: { x: 0 } })
    expect(f.api.getTracksForNode(f.id)).toEqual([])
    undo.redo()
    expect(f.api.getNode(f.id)).toMatchObject({ size: { width: 140 }, transform: { x: -40 } })
    undo.destroy()
    f.api.doc.destroy()
  })

  it('stamps an already animated depth while Auto Key is off and leaves unrelated animation alone', () => {
    const f = fixture()
    addKeyframe(f.api, f.id, 'extrusion.depth', 0, 40)
    addKeyframe(f.api, f.id, 'appearance.opacity', 0, 0.6)
    const beforeOpacity = f.api.getTracksForNode(f.id).find(track => track.propertyId === 'appearance.opacity')
    commitSolidFaceEdit(f.api, f.id, { depth: 120, translationDelta: { x: 0, y: 0, z: 0 } }, 2, false)
    expect(f.api.getTracksForNode(f.id).find(track => track.propertyId === 'extrusion.depth')?.keyframes.map(key => [key.time, key.value])).toEqual([[0, 40], [2, 120]])
    expect(f.api.getTracksForNode(f.id).find(track => track.propertyId === 'appearance.opacity')).toEqual(beforeOpacity)
    f.api.doc.destroy()
  })

  it('does not edit locked solids', () => {
    const f = fixture()
    f.api.setNodeProperty(f.id, 'locked', true)
    commitSolidFaceEdit(f.api, f.id, { depth: 120, translationDelta: { x: 0, y: 0, z: -80 } }, 2, true)
    expect(f.api.getNode(f.id)?.extrusion?.depth).toBe(40)
    expect(f.api.getTracksForNode(f.id)).toEqual([])
    f.api.doc.destroy()
  })
})

describe('face placement predictions and grid snapping', () => {
  it('snaps the edited dimension and keeps other axes untouched', () => {
    const f = fixture()
    const plane = f.plane()
    expect(snapSolidFaceDelta(plane, { axis: 'depth', normal: { x: 0, y: 0, z: -1 } }, 35, 32)).toBe(24)
    expect(snapSolidFaceDelta(plane, { axis: 'width', normal: { x: 1, y: 0, z: 0 } }, 20, 32)).toBe(28)
    expect(snapSolidFaceDelta(plane, { axis: 'height', normal: { x: 0, y: 1, z: 0 } }, 15, 0)).toBe(15)
    f.api.doc.destroy()
  })

  it.each(['width', 'height', 'depth', 'diameter'] as const)('predicts the same %s geometry as a committed edit under nested rotations', axis => {
    const f = fixture(axis === 'diameter' ? 'ellipse' : 'rect', { rotationX: 17, rotationY: 26, rotation: -31, anchorX: 0.1, anchorY: 0.8 }, { rotationX: -15, rotationY: 44, scaleX: 1.3, scaleY: 0.6 })
    const before = f.plane()
    const face = { axis, normal: axis === 'depth' ? { x: 0, y: 0, z: -1 } : axis === 'height' ? { x: 0, y: -1, z: 0 } : { x: -1, y: 0, z: 0 } }
    const edit = solidFaceEdit(before, face, 32)!
    const predicted = solidFacePreviewPlane(before, edit)
    commitSolidFaceEdit(f.api, f.id, edit, 0, false)
    f.layout[f.id] = { ...f.layout[f.id]!, ...edit.size }
    expectPoint(new Vector3(predicted.center.x, predicted.center.y, predicted.center.z), new Vector3(f.plane().center.x, f.plane().center.y, f.plane().center.z))
    expect(predicted.rect).toEqual(f.plane().rect)
    expect(predicted.extrusion).toEqual(f.plane().extrusion)
    expect(solidFaceEffectiveDelta(before, face, edit)).toBeCloseTo(32)
    f.api.doc.destroy()
  })

  it('uses the clamped dimension delta when applying a collision fraction', () => {
    const f = fixture()
    const plane = f.plane()
    const face = { axis: 'depth' as const, normal: { x: 0, y: 0, z: -1 } }
    const full = solidFaceEdit(plane, face, 1e9)!
    expect(solidFaceEffectiveDelta(plane, face, full)).toBe(100000 - 40)
    const half = solidFaceEdit(plane, face, solidFaceEffectiveDelta(plane, face, full) * 0.5)!
    expect(half.depth).toBe(50020)
    f.api.doc.destroy()
  })
})

describe('optional face overlap prevention', () => {
  function protectedFixture(protectEdited = false, protectObstacle = true) {
    const f = fixture()
    if (protectEdited) f.api.setNodeProperty(f.group, 'preventOverlap', true)
    const obstacle = f.api.createNode('rect', f.api.getRoot(), {
      size: { width: 100, height: 60 }, extrusion: { depth: 40, sideColor: '#123456' },
    })
    f.api.setNodeProperty(obstacle, 'transform', { ...f.api.getNode(obstacle)!.transform, x: 160 })
    if (protectObstacle) f.api.setNodeProperty(obstacle, 'preventOverlap', true)
    f.layout[obstacle] = { x: 0, y: 0, width: 100, height: 60 }
    const planes = buildWorldPlanes(f.api, f.layout, {}, f.camera, { independentNodes: true })
    const nodes = new Map(f.api.getAllNodeIds().map(id => [id, f.api.getNode(id)!]))
    const placement = createSolidPlacementSession(planes, new Set([f.group]), nodes)
    return { ...f, obstacle, placement, original: planes.find(plane => plane.nodeId === f.id)! }
  }

  it.each([[true, false], [false, true], [true, true]])('stops at another asset when edited protection=%s, obstacle protection=%s', (edited, obstacle) => {
    const f = protectedFixture(edited, obstacle)
    const face = { axis: 'width' as const, normal: { x: 1, y: 0, z: 0 } }
    const proposed = solidFaceEdit(f.original, face, 120)!
    const limit = constrainSolidResize(f.placement, [solidFacePreviewPlane(f.original, proposed)], {})
    expect(limit.blocked).toBe(true)
    expect(limit.fraction).toBeCloseTo(0.5, 4)
    const stopped = solidFaceEdit(f.original, face, solidFaceEffectiveDelta(f.original, face, proposed) * limit.fraction)!
    expect(stopped.size?.width).toBeCloseTo(160, 3)
    expect(stopped.translationDelta.x).toBeCloseTo(0)
    f.api.doc.destroy()
  })

  it('permits overlap when both assets are unprotected and when Alt bypasses a protected pair', () => {
    for (const bypass of [false, true]) {
      const f = protectedFixture(bypass, bypass)
      const face = { axis: 'width' as const, normal: { x: 1, y: 0, z: 0 } }
      const proposed = solidFaceEdit(f.original, face, 120)!
      const limit = constrainSolidResize(f.placement, [solidFacePreviewPlane(f.original, proposed)], { bypass })
      expect(limit).toMatchObject({ fraction: 1, blocked: false })
      f.api.doc.destroy()
    }
  })

  it('treats the selected asset parts as one assembly rather than colliding with its own inset details', () => {
    const f = fixture()
    f.api.setNodeProperty(f.group, 'preventOverlap', true)
    const detail = f.api.createNode('rect', f.group, { size: { width: 20, height: 20 }, extrusion: { depth: 2, sideColor: '#123456' } })
    f.layout[detail] = { x: 0, y: 0, width: 20, height: 20 }
    const planes = buildWorldPlanes(f.api, f.layout, {}, f.camera, { independentNodes: true })
    const placement = createSolidPlacementSession(planes, new Set([f.group]), new Map(f.api.getAllNodeIds().map(id => [id, f.api.getNode(id)!])))
    const original = planes.find(plane => plane.nodeId === f.id)!
    const proposed = solidFaceEdit(original, { axis: 'width', normal: { x: 1, y: 0, z: 0 } }, 120)!
    expect(constrainSolidResize(placement, [solidFacePreviewPlane(original, proposed)], {})).toMatchObject({ fraction: 1, blocked: false })
    f.api.doc.destroy()
  })
})

describe('solid editing contours', () => {
  it('keeps square hard corners but removes smooth corner tessellation seams', () => {
    const f = fixture()
    const square = f.plane()
    expect(solidEditableOutline(square, f.camera, f.viewport).filter(edge => edge.kind === 'vertical')).toHaveLength(3)
    const rounded = { ...square, extrusionCornerRadius: 20 }
    const visibleWalls = solidEditableFaces(rounded, f.camera, f.viewport).filter(face => face.axis !== 'depth')
    expect(visibleWalls.length).toBeGreaterThan(10)
    const contour = solidEditableOutline(rounded, f.camera, f.viewport)
    expect(contour.filter(edge => edge.kind === 'vertical')).toHaveLength(2)
    expect(contour.filter(edge => edge.kind === 'rim').length).toBeGreaterThan(20)
    f.api.doc.destroy()
  })

  it('draws only two upright silhouettes around a cylinder, with smooth cap rims', () => {
    const f = fixture('ellipse')
    const contour = solidEditableOutline(f.plane(), f.camera, f.viewport)
    expect(contour.filter(edge => edge.kind === 'vertical')).toHaveLength(2)
    expect(contour.filter(edge => edge.kind === 'rim').length).toBeGreaterThan(96)
    f.api.doc.destroy()
  })

  it('groups rounded corner highlight facets by the dimension and direction they edit', () => {
    const f = fixture()
    const rounded = { ...f.plane(), extrusionCornerRadius: 20 }
    const walls = solidEditableFaces(rounded, f.camera, f.viewport).filter(face => face.axis !== 'depth')
    const groups = new Set(walls.map(solidFaceHighlightKey))
    expect(groups.size).toBeLessThan(walls.length)
    expect(groups.has('width:-1')).toBe(true)
    expect(groups.has('height:-1')).toBe(true)
    expect(groups.size).toBeLessThanOrEqual(4)
    expect(solidFaceHighlightKey({ id: 'side-1', axis: 'width', normal: { x: 1, y: 0, z: 0 } })).not.toBe('width:-1')
    f.api.doc.destroy()
  })

  it('paints grouped smooth surfaces while keeping individual hit polygons stroke-free', () => {
    const f = fixture()
    const rounded = { ...f.plane(), extrusionCornerRadius: 20 }
    const markup = renderToStaticMarkup(createElement(SolidFaceControls, {
      api: f.api, planes: [rounded], camera: f.camera, width: f.viewport.width, height: f.viewport.height,
      zoom: 1, enabled: true, clientToViewport: (x, y) => ({ x, y }),
    }))
    const polygons = markup.match(/<polygon[^>]*>/g) ?? []
    expect(polygons.length).toBeGreaterThan(10)
    expect(polygons.every(polygon => polygon.includes('stroke="none"') && polygon.includes('fill="transparent"'))).toBe(true)
    expect((markup.match(/data-solid-highlight=/g) ?? []).length).toBeLessThan(polygons.length)
    expect((markup.match(/data-solid-outline="true"/g) ?? [])).toHaveLength(1)
    f.api.doc.destroy()
  })

  it('draws no duplicate rim or wall seams for a zero-depth shape', () => {
    const f = fixture()
    const plane = { ...f.plane(), extrusion: { ...f.plane().extrusion!, depth: 0 }, extrusionCornerRadius: 20 }
    expect(solidEditableOutline(plane, f.camera, f.viewport).every(edge => edge.kind === 'rim')).toBe(true)
    expect(solidEditableOutline(plane, f.camera, f.viewport)).toHaveLength(solidEditableFaces(plane, f.camera, f.viewport)[0]!.points.length)
    f.api.doc.destroy()
  })
})
