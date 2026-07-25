// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import {
  ALWAYS_ON_TOP_RENDER_ORDER_BASE,
  alwaysOnTopRootsInPaintOrder,
  layerRenderOrder,
  moveAlwaysOnTopSubtreesLast,
  partitionAlwaysOnTopSubtrees,
} from '@/render/layerCompositing'

describe('always-on-top layer compositing', () => {
  it('persists the instance flag and keeps its materialized subtree together', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const sceneId = api.createNode('frame', rootId, {
      name: 'Scene',
      size: { width: 640, height: 360 },
    })
    const overlayId = api.createNode('instance', rootId, {
      name: 'Overlay',
      componentId: 'component',
      alwaysOnTop: true,
      size: { width: 48, height: 48 },
    })
    const overlayChildId = api.createNode('rect', overlayId, {
      name: 'Overlay artwork',
      size: { width: 48, height: 48 },
    })

    const reopened = readScene(sceneToBytes(api.doc)).api
    expect(reopened.getNode(overlayId)).toMatchObject({
      kind: 'instance',
      alwaysOnTop: true,
    })

    const baseOrder = [rootId, overlayId, overlayChildId, sceneId]
    expect(moveAlwaysOnTopSubtreesLast(reopened, baseOrder)).toEqual([
      rootId,
      sceneId,
      overlayId,
      overlayChildId,
    ])
    expect(partitionAlwaysOnTopSubtrees(reopened, baseOrder)).toEqual({
      normal: [rootId, sceneId],
      overlay: [overlayId, overlayChildId],
    })
  })

  it('assigns overlays a separate render band and returns outer roots in paint order', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const topOverlayId = api.createNode('instance', rootId, {
      name: 'Top overlay',
      componentId: 'component-a',
      alwaysOnTop: true,
      size: { width: 48, height: 48 },
    })
    const lowerOverlayId = api.createNode('instance', rootId, {
      name: 'Lower overlay',
      componentId: 'component-b',
      alwaysOnTop: true,
      size: { width: 48, height: 48 },
    })
    const nestedOverlayId = api.createNode('instance', topOverlayId, {
      name: 'Nested overlay',
      componentId: 'component-c',
      alwaysOnTop: true,
      size: { width: 24, height: 24 },
    })
    const normal = api.createNode('rect', rootId, {
      name: 'Normal',
      size: { width: 100, height: 100 },
    })

    expect(alwaysOnTopRootsInPaintOrder(api)).toEqual([
      lowerOverlayId,
      topOverlayId,
    ])
    const overlay = api.getNode(topOverlayId)
    const scene = api.getNode(normal)
    if (!overlay || !scene) throw new Error('Expected test nodes')
    expect(layerRenderOrder(scene, 12)).toBe(12)
    expect(layerRenderOrder(overlay, 3)).toBe(
      ALWAYS_ON_TOP_RENDER_ORDER_BASE + 3,
    )
    expect(alwaysOnTopRootsInPaintOrder(api)).not.toContain(nestedOverlayId)
  })
})
