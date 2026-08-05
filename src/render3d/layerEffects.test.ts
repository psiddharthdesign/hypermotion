// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_ANIMATION } from '@/anim/textAnimations'
import type { SolvedLayout } from '@/layout'
import { createSceneAPI } from '@/scene/doc'
import { buildWorldPlanes, resolveCamera3D } from './scene3d'

describe('WebGL paintable-layer effect bounds', () => {
  it('expands an ellipse texture for whole-layer blur without changing hit bounds', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      size: { width: 960, height: 540 },
    })
    const ellipseId = api.createNode('ellipse', rootId, {
      size: { width: 40, height: 40 },
      appearance: {
        opacity: 1,
        fill: { kind: 'solid', color: '#2563eb' },
        stroke: null,
        cornerRadius: 0,
        effects: [{ kind: 'blur', amount: 12 }],
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [ellipseId]: { x: 280, y: 220, width: 40, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')

    const ellipsePlane = buildWorldPlanes(
      api,
      layout,
      {},
      resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
      { independentNodes: true },
    ).find((plane) => plane.nodeId === ellipseId)

    expect(ellipsePlane?.rect).toEqual(layout[ellipseId])
    expect(ellipsePlane?.textureRect).toEqual({
      x: 256,
      y: 196,
      width: 88,
      height: 88,
    })
  })

  it('expands a frame effect around the complete flattened subtree', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      size: { width: 960, height: 540 },
    })
    const frameId = api.createNode('frame', rootId, {
      size: { width: 100, height: 80 },
      appearance: {
        opacity: 1,
        fill: null,
        stroke: null,
        cornerRadius: 0,
        effects: [{ kind: 'blur', amount: 12 }],
      },
    })
    const childId = api.createNode('rect', frameId, {
      size: { width: 40, height: 40 },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [frameId]: { x: 100, y: 100, width: 100, height: 80 },
      // The child overflows the frame by 30px on the right. A frame-level
      // blur must expand from that child edge, not only from the frame edge.
      [childId]: { x: 190, y: 120, width: 40, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')

    const framePlane = buildWorldPlanes(
      api,
      layout,
      {},
      resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
    ).find((plane) => plane.nodeId === frameId)

    expect(framePlane?.contentMode).toBe('subtree')
    expect(framePlane?.textureRect).toEqual({
      x: 76,
      y: 76,
      width: 178,
      height: 128,
    })
  })

  it('keeps animated text inside a frame effect compositing boundary', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      size: { width: 960, height: 540 },
    })
    const frameId = api.createNode('frame', rootId, {
      size: { width: 300, height: 180 },
      appearance: {
        opacity: 1,
        fill: { kind: 'solid', color: '#ffffff' },
        stroke: null,
        cornerRadius: 0,
        effects: [{ kind: 'blur', amount: 24 }],
      },
    })
    const textId = api.createNode('text', frameId, {
      text: 'Animated child',
      size: { width: 220, height: 48 },
      textAnimation: {
        ...DEFAULT_TEXT_ANIMATION,
        id: 'fade',
        applyTo: 'letters',
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [frameId]: { x: 100, y: 100, width: 300, height: 180 },
      [textId]: { x: 140, y: 140, width: 220, height: 48 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')
    const resolvedCamera = resolveCamera3D(camera, undefined, {
      width: 960,
      height: 540,
    })

    const compositedPlanes = buildWorldPlanes(
      api,
      layout,
      {},
      resolvedCamera,
    )
    expect(compositedPlanes.map((plane) => plane.nodeId)).toEqual([frameId])
    expect(compositedPlanes[0]?.contentMode).toBe('subtree')

    // Selection/hit testing still asks for independent nodes, so applying an
    // effect must not make the child inaccessible to editor interaction.
    const interactionPlanes = buildWorldPlanes(
      api,
      layout,
      {},
      resolvedCamera,
      { independentNodes: true },
    )
    expect(interactionPlanes.map((plane) => plane.nodeId)).toContain(textId)
  })

  it('expands texture bounds for the currently animated blur value', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      size: { width: 960, height: 540 },
    })
    const ellipseId = api.createNode('ellipse', rootId, {
      size: { width: 40, height: 40 },
      appearance: {
        opacity: 1,
        fill: { kind: 'solid', color: '#2563eb' },
        stroke: null,
        cornerRadius: 0,
        effects: [{ kind: 'blur', amount: 4 }],
      },
    })
    const layout: SolvedLayout = {
      [rootId]: { x: 0, y: 0, width: 960, height: 540 },
      [ellipseId]: { x: 280, y: 220, width: 40, height: 40 },
    }
    const camera = api.getActiveCamera()
    if (!camera) throw new Error('Expected the default camera')

    const ellipsePlane = buildWorldPlanes(
      api,
      layout,
      { [ellipseId]: { effectBlur: { 'effect-1': 20 } } },
      resolveCamera3D(camera, undefined, { width: 960, height: 540 }),
      { independentNodes: true },
    ).find((plane) => plane.nodeId === ellipseId)

    expect(ellipsePlane?.textureRect).toEqual({
      x: 240,
      y: 180,
      width: 120,
      height: 120,
    })
  })

})
