// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { textAnimationDefaults } from '@/anim/textAnimations'
import { createSceneAPI } from '@/scene/doc'
import { measureTextNodeSize } from './textMeasure'

describe('text intrinsic measurement', () => {
  it('reserves a wider Number Flow start value for hug-sized text', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: '1' })
    const node = api.getNode(nodeId)
    if (node?.kind !== 'text') throw new Error('Expected a text node')

    const targetOnly = measureTextNodeSize(node)
    const animated = {
      ...node,
      textAnimation: {
        ...textAnimationDefaults('number-flow'),
        numberFrom: 1_000_000,
      },
    }

    expect(measureTextNodeSize(animated).width).toBeGreaterThan(
      targetOnly.width,
    )
  })
})
