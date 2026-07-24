// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { addKeyframe } from './tracks'

describe('animation tracks', () => {
  it('preserves saved easing when replacing a keyframe without timing arguments', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    const easing = {
      bezier: [0.18, -0.4, 0.72, 1.6] as [
        number,
        number,
        number,
        number,
      ],
    }
    const easingPreset = {
      presetId: 'custom',
      strength: 50,
    } as const

    const original = addKeyframe(
      api,
      nodeId,
      'transform.x',
      1,
      20,
      easing,
      undefined,
      easingPreset,
    )
    const replacement = addKeyframe(
      api,
      nodeId,
      'transform.x',
      1.005,
      48,
    )

    expect(replacement).toMatchObject({
      id: original.id,
      time: 1.005,
      value: 48,
      easingOut: easing,
      easingPreset,
    })
  })

  it('clears stale preset provenance when replacing with an explicit curve', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    const custom = {
      bezier: [0.18, -0.4, 0.72, 1.6] as [
        number,
        number,
        number,
        number,
      ],
    }

    addKeyframe(
      api,
      nodeId,
      'transform.x',
      1,
      20,
      custom,
      undefined,
      { presetId: 'custom', strength: 50 },
    )
    const replacement = addKeyframe(
      api,
      nodeId,
      'transform.x',
      1,
      48,
      'ease-out',
    )

    expect(replacement.easingOut).toBe('ease-out')
    expect(replacement.easingPreset).toBeUndefined()
  })

  it('can replace a collision with inherited track easing', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    addKeyframe(
      api,
      nodeId,
      'transform.x',
      1,
      20,
      { bezier: [0.18, -0.4, 0.72, 1.6] },
      undefined,
      { presetId: 'custom', strength: 50 },
    )

    const replacement = addKeyframe(
      api,
      nodeId,
      'transform.x',
      1,
      48,
      undefined,
      undefined,
      undefined,
      { existingEasing: 'replace' },
    )

    expect(replacement.easingOut).toBeUndefined()
    expect(replacement.easingPreset).toBeUndefined()
  })
})
