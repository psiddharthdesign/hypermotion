// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { defaultArrangement } from '@/scene/arrangement'
import { buildWorldPlanes, resolveCamera3D, type Plane3D } from './scene3d'
import { createArrangement } from '@/scene/arrangementActions'
import { sortArrangementPlanes } from './arrangementPaintOrder'

function fixture() {
  const api = createSceneAPI()
  const controller = api.createNode('arrangement', null, { arrangement: defaultArrangement('radial') })
  const a = api.createNode('frame', null)
  const child = api.createNode('text', a)
  const b = api.createNode('frame', null)
  const outside = api.createNode('rect', null)
  for (const id of [a, b]) api.setNodeProperty(id, 'transformParent', { nodeId: controller, inverseBind: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] })
  api.setNodeProperty(controller, 'arrangement', { ...defaultArrangement('radial'), memberIds: [a,b] })
  const nodes = new Map([controller,a,child,b,outside].map(id => [id,api.getNode(id)!]))
  const plane = (id: string, paintOrder: number, cameraDepth: number, alwaysOnTop = false) => ({ nodeId: id, node: nodes.get(id)!, paintOrder, cameraDepth, alwaysOnTop } as Plane3D)
  return { a, child, b, outside, nodes, plane }
}

describe('Orbit member compositing', () => {
  it('puts the nearer card last despite the document order and keeps its extracted logo above its backing', () => {
    const { a, child, b, nodes, plane } = fixture()
    const original = [plane(a,0,100),plane(child,1,999),plane(b,2,300)]
    const result = sortArrangementPlanes(original,nodes)
    expect(result.map(p => p.nodeId)).toEqual([b,a,child])
    expect(result.map(p => p.paintOrder)).toEqual([0,1,2])
    expect(original.map(p => p.nodeId)).toEqual([a,child,b])
    expect(original.map(p => p.paintOrder)).toEqual([0,1,2])
  })
  it('changes the stack when orbit or camera movement reverses the depths', () => {
    const { a, b, nodes, plane } = fixture()
    expect(sortArrangementPlanes([plane(a,0,300),plane(b,1,100)],nodes).map(p => p.nodeId)).toEqual([a,b])
    expect(sortArrangementPlanes([plane(a,0,100),plane(b,1,300)],nodes).map(p => p.nodeId)).toEqual([b,a])
  })
  it('preserves coplanar stacking and unrelated layer slots', () => {
    const { a, child, b, outside, nodes, plane } = fixture()
    expect(sortArrangementPlanes([plane(a,0,100),plane(child,1,100),plane(outside,2,0),plane(b,3,100)],nodes).map(p => p.nodeId)).toEqual([a,child,outside,b])
    expect(sortArrangementPlanes([plane(a,0,100),plane(child,1,100),plane(outside,2,0),plane(b,3,200)],nodes).map(p => p.nodeId)).toEqual([b,a,outside,child])
  })
  it('retains the explicit always-on-top overlay band', () => {
    const { a, child, b, nodes, plane } = fixture()
    const overlay = plane(child,2,999,true)
    const result = sortArrangementPlanes([plane(a,0,100),plane(b,1,300),overlay],nodes)
    expect(result.map(p => p.nodeId)).toEqual([b,a,child])
    expect(result[2]).toBe(overlay)
  })
})


describe('Animated orbit depth integration', () => {
  it('uses the resolved camera and orbit pose on every frame', () => {
    const api = createSceneAPI()
    const viewport = { width: 960, height: 540 }
    const root = api.createNode('frame', null, { size: viewport, clipsContent: false })
    const a = api.createNode('frame', root, { size: { width: 100, height: 100 } })
    const b = api.createNode('frame', root, { size: { width: 100, height: 100 } })
    const layout = {
      [root]: { x: 0, y: 0, ...viewport },
      [a]: { x: 100, y: 100, width: 100, height: 100 },
      [b]: { x: 600, y: 100, width: 100, height: 100 },
    }
    const controller = createArrangement(api, [a,b], layout)!
    api.setNodeProperty(controller, 'arrangement', { ...api.getNode(controller)!.arrangement!, mode: 'radial', radius: 200, rotationX: 70, rotationY: 25, orientation: 'screen' })
    const fronts = new Set<string>()
    for (const orbit of [0,90,180,270]) {
      for (const rotationY of [0,40]) {
        const camera = resolveCamera3D(api.getActiveCamera()!, { x: 480, y: 270, rotationY }, viewport)
        const cards = buildWorldPlanes(api, layout, { [controller]: { arrangement: { orbit } } }, camera).filter(p => p.nodeId === a || p.nodeId === b)
        expect(cards).toHaveLength(2)
        expect(cards[0]!.cameraDepth).toBeGreaterThanOrEqual(cards[1]!.cameraDepth - 1e-6)
        expect(cards[0]!.paintOrder).toBeLessThan(cards[1]!.paintOrder)
        fronts.add(cards[1]!.nodeId)
      }
    }
    expect(fronts.size).toBe(2)
  })
})
