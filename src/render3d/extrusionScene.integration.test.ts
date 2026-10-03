// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { addKeyframe } from '@/anim/tracks'
import { getAnimEngine } from '@/anim/engine'
import { buildWorldPlanes, hitTestPlanes, resolveCamera3D } from './scene3d'
import { createWorldPlaneAnimationSelector } from './planeAnimationSnapshot'

function fixture() {
  const api = createSceneAPI()
  const viewport = { width: 400, height: 300 }
  const root = api.createNode('frame', null, { size: viewport })
  const group = api.createNode('frame', root, { size: viewport, clipsContent: false })
  const body = api.createNode('rect', group, { size: { width: 100, height: 100 }, extrusion: { depth: 80, sideColor: '#2563eb' } })
  const layout = { [root]: { x: 0, y: 0, ...viewport }, [group]: { x: 0, y: 0, ...viewport }, [body]: { x: 0, y: 0, width: 100, height: 100 } }
  const camera = resolveCamera3D(api.getActiveCamera()!, undefined, viewport)
  return { api, root, group, body, layout, camera, viewport }
}

describe('solid layers in the shared scene pipeline', () => {
  it('extracts an extruded layer under an ordinary flat frame', () => {
    const { api, body, layout, camera } = fixture()
    const plane = buildWorldPlanes(api, layout, {}, camera).find(plane => plane.nodeId === body)
    expect(plane).toMatchObject({ extrusion: { depth: 80 }, rect: { width: 100, height: 100 } })
  })

  it('carries animated depth through the engine and world-plane snapshot without changing saved settings', () => {
    const { api, body, layout, camera } = fixture()
    addKeyframe(api, body, 'extrusion.depth', 0, 0)
    addKeyframe(api, body, 'extrusion.depth', 2, 160)
    const engine = getAnimEngine()
    engine.attach(api)
    const select = createWorldPlaneAnimationSelector()
    engine.seek(0)
    const initial = select(engine.getSnapshot())
    expect(buildWorldPlanes(api, layout, initial, camera).find(plane => plane.nodeId === body)?.extrusion?.depth).toBe(0)
    engine.seek(2)
    const end = select(engine.getSnapshot())
    expect(end).not.toBe(initial)
    expect(buildWorldPlanes(api, layout, end, camera).find(plane => plane.nodeId === body)?.extrusion?.depth).toBe(160)
    expect(api.getNode(body)?.extrusion?.depth).toBe(80)
    engine.pause()
  })

  it('picks a visible side even when the front plane is parallel to the ray', () => {
    const { api, body, layout, camera, viewport } = fixture()
    const planes = buildWorldPlanes(api, layout, {}, camera).filter(plane => plane.nodeId === body)
    const hit = hitTestPlanes(planes, { origin: { x: 200, y: 50, z: 40 }, direction: { x: -1, y: 0, z: 0 } }, camera, viewport)
    expect(hit?.nodeId).toBe(body)
    expect(hit?.point).toEqual({ x: 100, y: 50, z: 40 })
  })

  it('chooses the nearest solid instead of the later painted solid', () => {
    const { api, group, body, layout, camera, viewport } = fixture()
    const original = api.getNode(body)!
    api.setNodeProperty(body, 'transform', { ...original.transform, z: -100 })
    const back = api.createNode('rect', group, { size: { width: 100, height: 100 }, extrusion: { depth: 80, sideColor: '#123456' } })
    api.setNodeProperty(back, 'zIndex', 10)
    const behind = api.getNode(back)!
    api.setNodeProperty(back, 'transform', { ...behind.transform, z: 100 })
    const planes = buildWorldPlanes(api, { ...layout, [back]: layout[body]! }, {}, camera).filter(plane => plane.nodeId === body || plane.nodeId === back)
    expect(planes.at(-1)?.nodeId).toBe(back)
    const hit = hitTestPlanes(planes, { origin: { x: 50, y: 50, z: -500 }, direction: { x: 0, y: 0, z: 1 } }, camera, viewport)
    expect(hit?.nodeId).toBe(body)
    expect(hit?.point.z).toBe(-100)
  })

  it('retains ordinary layer paint order when extrusion settings are absent', () => {
    const { api, group, body, layout, camera, viewport } = fixture()
    api.setNodeProperty(body, 'extrusion', undefined)
    const first = api.getNode(body)!
    api.setNodeProperty(body, 'transform', { ...first.transform, z: -100, renderMode: 'plane' })
    const back = api.createNode('rect', group, { size: { width: 100, height: 100 } })
    api.setNodeProperty(back, 'zIndex', 10)
    const second = api.getNode(back)!
    api.setNodeProperty(back, 'transform', { ...second.transform, z: 100, renderMode: 'plane' })
    const planes = buildWorldPlanes(api, { ...layout, [back]: layout[body]! }, {}, camera).filter(plane => plane.nodeId === body || plane.nodeId === back)
    const hit = hitTestPlanes(planes, { origin: { x: 50, y: 50, z: -500 }, direction: { x: 0, y: 0, z: 1 } }, camera, viewport)
    expect(hit?.nodeId).toBe(back)
  })

  it('keeps an ellipse independently extracted when its animated arc closes into a full solid', () => {
    const { api, group, layout, camera } = fixture()
    const ellipse = api.createNode('ellipse', group, { size: { width: 100, height: 100 }, arc: { startAngle: 0, sweep: 0.5, innerRadius: 0 }, extrusion: { depth: 80, sideColor: '#2563eb' } })
    // Remove the other solid so the ellipse itself must keep the parent from flattening.
    for (const child of api.getNode(group)!.children) if (child !== ellipse) api.deleteNode(child)
    const planes = buildWorldPlanes(api, { ...layout, [ellipse]: { x: 0, y: 0, width: 100, height: 100 } }, { [ellipse]: { arcSweep: 1 } }, camera)
    expect(planes.find(plane => plane.nodeId === ellipse)).toMatchObject({ extrusion: { depth: 80 } })
  })
})


describe('extruded contour animation selection', () => {
  it.each([
    'cornerRadius', 'cornerSmoothing', 'cornerSmoothingEnabled',
    'fullRadius', 'arcSweep', 'arcInnerRadius',
  ] as const)('invalidates %s only for a layer with authored extrusion', property => {
    const select = createWorldPlaneAnimationSelector()
    const nodes = new Map([
      ['solid', { isMask: false, extrusion: { depth: 80, sideColor: '#2563eb' } }],
      ['flat', { isMask: false }],
    ])
    const first = select({ solid: { [property]: 0 }, flat: { [property]: 0 } }, nodes)
    const changed = select({ solid: { [property]: 1 }, flat: { [property]: 0 } }, nodes)
    expect(changed).not.toBe(first)
    expect(changed.solid?.[property]).toBe(1)
    const flatPaintChange = select({ solid: { [property]: 1 }, flat: { [property]: 5 } }, nodes)
    expect(flatPaintChange).toBe(changed)
    expect(flatPaintChange.flat).toBeUndefined()
  })

  it('drops contour-only overrides after the body is disabled without changing the source animation', () => {
    const select = createWorldPlaneAnimationSelector()
    const source = { solid: { cornerRadius: 20, cornerSmoothing: 0.5 } }
    const enabled = select(source, new Map([['solid', { isMask: false, extrusion: { depth: 80 } }]]))
    expect(enabled.solid).toEqual(source.solid)
    const disabled = select(source, new Map([['solid', { isMask: false }]]))
    expect(disabled).toEqual({})
  })
})
