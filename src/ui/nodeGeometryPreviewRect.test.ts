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

  it('offsets the rect by a previewed position delta, matching a W/N-handle drag', () => {
    // Regression test: dragging a west/north-side resize handle shifts the
    // OPPOSITE edge's anchor (see ResizeHandles.tsx), previewed as a new
    // absolute transform.x/y. This rect must translate by the same delta,
    // or the live selection outline anchors on the wrong corner for the
    // whole gesture and only snaps to the correct side once it commits.
    const api = createSceneAPI()
    const rectId = api.createNode('rect', null, {
      transform: { x: 100, y: 50, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1 },
    })
    const node = api.getNode(rectId)
    if (!node) throw new Error('expected rect fixture')

    const base = { x: 100, y: 50, width: 200, height: 150 }
    // Dragging the west handle 60px left: width grows to 260, and the
    // opposite (right) edge stays fixed, so x shifts to 100 - 60 = 40.
    const preview = nodeGeometryPreviewRect(node, base, {
      size: { width: 260 },
      transform: { x: 40 },
    })

    expect(preview).toMatchObject({ x: 40, y: 50, width: 260, height: 150 })
  })
})
