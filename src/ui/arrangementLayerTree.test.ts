// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
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
