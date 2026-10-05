// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { addKeyframe, findTrack } from '@/anim'
import { createSceneAPI } from '@/scene/doc'
import { graphBezierCoords, graphValueBounds } from './graphEditorMath'
import { graphEditableBezierCoords } from './graphKeyframeEditing'
import { evaluator } from '@/anim/easing'

describe('graph editor value bounds', () => {
  it('includes a high-strength upward overshoot handle', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    addKeyframe(
      api,
      nodeId,
      'appearance.opacity',
      0,
      0,
      { bezier: [0.34, 2.8, 0.64, 1] },
    )
    addKeyframe(api, nodeId, 'appearance.opacity', 1, 1)
    const track = findTrack(api, nodeId, 'appearance.opacity')!

    expect(graphValueBounds(track).max).toBeGreaterThan(2.8)
  })

  it('includes overshoot below a downward segment', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    addKeyframe(
      api,
      nodeId,
      'appearance.opacity',
      0,
      1,
      { bezier: [0.34, 2.8, 0.64, 1] },
    )
    addKeyframe(api, nodeId, 'appearance.opacity', 1, 0)
    const track = findTrack(api, nodeId, 'appearance.opacity')!

    expect(graphValueBounds(track).min).toBeLessThan(-1.8)
  })

  it('keeps a usable domain for flat numeric tracks', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    addKeyframe(api, nodeId, 'transform.x', 0, 5)
    addKeyframe(api, nodeId, 'transform.x', 1, 5)
    const track = findTrack(api, nodeId, 'transform.x')!

    expect(graphValueBounds(track)).toEqual({ min: 4, max: 6 })
  })
})


describe('graph spring and default easing parity', () => {
  it.each([[0, 1], [1, 0]])('contains the full spring curve from %s to %s', (start, end) => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    const spring = { spring: { stiffness: 100, damping: 1, mass: 1 } }
    addKeyframe(api, nodeId, 'transform.x', 0, start)
    addKeyframe(api, nodeId, 'transform.x', 1, end)
    const source = findTrack(api, nodeId, 'transform.x')!
    const track = { ...source, defaultEasing: spring }
    const before = structuredClone(track)
    const bounds = graphValueBounds(track)
    const values = Array.from({ length: 65 }, (_, index) => start + evaluator(spring)(index / 64) * (end - start))
    expect(bounds.min).toBeLessThan(Math.min(...values))
    expect(bounds.max).toBeGreaterThan(Math.max(...values))
    if (end > start) expect(bounds.max).toBeGreaterThan(1.85)
    else expect(bounds.min).toBeLessThan(-0.85)
    expect(track).toEqual(before)
  })

  it('uses linear geometry when easing is absent, matching the animation engine', () => {
    expect(graphBezierCoords(undefined)).toEqual([0, 0, 1, 1])
    expect(graphEditableBezierCoords(undefined)).toEqual([1 / 3, 1 / 3, 2 / 3, 2 / 3])
    const sample = evaluator({ bezier: graphEditableBezierCoords(undefined) })
    for (const time of [0, 0.1, 0.4, 0.8, 1]) expect(sample(time)).toBeCloseTo(evaluator(undefined)(time), 7)
  })
})
