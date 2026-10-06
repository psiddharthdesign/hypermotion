// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { extendKeyframeSelection } from './keyframeSelection'

describe('keyframe modifier selection', () => {
  it('adds Shift-picked keys across tracks without dropping existing keys', () => {
    const first = extendKeyframeSelection(['x:a'], ['y:b'], true)
    expect([...extendKeyframeSelection(first, ['x:c'], true)]).toEqual(['x:a', 'y:b', 'x:c'])
    expect([...extendKeyframeSelection(first, ['x:a'], true)]).toEqual(['x:a', 'y:b'])
  })
  it('completes partially selected groups and preserves unrelated keys', () => {
    const selection = ['x:a', 'z:d']
    for (const shift of [true, false]) {
      expect([...extendKeyframeSelection(selection, ['x:a', 'y:b'], shift)]).toEqual(['x:a', 'z:d', 'y:b'])
    }
    expect(selection).toEqual(['x:a', 'z:d'])
  })
  it('Cmd/Ctrl removes a fully selected group, while Shift retains it', () => {
    const selection = ['x:a', 'y:b', 'z:d']
    expect([...extendKeyframeSelection(selection, ['x:a', 'y:b'], false)]).toEqual(['z:d'])
    expect([...extendKeyframeSelection(selection, ['x:a', 'y:b'], true)]).toEqual(selection)
  })
  it('leaves the selection intact for an empty bundle', () => {
    expect([...extendKeyframeSelection(['x:a'], [], false)]).toEqual(['x:a'])
  })
})
