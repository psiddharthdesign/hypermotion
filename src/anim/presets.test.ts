// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import {
  applyPreset,
  planLayerPresetTargets,
  planTextPresetTargets,
  planTextStaggerStartTimes,
} from './presets'

describe('animation presets', () => {
  it('authors Fade In as an ease-out appearance opacity track', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)

    applyPreset(api, nodeId, 'fade-in', 1.25)

    const track = api
      .getTracksForNode(nodeId)
      .find((candidate) => candidate.propertyId === 'appearance.opacity')

    expect(track?.keyframes).toEqual([
      expect.objectContaining({
        time: 1.25,
        value: 0,
        easingOut: 'ease-out',
        presetOrigin: 'in',
      }),
      expect.objectContaining({
        time: 1.65,
        value: 1,
        presetOrigin: 'in',
      }),
    ])
  })

  it('keeps a selected container as the preset target when stagger is armed', () => {
    const plan = planLayerPresetTargets(
      ['container'],
      true,
      0.1,
      null,
    )

    expect(plan).toEqual({
      targets: ['container'],
      staggerActive: false,
      delay: 0.1,
      order: 'forward',
    })
  })

  it('uses only the saved members while editing an existing stagger set', () => {
    const plan = planLayerPresetTargets(
      ['source-layer'],
      true,
      0.1,
      {
        id: 'stagger-1',
        layerIds: ['card-3', 'card-2', 'card-1'],
        delay: 0.25,
        order: 'reverse',
        members: {},
      },
    )

    expect(plan).toEqual({
      targets: ['card-3', 'card-2', 'card-1'],
      staggerActive: true,
      delay: 0.25,
      order: 'reverse',
    })
  })

  it('uses the active S relationship for text presets while preserving mixed-layer order', () => {
    const textIds = new Set(['title', 'caption'])
    const plan = planTextPresetTargets(
      ['title'],
      (id) => textIds.has(id),
      true,
      0.1,
      {
        id: 'stagger-1',
        layerIds: ['title', 'image', 'caption'],
        delay: 0.2,
        order: 'reverse',
        members: {},
      },
    )

    expect(plan).toEqual({
      targets: ['title', 'caption'],
      staggerLayerIds: ['title', 'image', 'caption'],
      staggerActive: true,
      delay: 0.2,
      order: 'reverse',
    })
  })

  it('aligns freshly adopted text tracks to the full mixed-layer S order', () => {
    const plan = planTextPresetTargets(
      ['title'],
      (id) => id === 'title' || id === 'caption',
      true,
      0.1,
      {
        id: 'stagger-1',
        layerIds: ['title', 'image', 'caption'],
        delay: 0.2,
        order: 'reverse',
        members: {},
      },
    )

    expect(planTextStaggerStartTimes(plan, 'title', 1)).toEqual({
      title: 1,
      caption: 0.6,
    })
  })

  it('does not author child tracks when Fade In targets a container', () => {
    const api = createSceneAPI()
    const parentId = api.createNode('frame', null)
    const childId = api.createNode('rect', parentId)

    applyPreset(api, parentId, 'fade-in', 0)

    expect(api.getTracksForNode(parentId)).toHaveLength(1)
    expect(api.getTracksForNode(childId)).toHaveLength(0)
  })
})
