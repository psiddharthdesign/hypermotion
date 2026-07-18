// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { addKeyframe, findTrack } from '@/anim'
import { createSceneAPI } from '@/scene/doc'
import { graphValueBounds } from './graphEditorMath'

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
