// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import {
  applyRenderModeToSelection,
  renderModeEligibleNodes,
} from './multiRenderMode'

describe('multi-selection render mode', () => {
  it('updates all renderable layers in one document transaction', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, { name: 'Root' })
    const frameId = api.createNode('frame', rootId, { name: 'Card' })
    const textId = api.createNode('text', rootId, {
      name: 'Label',
      text: 'Label',
    })
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected a default camera')
    const nodes = [api.getNode(frameId), api.getNode(textId), camera].filter(
      (node): node is NonNullable<typeof node> => !!node,
    )
    let updates = 0
    api.doc.on('update', () => updates++)

    expect(renderModeEligibleNodes(nodes).map((node) => node.id)).toEqual([
      frameId,
      textId,
    ])
    expect(applyRenderModeToSelection(api, nodes, 'plane')).toBe(2)
    expect(updates).toBe(1)
    expect(api.getNode(frameId)?.transform.renderMode).toBe('plane')
    expect(api.getNode(textId)?.transform.renderMode).toBe('plane')
    expect(api.getNode(camera.id)?.transform.renderMode).toBe('flat')
  })
})
