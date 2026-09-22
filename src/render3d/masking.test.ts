// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { AnimatedValue } from '@/anim/engine'
import type { SolvedLayout } from '@/layout'
import { buildWorldPlanes, resolveCamera3D, hitTestPlanes, viewportPointToRay } from './scene3d'
import { clipContainsPoint } from './planeClipping'
import { createWorldPlaneAnimationSelector } from './planeAnimationSnapshot'
import { intersectMaskPolygons, maskOutline } from '@/render/maskShape'

function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const mask = api.createNode('rect', root, { isMask: true, size: { width: 100, height: 100 } })
  const card = api.createNode('frame', root, { clipsContent: false, size: { width: 300, height: 200 } })
  const child = api.createNode('rect', card, { size: { width: 300, height: 200 } })
  const other = api.createNode('rect', root, { size: { width: 40, height: 40 } })
  const layout: SolvedLayout = {
    [root]: { x: 0, y: 0, width: 960, height: 540 },
    [mask]: { x: 100, y: 100, width: 100, height: 100 },
    [card]: { x: 50, y: 50, width: 300, height: 200 },
    [child]: { x: 50, y: 50, width: 300, height: 200 },
    [other]: { x: 600, y: 100, width: 40, height: 40 },
  }
  const camera = resolveCamera3D(api.getActiveCamera()!, { x: 480, y: 270 }, { width: 960, height: 540 })
  const build = (animated: Record<string, AnimatedValue> = {}, independentNodes = false) => buildWorldPlanes(api, layout, animated, camera, { independentNodes })
  return { api, root, mask, card, child, other, layout, camera, build }
}

describe('sibling shape masks', () => {
  it('hides the mask and clips only its authored next sibling regardless of paint order', () => {
    const { api, mask, card, other, build } = setup()
    api.setNodeProperty(mask, 'zIndex', 99)
    const planes = build()
    expect(planes.some(p => p.nodeId === mask)).toBe(false)
    const clip = planes.find(p => p.nodeId === card)!.clips![0]!
    expect(clipContainsPoint(clip, { x: 150, y: 150, z: 0 })).toBe(true)
    expect(clipContainsPoint(clip, { x: 99, y: 150, z: 0 })).toBe(false)
    expect(planes.find(p => p.nodeId === other)!.clips).toBeUndefined()
  })

  it('keeps a stationary mask fixed while the content translates and rotates', () => {
    const { card, build } = setup()
    const first = build().find(p => p.nodeId === card)!
    const moved = build({ [card]: { x: 120, rotation: 30 } }).find(p => p.nodeId === card)!
    expect(moved.center).not.toEqual(first.center)
    expect(moved.clips).toEqual(first.clips)
  })

  it('animates mask position, rotation and scale independently and clips extracted children', () => {
    const { mask, card, child, build } = setup()
    const planes = build({ [mask]: { x: 30, rotation: 45, scaleX: 2 } }, true)
    const clip = planes.find(p => p.nodeId === card)!.clips![0]!
    expect(clip.center.x).toBeCloseTo(180)
    expect(clip.center.y).toBeCloseTo(150)
    expect(clipContainsPoint(clip, clip.center)).toBe(true)
    expect(planes.find(p => p.nodeId === child)!.clips).toEqual([clip])
  })

  it('excludes clipped pixels from hit testing while retaining mask selection guides', () => {
    const { api, layout, mask, card, camera, build } = setup()
    const viewport = { width: 960, height: 540 }
    const inside = hitTestPlanes(build(), viewportPointToRay(camera, 150, 150, viewport), camera, viewport)
    const outside = hitTestPlanes(build(), viewportPointToRay(camera, 75, 150, viewport), camera, viewport)
    expect(inside?.nodeId).toBe(card)
    expect(outside).toBeNull()
    const guides = buildWorldPlanes(api, layout, {}, camera, { independentNodes: true, targetNodeIds: new Set([mask]), includeMaskGuides: true })
    expect(guides.map(p => p.nodeId)).toEqual([mask])
  })

  it('hides all content when a mask collapses to zero scale', () => {
    const { mask, card, build } = setup()
    const clip = build({ [mask]: { scaleX: 0 } }).find(p => p.nodeId === card)!.clips![0]!
    expect(clipContainsPoint(clip, clip.center)).toBe(false)
    expect(clipContainsPoint(clip, { x: 180, y: 150, z: 0 })).toBe(false)
  })

  it('releases hidden masks and masks with the flag removed', () => {
    const { api, mask, card, build } = setup()
    api.setNodeProperty(mask, 'visible', false)
    expect(build().find(p => p.nodeId === card)!.clips).toBeUndefined()
    api.setNodeProperty(mask, 'visible', true)
    api.setNodeProperty(mask, 'isMask', false)
    expect(build().find(p => p.nodeId === card)!.clips).toBeUndefined()
    expect(build().some(p => p.nodeId === mask)).toBe(true)
  })

  it('uses rounded and circular silhouettes rather than their bounding boxes', () => {
    const { api, mask, card, layout, build } = setup()
    const node = api.getNode(mask)!
    api.setNodeProperty(mask, 'appearance', { ...node.appearance, cornerRadius: 50 })
    const clip = build().find(p => p.nodeId === card)!.clips![0]!
    expect(clipContainsPoint(clip, { x: 101, y: 101, z: 0 })).toBe(false)
    expect(clipContainsPoint(clip, { x: 150, y: 150, z: 0 })).toBe(true)
    const ellipseId = api.createNode('ellipse', null)
    const ellipse = api.getNode(ellipseId)!
    expect(maskOutline(ellipse, layout[mask]!).length).toBe(64)
  })

  it('keeps animated mask corners in the renderer snapshot without invalidating ordinary paint', () => {
    const select = createWorldPlaneAnimationSelector()
    const nodes = new Map([['mask', { isMask: true }], ['card', { isMask: false }]])
    const first = select({ mask: { cornerRadius: 0 }, card: { cornerRadius: 20 } }, nodes)
    const next = select({ mask: { cornerRadius: 50 }, card: { cornerRadius: 25 } }, nodes)
    expect(next).not.toBe(first)
    expect(next.mask?.cornerRadius).toBe(50)
    expect(next.card).toBeUndefined()
  })

  it('intersects nested silhouettes including mirrored polygon winding', () => {
    const a = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]
    const b = [{x:50,y:50},{x:150,y:50},{x:150,y:150},{x:50,y:150}]
    for (const clip of [b, [...b].reverse()]) {
      const result = intersectMaskPolygons(a, clip)
      expect(Math.min(...result.map(p => p.x))).toBe(50)
      expect(Math.max(...result.map(p => p.y))).toBe(100)
    }
  })
})
