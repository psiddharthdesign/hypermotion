// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { ISOMETRIC_CAMERA_ROTATION } from '@/scene/cameraProjection'
import { projectWorldPoint, resolveCamera3D } from '@/render3d/scene3d'
import { cameraCanvasPoint, cameraOrthographicPan } from './cameraNavigationProjection'

describe('camera authoring-plane navigation', () => {
  it.each(['perspective', 'orthographic'] as const)('places points under the pointer in a tilted %s camera', (projection) => {
    const api = createSceneAPI()
    const camera = { ...api.getActiveCamera()!, projection }
    const viewport = api.getMeta().canvas
    const resolved = resolveCamera3D(camera, { ...ISOMETRIC_CAMERA_ROTATION, scaleX: 0.5, scaleY: 0.8, z: 120 }, viewport)
    const world = { x: viewport.width / 2 + 80, y: viewport.height / 2 - 30, z: 0 }
    const projected = projectWorldPoint(world, resolved, viewport)
    const recovered = cameraCanvasPoint(resolved, projected, viewport)!
    expect(recovered.x).toBeCloseTo(world.x)
    expect(recovered.y).toBeCloseTo(world.y)
  })

  it('pans an isometric camera in the requested screen direction at any zoom', () => {
    const api = createSceneAPI()
    const camera = { ...api.getActiveCamera()!, projection: 'orthographic' as const }
    const viewport = api.getMeta().canvas
    const animated = { ...ISOMETRIC_CAMERA_ROTATION, scaleX: 0.25, scaleY: 0.5 }
    const resolved = resolveCamera3D(camera, animated, viewport)
    const world = { x: viewport.width / 2, y: viewport.height / 2, z: 0 }
    const before = projectWorldPoint(world, resolved, viewport)
    const patch = cameraOrthographicPan({ camera: resolved, viewport, startX: camera.transform.x, startY: camera.transform.y, deltaX: 40, deltaY: -20, workspaceZoom: 0.5 })
    const after = projectWorldPoint(world, resolveCamera3D(camera, { ...animated, ...patch }, viewport), viewport)
    expect(after.x - before.x).toBeCloseTo(-80)
    expect(after.y - before.y).toBeCloseTo(40)
  })

  it('does not create enormous coordinates when the canvas is edge-on', () => {
    const api = createSceneAPI()
    const camera = api.getActiveCamera()!
    const viewport = api.getMeta().canvas
    const resolved = resolveCamera3D(camera, { rotationX: 90 }, viewport)
    expect(cameraCanvasPoint(resolved, { x: viewport.width / 2, y: viewport.height / 2 }, viewport)).toBeNull()
  })

})
