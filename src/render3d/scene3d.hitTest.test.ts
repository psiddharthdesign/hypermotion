// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TEXT_ANIMATION,
  applyTextAnimation,
} from '@/anim/textAnimations'
import { defaultTextMotionPath } from '@/anim/textMotionPath'
import { createSceneAPI } from '@/scene/doc'
import type { SolvedLayout } from '@/layout'
import {
  buildWorldPlanes,
  createPlaneBuildContext,
  hitTestPlanes,
  resolveCamera3D,
  textNodeNeedsSegmentPlane,
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

describe('stable animated-text plane topology', () => {
  it('extracts stock letter staggers onto the atlas-backed segment path', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const cardId = api.createNode('frame', rootId, {
      name: 'Card',
      size: { width: 300, height: 200 },
    })
    const textId = api.createNode('text', cardId, {
      name: 'Staggered label',
      text: 'Smooth letters',
      size: { width: 220, height: 48 },
    })
    const config = applyTextAnimation(api, textId, 'slide-up', 0)
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [cardId]: { x: 100, y: 80, width: 300, height: 200 },
      [textId]: { x: 140, y: 120, width: 220, height: 48 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')

    expect(config).toMatchObject({
      applyTo: 'letters',
      motionVector: null,
      motionPath: null,
    })
    expect(textNodeNeedsSegmentPlane(api, textId)).toBe(true)
    expect(createPlaneBuildContext(api).segmentTextNodeIds.has(textId)).toBe(
      true,
    )

    const planes = buildWorldPlanes(
      api,
      layout,
      {},
      resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
    )
    expect(planes.map((plane) => plane.nodeId)).toEqual([cardId, textId])
    expect(planes.find((plane) => plane.nodeId === textId)).toMatchObject({
      renderKind: 'segment-text',
      contentMode: 'self',
      extractedFromParent: true,
    })
  })

  it('extracts whole-layer text effects onto the atlas-backed segment path', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const textId = api.createNode('text', rootId, {
      name: 'Layer fade',
      text: 'Smooth layer',
      size: { width: 220, height: 48 },
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        id: 'fade',
        applyTo: 'layer',
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [textId]: { x: 140, y: 120, width: 220, height: 48 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')

    expect(textNodeNeedsSegmentPlane(api, textId)).toBe(true)
    expect(
      buildWorldPlanes(
        api,
        layout,
        {},
        resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
      ).find((plane) => plane.nodeId === textId),
    ).toMatchObject({ renderKind: 'segment-text' })
  })

  it('extracts a Curve Drop path even without a straight XYZ vector', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const textId = api.createNode('text', rootId, {
      name: 'Curve Drop label',
      text: 'Falling along a curve',
      size: { width: 260, height: 48 },
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        id: 'curve-drop',
        motionVector: null,
        motionPath: defaultTextMotionPath(),
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [textId]: { x: 140, y: 120, width: 260, height: 48 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')

    expect(textNodeNeedsSegmentPlane(api, textId)).toBe(true)
    expect(
      buildWorldPlanes(
        api,
        layout,
        {},
        resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
      ).find((plane) => plane.nodeId === textId),
    ).toMatchObject({ renderKind: 'segment-text' })
  })

  it('splits the sibling stack so later overlays stay above spatial text', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const parentId = api.createNode('frame', rootId, {
      name: 'Card',
      size: { width: 300, height: 200 },
    })
    const textId = api.createNode('text', parentId, {
      name: 'Spatial label',
      text: 'Depth',
      size: { width: 180, height: 40 },
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        motionVector: { x: 0, y: 0, z: 1 },
      },
    })
    const overlayId = api.createNode('rect', parentId, {
      name: 'Later overlay',
      size: { width: 180, height: 40 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [parentId]: { x: 100, y: 80, width: 300, height: 200 },
      [textId]: { x: 140, y: 120, width: 180, height: 40 },
      [overlayId]: { x: 140, y: 120, width: 180, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const planes = buildWorldPlanes(
      api,
      layout,
      {},
      resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
    )

    expect(planes.map((plane) => plane.nodeId)).toEqual([
      parentId,
      textId,
      overlayId,
    ])
    expect(planes.map((plane) => plane.paintOrder)).toEqual([0, 1, 2])
    expect(planes.find((plane) => plane.nodeId === parentId)?.contentMode).toBe(
      'self',
    )
    expect(planes.find((plane) => plane.nodeId === overlayId)).toMatchObject({
      contentMode: 'subtree',
      extractedFromParent: true,
    })
  })

  it('extracts an all-zero node vector as a clipped self segment plane', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const parentId = api.createNode('frame', rootId, {
      name: 'Clipping card',
      size: { width: 300, height: 200 },
      clipsContent: true,
    })
    const textId = api.createNode('text', parentId, {
      name: 'Spatial label',
      text: 'Spatial label',
      size: { width: 180, height: 40 },
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        motionVector: { x: 0, y: 0, z: 0 },
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [parentId]: { x: 100, y: 80, width: 300, height: 200 },
      [textId]: { x: 140, y: 120, width: 180, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })

    expect(textNodeNeedsSegmentPlane(api, textId)).toBe(true)
    const planes = buildWorldPlanes(api, layout, {}, resolvedCamera)
    expect(planes.map((plane) => plane.nodeId)).toEqual([parentId, textId])
    expect(planes.find((plane) => plane.nodeId === parentId)).toMatchObject({
      renderKind: 'canvas',
      contentMode: 'self',
    })
    expect(planes.find((plane) => plane.nodeId === textId)).toMatchObject({
      renderKind: 'segment-text',
      contentMode: 'self',
      extractedFromParent: true,
    })
    expect(planes.find((plane) => plane.nodeId === textId)?.clips).toEqual([
      expect.objectContaining({ rect: layout[parentId] }),
    ])
  })

  it('stays extracted after a stacked spatial track is removed', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const parentId = api.createNode('frame', rootId, {
      name: 'Card',
      size: { width: 300, height: 200 },
    })
    const textId = api.createNode('text', parentId, {
      name: 'Stacked label',
      text: 'Stacked label',
      size: { width: 180, height: 40 },
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        applyTo: 'layer',
        motionVector: null,
      },
    })
    api.setTrack({
      id: 'spatial-text-track',
      nodeId: textId,
      propertyId: 'text.progress',
      defaultEasing: 'linear',
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        startTime: 4,
        motionVector: { x: 0, y: 0, z: 0 },
      },
      keyframes: [
        { id: 'spatial-start', time: 4, value: 0 },
        { id: 'spatial-end', time: 5, value: 1 },
      ],
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [parentId]: { x: 100, y: 80, width: 300, height: 200 },
      [textId]: { x: 140, y: 120, width: 180, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })
    const activeLegacyAnimation = {
      ...DEFAULT_TEXT_ANIMATION,
      applyTo: 'layer' as const,
      motionVector: null,
    }

    expect(textNodeNeedsSegmentPlane(api, textId)).toBe(true)
    expect(
      buildWorldPlanes(
        api,
        layout,
        {
          [textId]: {
            textProgress: 0.5,
            textAnimation: activeLegacyAnimation,
          },
        },
        resolvedCamera,
      ).find((plane) => plane.nodeId === textId),
    ).toMatchObject({
      renderKind: 'segment-text',
      contentMode: 'self',
    })

    api.deleteTrack('spatial-text-track')
    expect(textNodeNeedsSegmentPlane(api, textId)).toBe(true)
    expect(
      buildWorldPlanes(api, layout, {}, resolvedCamera).map(
        (plane) => plane.nodeId,
      ),
    ).toEqual([parentId, textId])
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

describe('cached plane-build topology', () => {
  it('preserves output without persistent graph reads on animated frames', () => {
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
    const textId = api.createNode('text', groupId, {
      name: 'Spatial label',
      text: 'Progressive entry',
      size: { width: 220, height: 48 },
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        motionVector: { x: 0, y: -1, z: 0 },
      },
    })
    const overlayId = api.createNode('rect', groupId, {
      name: 'Overlay',
      size: { width: 220, height: 48 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [groupId]: { x: 100, y: 80, width: 300, height: 200 },
      [textId]: { x: 140, y: 120, width: 220, height: 48 },
      [overlayId]: { x: 140, y: 120, width: 220, height: 48 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })
    const animatedFrame = {
      [groupId]: { z: 120, opacity: 0.6 },
      [textId]: { textProgress: 0.45 },
    }
    const expectedAtRest = buildWorldPlanes(
      api,
      layout,
      {},
      resolvedCamera,
    )
    const expectedAnimated = buildWorldPlanes(
      api,
      layout,
      animatedFrame,
      resolvedCamera,
    )
    const nodeCount = api.getAllNodeIds().length
    const getNode = vi.spyOn(api, 'getNode')
    const getAllTracks = vi.spyOn(api, 'getAllTracks')
    const getTracksForNode = vi.spyOn(api, 'getTracksForNode')

    const context = createPlaneBuildContext(api)
    expect(getNode).toHaveBeenCalledTimes(nodeCount)
    expect(getAllTracks).toHaveBeenCalledTimes(1)
    expect(getTracksForNode).not.toHaveBeenCalled()

    expect(
      buildWorldPlanes(api, layout, {}, resolvedCamera, { context }),
    ).toEqual(expectedAtRest)
    expect(
      buildWorldPlanes(api, layout, animatedFrame, resolvedCamera, {
        context,
      }),
    ).toEqual(expectedAnimated)
    expect(getNode).toHaveBeenCalledTimes(nodeCount)
    expect(getAllTracks).toHaveBeenCalledTimes(1)
    expect(getTracksForNode).not.toHaveBeenCalled()

    getNode.mockRestore()
    getAllTracks.mockRestore()
    getTracksForNode.mockRestore()
  })

  it('refreshes segment topology after a document change', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const cardId = api.createNode('frame', rootId, {
      name: 'Card',
      size: { width: 300, height: 200 },
    })
    const textId = api.createNode('text', cardId, {
      name: 'Static label',
      text: 'Static label',
      size: { width: 180, height: 40 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [cardId]: { x: 100, y: 80, width: 300, height: 200 },
      [textId]: { x: 140, y: 120, width: 180, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })
    const beforeContext = createPlaneBuildContext(api)
    const beforeVersion = api.getVersion()

    api.setTrack({
      id: 'spatial-text-track',
      nodeId: textId,
      propertyId: 'text.progress',
      defaultEasing: 'linear',
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        motionVector: { x: 0, y: -1, z: 0 },
      },
      keyframes: [
        { id: 'spatial-start', time: 0, value: 0 },
        { id: 'spatial-end', time: 1, value: 1 },
      ],
    })
    expect(api.getVersion()).toBeGreaterThan(beforeVersion)
    expect(
      buildWorldPlanes(api, layout, {}, resolvedCamera, {
        context: beforeContext,
      }).map((plane) => plane.nodeId),
    ).toEqual([cardId])

    const refreshedContext = createPlaneBuildContext(api)
    expect(
      buildWorldPlanes(api, layout, {}, resolvedCamera, {
        context: refreshedContext,
      }).map((plane) => plane.nodeId),
    ).toEqual([cardId, textId])
  })
})
