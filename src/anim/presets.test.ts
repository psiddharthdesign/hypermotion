// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { applyPreset } from './presets'

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
})
