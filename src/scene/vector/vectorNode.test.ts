// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import { createVectorItem, solidVectorPaint } from './model'
import { VectorPathBuilder } from './path'

describe('VectorNode persistence', () => {
  it('creates and updates native vector fields through the scene API', () => {
    const api = createSceneAPI()
    const vector = {
      version: 1 as const,
      items: [
        createVectorItem({
          id: 'logo-item',
          geometry: new VectorPathBuilder('logo')
            .moveTo(50, 0)
            .lineTo(100, 100)
            .lineTo(0, 100)
            .closePath()
            .build(),
          fills: [solidVectorPaint('#ff5500')],
        }),
      ],
    }
    const id = api.createNode('vector', null, {
      name: 'Logo',
      size: { width: 240, height: 'hug' },
      viewBox: { x: -10, y: -20, width: 120, height: 140 },
      vector,
      trimStart: 0.1,
      trimEnd: 0.9,
      trimOffset: 1.25,
      source: { provider: 'figma', sourceNodeId: '12:34', payloadVersion: 2 },
      importFidelity: 'editable',
    })

    const node = api.getNode(id)
    expect(node?.kind).toBe('vector')
    if (!node || node.kind !== 'vector') throw new Error('Expected vector')
    expect(node.vector).toEqual(vector)
    expect(node.trimStart).toBe(0.1)
    expect(node.trimEnd).toBe(0.9)
    expect(node.trimOffset).toBe(1.25)
    expect(node.source?.sourceNodeId).toBe('12:34')

    api.setNodeProperty(id, 'trimStart', 0.4)
    const updated = api.getNode(id)
    expect(updated?.kind === 'vector' ? updated.trimStart : null).toBe(0.4)

    const reopened = readScene(sceneToBytes(api.doc)).api.getNode(id)
    expect(reopened?.kind).toBe('vector')
    if (!reopened || reopened.kind !== 'vector') throw new Error('Expected reopened vector')
    expect(reopened.vector).toEqual(vector)
    expect(reopened.source?.payloadVersion).toBe(2)
  })

  it('normalizes vector defaults when older documents omit them', () => {
    const api = createSceneAPI()
    const id = api.createNode('vector', null)
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    const stored = nodes.get(id)
    if (!stored) throw new Error('Expected stored node')

    api.doc.transact(() => {
      for (const key of [
        'viewBox', 'vector', 'trimStart', 'trimEnd', 'trimOffset',
        'importFidelity',
      ]) stored.delete(key)
    })

    const node = api.getNode(id)
    if (!node || node.kind !== 'vector') throw new Error('Expected legacy vector')
    expect(node.viewBox).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(node.vector).toEqual({ version: 1, items: [] })
    expect([node.trimStart, node.trimEnd, node.trimOffset]).toEqual([0, 1, 0])
    expect(node.importFidelity).toBe('editable')
  })
})
