// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { SolvedLayout } from '@/layout'
import { createSceneAPI } from '@/scene/doc'
import { buildWorldPlanes, resolveCamera3D } from './scene3d'

describe('WebGL vector effect texture bounds', () => {
  it('expands a flattened parent plane for a descendant SVG shadow', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const parentId = api.createNode('frame', rootId, {
      name: 'Card',
      size: { width: 200, height: 160 },
    })
    const vectorId = api.createNode('vector', parentId, {
      name: 'SVG',
      size: { width: 40, height: 40 },
      appearance: {
        opacity: 1,
        fill: null,
        stroke: null,
        cornerRadius: 0,
        effects: [
          {
            kind: 'shadow',
            color: '#00000080',
            offsetX: 10,
            offsetY: -4,
            blur: 8,
            spread: 0,
          },
        ],
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [parentId]: { x: 100, y: 80, width: 200, height: 160 },
      [vectorId]: { x: 280, y: 220, width: 40, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')

    const parentPlane = buildWorldPlanes(
      api,
      layout,
      {},
      resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
    ).find((plane) => plane.nodeId === parentId)

    expect(parentPlane?.contentMode).toBe('subtree')
    expect(parentPlane?.textureRect).toEqual({
      x: 100,
      y: 80,
      width: 246,
      height: 192,
    })
  })

  it('expands an independently rendered SVG plane without changing hit bounds', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      size: { width: 960, height: 540 },
    })
    const vectorId = api.createNode('vector', rootId, {
      size: { width: 40, height: 40 },
      appearance: {
        opacity: 1,
        fill: null,
        stroke: null,
        cornerRadius: 0,
        effects: [
          {
            kind: 'shadow',
            color: '#00000080',
            offsetX: 10,
            offsetY: -4,
            blur: 8,
          },
        ],
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [vectorId]: { x: 280, y: 220, width: 40, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')

    const vectorPlane = buildWorldPlanes(
      api,
      layout,
      {},
      resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
      { independentNodes: true },
    ).find((plane) => plane.nodeId === vectorId)

    expect(vectorPlane?.rect).toEqual(layout[vectorId])
    expect(vectorPlane?.textureRect).toEqual({
      x: 274,
      y: 200,
      width: 72,
      height: 72,
    })
  })
})
