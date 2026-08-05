// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { nodeGeometryPreviewRect } from '@/ui/nodeGeometryPreviewRect'

describe('node geometry preview rect', () => {
  it('reflows only the selected hug-height text proxy at a preview width', () => {
    const api = createSceneAPI()
    const textId = api.createNode('text', null)
    api.setNodeProperty(
      textId,
      'text',
      "See how your team's time turns into billable work.",
    )
    api.setNodeProperty(textId, 'fontSize', 20)
    api.setNodeProperty(textId, 'lineHeight', 1.2)
    api.setNodeProperty(textId, 'size', { width: 'hug', height: 'hug' })
    const node = api.getNode(textId)
    if (node?.kind !== 'text') throw new Error('expected text fixture')

    const base = { x: 30, y: 40, width: 560, height: 24 }
    const preview = nodeGeometryPreviewRect(node, base, {
      size: { width: 120 },
    })

    expect(preview).toMatchObject({ x: 30, y: 40, width: 120 })
    expect(preview.height).toBeGreaterThan(base.height)
    expect(api.getNode(textId)).toMatchObject({
      size: { width: 'hug', height: 'hug' },
    })
  })

  it('honors an explicitly previewed height without measuring the scene', () => {
    const api = createSceneAPI()
    const textId = api.createNode('text', null)
    const node = api.getNode(textId)
    if (node?.kind !== 'text') throw new Error('expected text fixture')

    expect(
      nodeGeometryPreviewRect(
        node,
        { x: 0, y: 0, width: 200, height: 40 },
        { size: { width: 320, height: 96 }, fontSize: 48 },
      ),
    ).toEqual({ x: 0, y: 0, width: 320, height: 96 })
  })
})
