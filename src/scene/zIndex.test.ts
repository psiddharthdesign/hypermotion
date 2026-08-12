// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import {
  MAX_LAYER_Z_INDEX,
  MIN_LAYER_Z_INDEX,
  normalizeLayerZIndex,
} from '@/scene/zIndex'

function persistedNode(api: ReturnType<typeof createSceneAPI>, id: string) {
  const scene = api.doc.getMap<unknown>('scene')
  const nodes = scene.get('nodes') as Y.Map<Y.Map<unknown>>
  const node = nodes.get(id)
  if (!node) throw new Error(`Missing test node: ${id}`)
  return node
}

describe('layer z-index persistence', () => {
  it('defaults missing and invalid legacy values to zero', () => {
    const api = createSceneAPI()
    const id = api.createNode('rect', api.getRoot())
    const node = persistedNode(api, id)

    node.delete('zIndex')
    expect(api.getNode(id)?.zIndex).toBe(0)

    node.set('zIndex', 'front')
    expect(api.getNode(id)?.zIndex).toBe(0)
    api.doc.destroy()
  })

  it('rounds, clamps, updates, and round-trips authored values', () => {
    expect(normalizeLayerZIndex(-10_500)).toBe(MIN_LAYER_Z_INDEX)
    expect(normalizeLayerZIndex(4.6)).toBe(5)
    expect(normalizeLayerZIndex(10_500)).toBe(MAX_LAYER_Z_INDEX)

    const source = createSceneAPI()
    const id = source.createNode('rect', source.getRoot(), { zIndex: 7 })
    expect(source.getNode(id)?.zIndex).toBe(7)

    source.setNodeProperty(id, 'zIndex', -4)
    const restored = readScene(sceneToBytes(source.doc))
    expect(restored.api.getNode(id)?.zIndex).toBe(-4)

    restored.doc.destroy()
    source.doc.destroy()
  })
})
