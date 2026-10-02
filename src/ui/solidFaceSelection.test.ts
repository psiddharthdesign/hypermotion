// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { createIsometricAsset } from './isometricAssetAuthoring'
import { selectedSolidNodeIds } from './solidFaceSelection'

describe('solid face selection', () => {
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
})
