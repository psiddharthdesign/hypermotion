// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { SolvedLayout } from '@/layout'
import {
  buildWorldPlanes,
  hitTestPlanes,
  resolveCamera3D,
  viewportPointToRay,
} from '@/render3d/scene3d'

describe('direct nested-layer hit testing', () => {
  it('expands flattened camera planes and hits the nested child', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const parentId = api.createNode('frame', rootId, {
      name: 'Card',
      size: { width: 300, height: 200 },
    })
    const childId = api.createNode('text', parentId, {
      name: 'Nested label',
      text: 'Nested label',
      size: { width: 120, height: 32 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [parentId]: { x: 100, y: 100, width: 300, height: 200 },
      [childId]: { x: 140, y: 150, width: 120, height: 32 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const viewport = { width: 960, height: 540 }
    const resolvedCamera = resolveCamera3D(camera, undefined, viewport)

    const normalPlanes = buildWorldPlanes(
      api,
      layout,
      {},
      resolvedCamera,
    )
    expect(normalPlanes.map((plane) => plane.nodeId)).toEqual([parentId])

    const directSelectionPlanes = buildWorldPlanes(
      api,
      layout,
      {},
      resolvedCamera,
      { independentNodes: true },
    )
    expect(directSelectionPlanes.map((plane) => plane.nodeId)).toEqual([
      parentId,
      childId,
    ])

    const childCenter = { x: 200, y: 166 }
    const hit = hitTestPlanes(
      directSelectionPlanes,
      viewportPointToRay(
        resolvedCamera,
        childCenter.x,
        childCenter.y,
        viewport,
      ),
      resolvedCamera,
      viewport,
    )
    expect(hit?.nodeId).toBe(childId)
  })
})

describe('hierarchical WebGL visibility', () => {
  it('does not emit a visible child plane below a hidden group3d parent', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const parentId = api.createNode('frame', rootId, {
      name: 'Hidden 3D group',
      size: { width: 300, height: 200 },
      transform: {
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
        scaleX: 1,
        scaleY: 1,
        anchorX: 0.5,
        anchorY: 0.5,
        anchorZ: 0,
        renderMode: 'group3d',
      },
    })
    const childId = api.createNode('rect', parentId, {
      name: 'Visible child',
      size: { width: 120, height: 80 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [parentId]: { x: 100, y: 100, width: 300, height: 200 },
      [childId]: { x: 140, y: 140, width: 120, height: 80 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })

    expect(
      buildWorldPlanes(api, layout, {}, resolvedCamera).map(
        (plane) => plane.nodeId,
      ),
    ).toEqual([parentId, childId])

    api.setNodeProperty(parentId, 'visible', false)

    expect(buildWorldPlanes(api, layout, {}, resolvedCamera)).toEqual([])
  })

  it('does not emit extracted video children below a hidden container', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const parentId = api.createNode('frame', rootId, {
      name: 'Hidden video container',
      size: { width: 300, height: 200 },
    })
    const videoId = api.createNode('video', parentId, {
      name: 'Video',
      size: { width: 160, height: 90 },
      src: 'test.mp4',
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [parentId]: { x: 100, y: 100, width: 300, height: 200 },
      [videoId]: { x: 120, y: 120, width: 160, height: 90 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })

    expect(
      buildWorldPlanes(api, layout, {}, resolvedCamera).map(
        (plane) => plane.nodeId,
      ),
    ).toEqual([parentId, videoId])

    api.setNodeProperty(parentId, 'visible', false)

    expect(buildWorldPlanes(api, layout, {}, resolvedCamera)).toEqual([])
  })

  it('does not emit any scene planes when the root is hidden', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const childId = api.createNode('rect', rootId, {
      name: 'Root child',
      size: { width: 120, height: 80 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [childId]: { x: 100, y: 100, width: 120, height: 80 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })

    api.setNodeProperty(rootId, 'visible', false)

    expect(buildWorldPlanes(api, layout, {}, resolvedCamera)).toEqual([])
  })
})

describe('hierarchical WebGL opacity', () => {
  it.each([
    ['flat', 'flat'],
    ['3D plane', 'plane'],
    ['3D group', 'group3d'],
  ] as const)(
    'keeps animated opacity on the %s plane material',
    (_label, renderMode) => {
      const api = createSceneAPI()
      const rootId = api.createNode('frame', null, {
        name: 'Root',
        size: { width: 960, height: 540 },
      })
      const cardId = api.createNode('frame', rootId, {
        name: 'Card',
        size: { width: 300, height: 200 },
        transform: {
          x: 0,
          y: 0,
          z: 0,
          rotation: 0,
          rotationX: 0,
          rotationY: 0,
          scaleX: 1,
          scaleY: 1,
          anchorX: 0.5,
          anchorY: 0.5,
          anchorZ: 0,
          renderMode,
        },
      })
      const layout: SolvedLayout = {
        [rootId]: { x: 0, y: 0, width: 960, height: 540 },
        [cardId]: { x: 100, y: 100, width: 300, height: 200 },
      }
      const camera = api.getActiveCamera()
      if (!camera) throw new Error('Expected the default camera')
      const resolvedCamera = resolveCamera3D(camera, undefined, {
        width: 960,
        height: 540,
      })

      const opacityAt = (opacity: number) =>
        buildWorldPlanes(
          api,
          layout,
          { [cardId]: { opacity } },
          resolvedCamera,
        ).find((plane) => plane.nodeId === cardId)?.opacity

      expect(opacityAt(0)).toBe(0)
      expect(opacityAt(0.5)).toBe(0.5)
      expect(opacityAt(1)).toBe(1)
    },
  )

  it('multiplies a 3D group fade through each independently emitted child', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const groupId = api.createNode('frame', rootId, {
      name: 'Group',
      size: { width: 300, height: 200 },
      transform: {
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
        scaleX: 1,
        scaleY: 1,
        anchorX: 0.5,
        anchorY: 0.5,
        anchorZ: 0,
        renderMode: 'group3d',
      },
    })
    const cardId = api.createNode('rect', groupId, {
      name: 'Nested card',
      size: { width: 120, height: 80 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [groupId]: { x: 100, y: 100, width: 300, height: 200 },
      [cardId]: { x: 140, y: 140, width: 120, height: 80 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })

    const planes = buildWorldPlanes(
      api,
      layout,
      {
        [groupId]: { opacity: 0.5 },
        [cardId]: { opacity: 0.4 },
      },
      resolvedCamera,
    )

    expect(planes.find((plane) => plane.nodeId === groupId)?.opacity).toBe(0.5)
    expect(planes.find((plane) => plane.nodeId === cardId)?.opacity).toBeCloseTo(0.2)
  })
})
