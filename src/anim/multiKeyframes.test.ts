// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { addKeyframe, findTrack } from './tracks'
import {
  inspectMultiKeyframes,
  toggleMultiKeyframes,
  type MultiKeyframeTarget,
} from './multiKeyframes'

function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { name: 'Root' })
  const a = api.createNode('frame', root, { name: 'A' })
  const b = api.createNode('frame', root, { name: 'B' })
  const targets: MultiKeyframeTarget[] = [
    { nodeId: a, currentValue: 24 },
    { nodeId: b, currentValue: 96 },
  ]
  return { api, a, b, targets }
}

describe('multi-selection keyframes', () => {
  it('adds separate current values and returns tracks ready for stagger', () => {
    const { api, a, b, targets } = setup()
    let updates = 0
    api.doc.on('update', () => updates++)

    const result = toggleMultiKeyframes(
      api,
      targets,
      'transform.x',
      0.5,
    )

    expect(result.action).toBe('added')
    expect(result.trackIds).toHaveLength(2)
    expect(findTrack(api, a, 'transform.x')?.keyframes[0]?.value).toBe(24)
    expect(findTrack(api, b, 'transform.x')?.keyframes[0]?.value).toBe(96)
    expect(updates).toBe(1)
    expect(inspectMultiKeyframes(api, targets, 'transform.x', 0.5).state).toBe('at')
  })

  it('completes a partial selection instead of toggling layers apart', () => {
    const { api, a, b, targets } = setup()
    addKeyframe(api, a, 'transform.rotationY', 1, 10)

    expect(
      inspectMultiKeyframes(api, targets, 'transform.rotationY', 1).state,
    ).toBe('partial')
    toggleMultiKeyframes(api, targets, 'transform.rotationY', 1)

    expect(findTrack(api, a, 'transform.rotationY')?.keyframes[0]?.value).toBe(24)
    expect(findTrack(api, b, 'transform.rotationY')?.keyframes[0]?.value).toBe(96)
  })

  it('removes from every layer only when every layer is keyframed', () => {
    const { api, targets } = setup()
    toggleMultiKeyframes(api, targets, 'transform.z', 0)
    const result = toggleMultiKeyframes(api, targets, 'transform.z', 0)

    expect(result.action).toBe('removed')
    expect(result.trackIds).toEqual([])
    expect(inspectMultiKeyframes(api, targets, 'transform.z', 0).state).toBe('none')
  })
})
