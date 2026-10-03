// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import { defaultArrangement } from '@/scene/arrangement'
import { createIsometricAsset } from './isometricAssetAuthoring'
import { selectedSolidNodeIds } from './solidFaceSelection'

function arrangementFor(api: SceneAPI, members: string[]): string {
  const id = api.createNode('arrangement', api.getRoot(), { arrangement: { ...defaultArrangement(), memberIds: members } })
  for (const member of members) api.setNodeProperty(member, 'transformParent', {
    nodeId: id, inverseBind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  })
  return id
}

describe('solid face selection' , () => {
  it('edits descendant parts of an asset once, while ignoring the scene root', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const group = createIsometricAsset(api, 'block')
    const body = api.getChildren(group)[0]!.id
    expect([...selectedSolidNodeIds(api, [group, body])]).toEqual([body])
    expect(selectedSolidNodeIds(api, [api.getRoot()]).size).toBe(0)
  })
  it('honors hidden and locked ancestors even for directly selected faces', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const group = createIsometricAsset(api, 'platform')
    const body = api.getChildren(group)[0]!.id
    api.setNodeProperty(group, 'locked', true)
    expect(selectedSolidNodeIds(api, [body, group]).size).toBe(0)
    api.setNodeProperty(group, 'locked', false)
    api.setNodeProperty(group, 'visible', false)
    expect(selectedSolidNodeIds(api, [body]).size).toBe(0)
    api.setNodeProperty(group, 'visible', true)
    expect([...selectedSolidNodeIds(api, [group])]).toEqual([body])
  })
  it('exposes linked arrangement members without changing their real layout parents', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const parent = api.createNode('frame', api.getRoot())
    const group = createIsometricAsset(api, 'block', { parentId: parent })
    const body = api.getChildren(group)[0]!.id
    const arrangement = arrangementFor(api, [group])
    expect([...selectedSolidNodeIds(api, [arrangement, group, body])]).toEqual([body])
    expect(api.getNode(group)!.parent).toBe(parent)
    api.doc.destroy()
  })

  it('honors real ancestors of arrangement members even when the controller is elsewhere in the layer tree', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const parent = api.createNode('frame', api.getRoot())
    const group = createIsometricAsset(api, 'platform', { parentId: parent })
    const body = api.getChildren(group)[0]!.id
    const arrangement = arrangementFor(api, [group])
    for (const [field, blocked, allowed] of [['locked', true, false], ['visible', false, true], ['workspaceOnly', true, false]] as const) {
      api.setNodeProperty(parent, field, blocked)
      expect(selectedSolidNodeIds(api, [arrangement, body]).size).toBe(0)
      api.setNodeProperty(parent, field, allowed)
      expect([...selectedSolidNodeIds(api, [arrangement])]).toEqual([body])
    }
    api.doc.destroy()
  })

  it('honors the arrangement lock and visibility when a contained face is selected directly', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const group = createIsometricAsset(api, 'block')
    const body = api.getChildren(group)[0]!.id
    const arrangement = arrangementFor(api, [group])
    api.setNodeProperty(arrangement, 'locked', true)
    expect(selectedSolidNodeIds(api, [arrangement, body]).size).toBe(0)
    api.setNodeProperty(arrangement, 'locked', false)
    api.setNodeProperty(arrangement, 'visible', false)
    expect(selectedSolidNodeIds(api, [body]).size).toBe(0)
    api.setNodeProperty(arrangement, 'visible', true)
    expect([...selectedSolidNodeIds(api, [body])]).toEqual([body])
    api.doc.destroy()
  })

  it('ignores stale, cyclic, missing, workspace and cross-scene arrangement members', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const group = createIsometricAsset(api, 'block')
    const body = api.getChildren(group)[0]!.id
    const stale = createIsometricAsset(api, 'platform')
    const otherRoot = api.createNode('frame', null)
    const outside = createIsometricAsset(api, 'block', { parentId: otherRoot })
    const arrangement = arrangementFor(api, [group, outside])
    api.setNodeProperty(arrangement, 'arrangement', { ...defaultArrangement(), memberIds: [group, group, stale, outside, 'missing', arrangement] })
    expect([...selectedSolidNodeIds(api, [arrangement, outside])]).toEqual([body])
    api.setNodeProperty(group, 'workspaceOnly', true)
    expect(selectedSolidNodeIds(api, [arrangement]).size).toBe(0)
    api.doc.destroy()
  })

})
