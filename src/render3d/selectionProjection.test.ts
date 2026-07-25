// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  evaluateLayerMotionPath,
  normalizeLayerMotionPath,
} from '@/anim/layerMotionPath'
import type { SolvedLayout } from '@/layout'
import { createSceneAPI } from '@/scene/doc'
import type { CameraNode } from '@/scene/types'
import {
  buildWorldPlanes,
  projectWorldPoint,
  resolveCamera3D,
  type Plane3D,
  type ViewportSize,
} from '@/render3d/scene3d'
import {
  canvasQuadToWorkspace,
  motionPathLocalPointToWorld,
  planeWorldQuad,
  projectMotionPathPoint,
  projectedResizeHandles,
  projectedQuadBounds,
  projectPlaneQuad,
  viewportPointToMotionPathDepth,
  viewportPointToMotionPathLocal,
  viewportPointToPlaneLocal,
} from '@/render3d/selectionProjection'

const VIEWPORT: ViewportSize = { width: 960, height: 540 }

function selectionFixture(options?: {
  camera?: Partial<CameraNode['transform']>
  layer?: Partial<{
    x: number
    y: number
    z: number
    rotation: number
    rotationX: number
    rotationY: number
    scaleX: number
    scaleY: number
  }>
}): { camera: CameraNode; plane: Plane3D } {
  const api = createSceneAPI()
  const rootId = api.createNode('frame', null, {
    name: 'Root',
    size: { width: VIEWPORT.width, height: VIEWPORT.height },
  })
  const layerId = api.createNode('rect', rootId, {
    name: 'Selected layer',
    size: { width: 200, height: 120 },
    transform: {
      x: options?.layer?.x ?? 0,
      y: options?.layer?.y ?? 0,
      z: options?.layer?.z ?? 0,
      rotation: options?.layer?.rotation ?? 0,
      rotationX: options?.layer?.rotationX ?? 0,
      rotationY: options?.layer?.rotationY ?? 0,
      scaleX: options?.layer?.scaleX ?? 1,
      scaleY: options?.layer?.scaleY ?? 1,
    },
  })
  const activeCamera = api.getActiveCamera()
  if (!activeCamera) throw new Error('Expected the default camera')
  const camera: CameraNode = {
    ...activeCamera,
    transform: { ...activeCamera.transform, ...options?.camera },
  }
  const layout: SolvedLayout = {
    [rootId]: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    [layerId]: { x: 100, y: 80, width: 200, height: 120 },
  }
  const resolvedCamera = resolveCamera3D(camera, undefined, VIEWPORT)
  const plane = buildWorldPlanes(api, layout, {}, resolvedCamera).find(
    (candidate) => candidate.nodeId === layerId,
  )
  if (!plane) throw new Error('Expected a selected layer plane')
  return { camera, plane }
}

function expectPoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

