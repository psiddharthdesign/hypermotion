// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createAnimatedSnapshotSelector } from './useAnimatedValues'

describe('animated snapshot selection', () => {
  it('does not invalidate scene consumers for camera-only animation', () => {
    const selectScene = createAnimatedSnapshotSelector(['scene-node'])
    const first = selectScene({ camera: { x: 10 } })
    const second = selectScene({ camera: { x: 20 } })

    expect(second).toBe(first)
    expect(second).toEqual({})
  })

  it('publishes requested node changes and structurally shares held values', () => {
    const selectScene = createAnimatedSnapshotSelector(['scene-node'])
    const first = selectScene({ 'scene-node': { opacity: 0.5 } })
    const held = selectScene({ 'scene-node': { opacity: 0.5 } })
    const changed = selectScene({ 'scene-node': { opacity: 0.75 } })

    expect(held).toBe(first)
    expect(changed).not.toBe(first)
    expect(changed['scene-node']?.opacity).toBe(0.75)
  })
})
