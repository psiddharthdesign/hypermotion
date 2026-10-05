// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { defaultArrangement } from '@/scene/arrangement'
import { createArrangement, removeArrangementMember } from '@/scene/arrangementActions'
import { arrangementLayerOwner, layerPanelChildren, layerPanelParent } from './arrangementLayerTree'

describe('arrangement layer groups', () => {
  it('lists members once under their arrangement, retaining scene parents and transforms', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const id = createArrangement(api, [], {})!
    const arrangement = api.getNode(id)!
    const before = arrangement.arrangement!.memberIds.map((key) => api.getNode(key)!)
    expect(layerPanelChildren(api, api.getNode(root)!).map((n) => n.id)).toEqual([id])
    expect(layerPanelChildren(api, arrangement)).toEqual(before)
    for (const node of before) {
      expect(layerPanelParent(api, node)).toBe(id)
      expect(node.parent).toBe(root)
      expect(api.getNode(node.id)).toEqual(node)
    }
    const reversed = before.map((n) => n.id).reverse()
    api.setNodeProperty(id, 'arrangement', { ...arrangement.arrangement!, memberIds: reversed })
    expect(layerPanelChildren(api, api.getNode(id)!).map((n) => n.id)).toEqual(reversed)
    removeArrangementMember(api, id, before[0]!.id)
    expect(layerPanelParent(api, api.getNode(before[0]!.id)!)).toBe(root)
    expect(layerPanelChildren(api, api.getNode(root)!).map((n) => n.id)).toEqual([id, before[0]!.id])
  })
  it('leaves unrelated layers visible and ignores stale membership', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const unrelated = api.createNode('rect', root)
    const id = createArrangement(api, [], {})!
    const owner = api.getNode(id)!
    api.setNodeProperty(id, 'arrangement', { ...owner.arrangement!, memberIds: [...owner.arrangement!.memberIds, unrelated, 'missing'] })
    expect(arrangementLayerOwner(api, api.getNode(unrelated)!)).toBeNull()
    expect(layerPanelChildren(api, api.getNode(id)!)).toHaveLength(9)
    expect(layerPanelChildren(api, api.getNode(root)!).map((n) => n.id)).toEqual([unrelated, id])
  })
})


describe('nested arrangement presentation', () => {
  it('keeps the arrangement inside the original container and lists each card once', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const container = api.createNode('frame', root, { name: 'Integration orbit' })
    const decoration = api.createNode('ellipse', container)
    const owner = api.createNode('arrangement', root, { arrangement: defaultArrangement('radial') })
    const members = [api.createNode('frame', container), api.createNode('frame', container)]
    for (const id of members) api.setNodeProperty(id, 'transformParent', { nodeId: owner, inverseBind: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] })
    api.setNodeProperty(owner, 'arrangement', { ...defaultArrangement('radial'), memberIds: members })
    const before = members.map(id => api.getNode(id))
    expect(layerPanelChildren(api, api.getNode(root)!).map(n => n.id)).toEqual([container])
    expect(layerPanelParent(api, api.getNode(owner)!)).toBe(container)
    expect(layerPanelChildren(api, api.getNode(container)!).map(n => n.id)).toEqual([decoration, owner])
    expect(layerPanelChildren(api, api.getNode(owner)!).map(n => n.id)).toEqual(members)
    expect(members.map(id => api.getNode(id))).toEqual(before)
    expect(api.getNode(owner)!.parent).toBe(root)
    removeArrangementMember(api, owner, members[0]!)
    expect(layerPanelParent(api, api.getNode(members[0]!)!)).toBe(container)
    expect(layerPanelChildren(api, api.getNode(container)!).map(n => n.id)).toContain(members[0])
  })
  it('uses the shared ancestor for cards across multiple containers', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const shared = api.createNode('frame', root)
    const left = api.createNode('frame', shared)
    const right = api.createNode('frame', shared)
    const owner = api.createNode('arrangement', root, { arrangement: defaultArrangement('radial') })
    const members = [api.createNode('rect', left), api.createNode('rect', right)]
    for (const id of members) api.setNodeProperty(id, 'transformParent', { nodeId: owner, inverseBind: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] })
    api.setNodeProperty(owner, 'arrangement', { ...defaultArrangement('radial'), memberIds: members })
    expect(layerPanelParent(api, api.getNode(owner)!)).toBe(shared)
    expect(layerPanelChildren(api, api.getNode(left)!)).toEqual([])
    expect(layerPanelChildren(api, api.getNode(right)!)).toEqual([])
    expect(layerPanelChildren(api, api.getNode(shared)!).map(n => n.id)).toEqual([left,right,owner])
  })
})