function expectPoint3(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

describe('camera-projected selection geometry', () => {
  it('matches the solved layer box at the neutral camera pose', () => {
    const { camera, plane } = selectionFixture()
    const quad = projectPlaneQuad(
      plane,
      resolveCamera3D(camera, undefined, VIEWPORT),
      VIEWPORT,
    )

    expectPoint(quad[0], { x: 100, y: 80 })
    expectPoint(quad[1], { x: 300, y: 80 })
    expectPoint(quad[2], { x: 300, y: 200 })
    expectPoint(quad[3], { x: 100, y: 200 })
    expect(projectedQuadBounds(quad)).toEqual({
      x: 100,
      y: 80,
      width: 200,
      height: 120,
    })
  })

  it('tracks camera X, Y, and Z movement around the point of interest', () => {
    const { camera, plane } = selectionFixture({
      camera: { x: 400, y: 240, z: 180 },
    })
    const resolved = resolveCamera3D(camera, undefined, VIEWPORT)
    const bounds = projectedQuadBounds(
      projectPlaneQuad(plane, resolved, VIEWPORT),
    )
    const expectedScale = resolved.focalLength / (resolved.focalLength - 180)

    expect(bounds.width).toBeCloseTo(200 * expectedScale, 6)
    expect(bounds.height).toBeCloseTo(120 * expectedScale, 6)
    expectPoint(
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      {
        x: VIEWPORT.width / 2 + (200 - 400) * expectedScale,
        y: VIEWPORT.height / 2 + (140 - 240) * expectedScale,
      },
    )
  })

  it('projects every transformed corner through camera roll and tilt', () => {
    const { camera, plane } = selectionFixture({
      camera: {
        x: 360,
        y: 220,
        z: 120,
        rotation: 18,
        rotationX: 24,
        rotationY: -17,
      },
      layer: {
        z: 80,
        rotation: 13,
        rotationX: -8,
        rotationY: 11,
        scaleX: 1.2,
        scaleY: 0.85,
      },
    })
    const resolved = resolveCamera3D(camera, undefined, VIEWPORT)
    const worldQuad = planeWorldQuad(plane)
    const projected = projectPlaneQuad(plane, resolved, VIEWPORT)

    worldQuad.forEach((corner, index) => {
      expectPoint(
        projected[index as 0 | 1 | 2 | 3],
        projectWorldPoint(corner, resolved, VIEWPORT),
      )
    })
    expect(Math.abs(projected[0].y - projected[1].y)).toBeGreaterThan(1)
    expect(Math.abs(projected[1].x - projected[2].x)).toBeGreaterThan(1)
    const topEdge = Math.hypot(
      projected[1].x - projected[0].x,
      projected[1].y - projected[0].y,
    )
    const bottomEdge = Math.hypot(
      projected[2].x - projected[3].x,
      projected[2].y - projected[3].y,
    )
    expect(Math.abs(topEdge - bottomEdge)).toBeGreaterThan(1)
  })

  it('updates immediately from an animated field of view', () => {
    const { camera, plane } = selectionFixture({
      camera: { x: 430, y: 260, z: 200 },
    })
    const narrow = resolveCamera3D(camera, { fieldOfView: 20 }, VIEWPORT)
    const wide = resolveCamera3D(camera, { fieldOfView: 90 }, VIEWPORT)
    const narrowBounds = projectedQuadBounds(
      projectPlaneQuad(plane, narrow, VIEWPORT),
    )
    const wideBounds = projectedQuadBounds(
      projectPlaneQuad(plane, wide, VIEWPORT),
    )

    expect(narrow.fieldOfView).toBe(20)
    expect(wide.fieldOfView).toBe(90)
    expect(wideBounds.width).not.toBeCloseTo(narrowBounds.width, 3)
    expect(wideBounds.height).not.toBeCloseTo(narrowBounds.height, 3)
  })

  it('applies workspace zoom exactly once after camera projection', () => {
    const { camera, plane } = selectionFixture({
      camera: { x: 420, y: 250, z: 150, rotation: 9, rotationY: 12 },
    })
    const canvasQuad = projectPlaneQuad(
      plane,
      resolveCamera3D(camera, undefined, VIEWPORT),
      VIEWPORT,
    )
    const canvasBounds = projectedQuadBounds(canvasQuad)
    const workspaceQuad = canvasQuadToWorkspace(canvasQuad, {
      canvas: VIEWPORT,
      workspace: { width: 1440, height: 900 },
      view: { zoom: 1.75, panX: 36, panY: -22 },
    })
    const workspaceBounds = projectedQuadBounds(workspaceQuad)

    expect(workspaceBounds.width).toBeCloseTo(canvasBounds.width * 1.75, 6)
    expect(workspaceBounds.height).toBeCloseTo(canvasBounds.height * 1.75, 6)
    expectPoint(workspaceQuad[0], {
      x: 1440 / 2 + 36 + (canvasQuad[0].x - VIEWPORT.width / 2) * 1.75,
      y: 900 / 2 - 22 + (canvasQuad[0].y - VIEWPORT.height / 2) * 1.75,
    })
  })

  it('round-trips a tilted projected pointer into plane-local resize coordinates', () => {
    const { camera, plane } = selectionFixture({
      camera: {
        x: 390,
        y: 230,
        z: 210,
        rotation: -14,
        rotationX: 27,
        rotationY: 19,
      },
      layer: {
        z: 95,
        rotation: 11,
        rotationX: -9,
        rotationY: 7,
        scaleX: 1.15,
        scaleY: 0.9,
      },
    })
    const resolved = resolveCamera3D(camera, undefined, VIEWPORT)
    const local = { x: 154, y: 37 }
    const world = planeWorldQuad(plane)
    const topLeft = world[0]
    const widthVector = {
      x: world[1].x - topLeft.x,
      y: world[1].y - topLeft.y,
      z: world[1].z - topLeft.z,
    }
    const heightVector = {
      x: world[3].x - topLeft.x,
      y: world[3].y - topLeft.y,
      z: world[3].z - topLeft.z,
    }
    const point = {
      x:
        topLeft.x +
        widthVector.x * (local.x / plane.rect.width) +
        heightVector.x * (local.y / plane.rect.height),
      y:
        topLeft.y +
        widthVector.y * (local.x / plane.rect.width) +
        heightVector.y * (local.y / plane.rect.height),
      z:
        topLeft.z +
        widthVector.z * (local.x / plane.rect.width) +
        heightVector.z * (local.y / plane.rect.height),
    }
    const viewportPoint = projectWorldPoint(point, resolved, VIEWPORT)

    const roundTrip = viewportPointToPlaneLocal(
      viewportPoint,
      plane,
      resolved,
      VIEWPORT,
    )
    expect(roundTrip).not.toBeNull()
    expectPoint(roundTrip!, local)
  })

  it('keeps a neutral motion-path origin stable while the layer travels', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: VIEWPORT.width, height: VIEWPORT.height },
    })
    const path = normalizeLayerMotionPath({
      version: 1,
      progress: 0.5,
      parameterization: 'parametric',
      points: [
        {
          id: 'start',
          t: 0,
          x: 0,
          y: 0,
          z: 0,
          outX: 30,
          outY: -20,
          outZ: 5,
        },
        {
          id: 'end',
          t: 1,
          x: 120,
          y: 60,
          z: 40,
          inX: 80,
          inY: 90,
          inZ: 35,
        },
      ],
    })!
    const layerId = api.createNode('rect', rootId, {
      name: 'Cursor-like layer',
      size: { width: 48, height: 48 },
      motionPath: path,
      transform: {
        x: 10,
        y: 20,
        z: 30,
        rotation: 35,
        rotationX: 9,
        rotationY: -12,
        scaleX: 1.4,
        scaleY: 0.8,
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
      [layerId]: { x: 100, y: 80, width: 48, height: 48 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolved = resolveCamera3D(camera, undefined, VIEWPORT)
    const offset = evaluateLayerMotionPath(path, path.progress)
    const plane = buildWorldPlanes(
      api,
      layout,
      {
        [layerId]: {
          x: 10 + offset.x,
          y: 20 + offset.y,
          z: 30 + offset.z,
          motionPathProgress: path.progress,
        },
      },
      resolved,
    ).find((candidate) => candidate.nodeId === layerId)
    if (!plane) throw new Error('Expected motion-path plane')

    expectPoint3(plane.motionPathOrigin, { x: 134, y: 124, z: 30 })
    expectPoint3(plane.motionPathBasisX, { x: 1, y: 0, z: 0 })
    expectPoint3(plane.motionPathBasisY, { x: 0, y: 1, z: 0 })
    expectPoint3(plane.motionPathBasisZ, { x: 0, y: 0, z: 1 })

    const local = { x: 72, y: -18, z: 0 }
    expectPoint3(motionPathLocalPointToWorld(local, plane), {
      x: 206,
      y: 106,
      z: 30,
    })
    const viewportPoint = projectMotionPathPoint(
      local,
      plane,
      resolved,
      VIEWPORT,
    )
    const roundTrip = viewportPointToMotionPathLocal(
      viewportPoint,
      local.z,
      plane,
      resolved,
      VIEWPORT,
    )
    expect(roundTrip).not.toBeNull()
    expectPoint3(roundTrip!, local)
  })

  it('round-trips motion-path depth at the neutral camera pose and rejects ambiguous rays', () => {
    const { camera, plane } = selectionFixture()
    const resolved = resolveCamera3D(camera, undefined, VIEWPORT)
    const local = { x: 60, y: -30, z: 72 }
    const viewportPoint = projectMotionPathPoint(
      local,
      plane,
      resolved,
      VIEWPORT,
    )
    const roundTrip = viewportPointToMotionPathDepth(
      viewportPoint,
      local.x,
      local.y,
      plane,
      resolved,
      VIEWPORT,
    )
    expect(roundTrip).not.toBeNull()
    expectPoint3(roundTrip!, local)

    const parallelX =
      resolved.position.x - plane.motionPathOrigin.x
    const parallelY =
      resolved.position.y - plane.motionPathOrigin.y
    const parallelPoint = projectMotionPathPoint(
      { x: parallelX, y: parallelY, z: 40 },
      plane,
      resolved,
      VIEWPORT,
    )
    const nearParallelPoint = {
      x: parallelPoint.x + 0.00001,
      y: parallelPoint.y,
    }
    expect(
      viewportPointToMotionPathDepth(
        nearParallelPoint,
        parallelX,
        parallelY,
        plane,
        resolved,
        VIEWPORT,
      ),
    ).toBeNull()

    const behindCameraPoint = {
      x: VIEWPORT.width - viewportPoint.x,
      y: VIEWPORT.height - viewportPoint.y,
    }
    expect(
      viewportPointToMotionPathDepth(
        behindCameraPoint,
        local.x,
        local.y,
        plane,
        resolved,
        VIEWPORT,
      ),
    ).toBeNull()
  })

  it('round-trips path plane and depth coordinates through a tilted camera and a non-orthogonal inherited basis', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: VIEWPORT.width, height: VIEWPORT.height },
    })
    const grandparentId = api.createNode('frame', rootId, {
      name: 'Scaled grandparent',
      size: { width: 520, height: 340 },
      transform: {
        x: 18,
        y: -12,
        z: 45,
        rotation: 24,
        rotationX: 11,
        rotationY: -8,
        scaleX: 1.8,
        scaleY: 0.62,
      },
    })
    const parentId = api.createNode('frame', grandparentId, {
      name: 'Rotated parent',
      size: { width: 360, height: 220 },
      transform: {
        x: -16,
        y: 21,
        z: 38,
        rotation: -37,
        rotationX: -6,
        rotationY: 13,
        scaleX: 1.15,
        scaleY: 0.88,
      },
    })
    const path = normalizeLayerMotionPath({
      version: 1,
      progress: 0.63,
      parameterization: 'parametric',
      points: [
        {
          id: 'start',
          t: 0,
          x: 0,
          y: 0,
          z: 0,
          outX: 60,
          outY: -80,
          outZ: 20,
        },
        {
          id: 'end',
          t: 1,
          x: 220,
          y: 70,
          z: 55,
          inX: 150,
          inY: 130,
          inZ: 45,
        },
      ],
    })!
    const layerId = api.createNode('rect', parentId, {
      name: 'Path layer',
      size: { width: 48, height: 48 },
      motionPath: path,
      transform: {
        x: 14,
        y: -9,
        z: 27,
        rotation: 53,
        rotationX: 17,
        rotationY: -19,
        scaleX: 1.35,
        scaleY: 0.74,
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
      [grandparentId]: { x: 70, y: 55, width: 520, height: 340 },
      [parentId]: { x: 115, y: 96, width: 360, height: 220 },
      [layerId]: { x: 168, y: 132, width: 48, height: 48 },
    }
    const activeCamera = api.getActiveCamera()
    if (!activeCamera) throw new Error('Expected the default camera')
    const camera: CameraNode = {
      ...activeCamera,
      transform: {
        ...activeCamera.transform,
        x: 410,
        y: 245,
        z: 190,
        rotation: -13,
        rotationX: 23,
        rotationY: 16,
      },
    }
    const resolved = resolveCamera3D(camera, undefined, VIEWPORT)
    const basePlane = buildWorldPlanes(
      api,
      layout,
      { [layerId]: { x: 14, y: -9, z: 27 } },
      resolved,
      { independentNodes: true },
    ).find((candidate) => candidate.nodeId === layerId)
    const offset = evaluateLayerMotionPath(path, path.progress)
    const movedPlane = buildWorldPlanes(
      api,
      layout,
      {
        [layerId]: {
          x: 14 + offset.x,
          y: -9 + offset.y,
          z: 27 + offset.z,
          motionPathProgress: path.progress,
        },
      },
      resolved,
      { independentNodes: true },
    ).find((candidate) => candidate.nodeId === layerId)
    if (!basePlane || !movedPlane) {
      throw new Error('Expected nested motion-path plane')
    }

    expectPoint3(movedPlane.motionPathOrigin, basePlane.motionPathOrigin)
    expect(
      Math.abs(
        movedPlane.motionPathBasisX.x * movedPlane.motionPathBasisY.x +
          movedPlane.motionPathBasisX.y * movedPlane.motionPathBasisY.y +
          movedPlane.motionPathBasisX.z * movedPlane.motionPathBasisY.z,
      ),
    ).toBeGreaterThan(0.05)
    const basisZLengthSquared =
      movedPlane.motionPathBasisZ.x * movedPlane.motionPathBasisZ.x +
      movedPlane.motionPathBasisZ.y * movedPlane.motionPathBasisZ.y +
      movedPlane.motionPathBasisZ.z * movedPlane.motionPathBasisZ.z
    const basisZXDot =
      movedPlane.motionPathBasisZ.x * movedPlane.motionPathBasisX.x +
      movedPlane.motionPathBasisZ.y * movedPlane.motionPathBasisX.y +
      movedPlane.motionPathBasisZ.z * movedPlane.motionPathBasisX.z
    const basisZYDot =
      movedPlane.motionPathBasisZ.x * movedPlane.motionPathBasisY.x +
      movedPlane.motionPathBasisZ.y * movedPlane.motionPathBasisY.y +
      movedPlane.motionPathBasisZ.z * movedPlane.motionPathBasisY.z
    expect(Math.abs(basisZLengthSquared - 1)).toBeGreaterThan(0.01)
    expect(Math.max(Math.abs(basisZXDot), Math.abs(basisZYDot))).toBeGreaterThan(
      0.05,
    )

    const local = { x: 126, y: -58, z: 24 }
    const viewportPoint = projectMotionPathPoint(
      local,
      movedPlane,
      resolved,
      VIEWPORT,
    )
    const roundTrip = viewportPointToMotionPathLocal(
      viewportPoint,
      local.z,
      movedPlane,
      resolved,
      VIEWPORT,
    )
    expect(roundTrip).not.toBeNull()
    expectPoint3(roundTrip!, local)

    const depthLocal = { x: 92, y: -34, z: 67 }
    const depthViewportPoint = projectMotionPathPoint(
      depthLocal,
      movedPlane,
      resolved,
      VIEWPORT,
    )
    const depthRoundTrip = viewportPointToMotionPathDepth(
      depthViewportPoint,
      depthLocal.x,
      depthLocal.y,
      movedPlane,
      resolved,
      VIEWPORT,
    )
    expect(depthRoundTrip).not.toBeNull()
    expectPoint3(depthRoundTrip!, depthLocal)
  })

  it('builds only the selected ancestor path without changing its world plane', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: VIEWPORT.width, height: VIEWPORT.height },
    })
    const parentId = api.createNode('frame', rootId, {
      name: 'Transformed parent',
      size: { width: 420, height: 260 },
      transform: {
        x: 24,
        y: -18,
        z: 70,
        rotation: 12,
        rotationX: 8,
        rotationY: -6,
        scaleX: 1.1,
        scaleY: 0.95,
      },
    })
    const selectedId = api.createNode('rect', parentId, {
      name: 'Selected',
      size: { width: 180, height: 72 },
      transform: {
        x: 9,
        y: 13,
        z: 35,
        rotation: 0,
        rotationX: 0,
        rotationY: 10,
        scaleX: 1,
        scaleY: 1,
      },
    })
    const distractorId = api.createNode('rect', rootId, {
      name: 'Unrelated sibling',
      size: { width: 300, height: 180 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [parentId]: { x: 80, y: 60, width: 420, height: 260 },
      [selectedId]: { x: 120, y: 110, width: 180, height: 72 },
      [distractorId]: { x: 580, y: 260, width: 300, height: 180 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolved = resolveCamera3D(
      {
        ...camera,
        transform: {
          ...camera.transform,
          z: 160,
          rotationX: 16,
          rotationY: -12,
          rotation: 7,
        },
      },
      undefined,
      VIEWPORT,
    )
    const full = buildWorldPlanes(api, layout, {}, resolved, {
      independentNodes: true,
    })
    const targeted = buildWorldPlanes(api, layout, {}, resolved, {
      independentNodes: true,
      targetNodeIds: new Set([selectedId]),
    })

    expect(full.some((plane) => plane.nodeId === distractorId)).toBe(true)
    expect(targeted.map((plane) => plane.nodeId)).toEqual([selectedId])
    const fullSelected = full.find((plane) => plane.nodeId === selectedId)!
    expect({ ...targeted[0], paintOrder: fullSelected.paintOrder }).toEqual(
      fullSelected,
    )
  })

  it('places all resize handles on projected corners and edge midpoints', () => {
    const handles = projectedResizeHandles([
      { x: 10, y: 20 },
      { x: 110, y: 30 },
      { x: 100, y: 100 },
      { x: 0, y: 90 },
    ])
    const byId = Object.fromEntries(handles.map((handle) => [handle.id, handle]))

    expect(byId.nw.point).toEqual({ x: 10, y: 20 })
    expect(byId.n.point).toEqual({ x: 60, y: 25 })
    expect(byId.ne.point).toEqual({ x: 110, y: 30 })
    expect(byId.e.point).toEqual({ x: 105, y: 65 })
    expect(byId.se.point).toEqual({ x: 100, y: 100 })
    expect(byId.s.point).toEqual({ x: 50, y: 95 })
    expect(byId.sw.point).toEqual({ x: 0, y: 90 })
    expect(byId.w.point).toEqual({ x: 5, y: 55 })
  })

  it('rotates resize cursors with the projected layer axes', () => {
    const handles = projectedResizeHandles([
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ])
    const byId = Object.fromEntries(handles.map((handle) => [handle.id, handle]))

    expect(byId.n.cursor).toBe('nesw-resize')
    expect(byId.e.cursor).toBe('nwse-resize')
    expect(byId.s.cursor).toBe('nesw-resize')
    expect(byId.w.cursor).toBe('nwse-resize')
  })
})
