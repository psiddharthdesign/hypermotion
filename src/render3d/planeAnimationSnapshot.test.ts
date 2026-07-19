// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { textAnimationDefaults } from '@/anim/textAnimations'
import { createWorldPlaneAnimationSelector } from './planeAnimationSnapshot'

describe('world-plane animation selection', () => {
  it('reuses the plane snapshot while only text animation progress changes', () => {
    const selectWorldPlaneAnimation = createWorldPlaneAnimationSelector()
    const first = selectWorldPlaneAnimation({
      title: {
        textProgress: 0.1,
        textAnimation: textAnimationDefaults('slide-up'),
      },
    })
    const middle = selectWorldPlaneAnimation({
      title: {
        textProgress: 0.5,
        textAnimation: textAnimationDefaults('slide-up'),
      },
    })
    const end = selectWorldPlaneAnimation({
      title: {
        textProgress: 1,
        textAnimation: textAnimationDefaults('slide-up'),
      },
    })

    expect(middle).toBe(first)
    expect(end).toBe(first)
    expect(end).toEqual({})
  })

  it('reuses held world transforms across unrelated paint updates', () => {
    const selectWorldPlaneAnimation = createWorldPlaneAnimationSelector()
    const first = selectWorldPlaneAnimation({
      title: { x: 120, opacity: 0.8, textProgress: 0.1 },
    })
    const paintUpdate = selectWorldPlaneAnimation({
      title: {
        x: 120,
        opacity: 0.8,
        textProgress: 0.7,
        fill: '#ff0000',
        cornerRadius: 24,
      },
    })

    expect(paintUpdate).toBe(first)
    expect(paintUpdate.title).toEqual({ x: 120, opacity: 0.8 })
  })

  it.each([
    'x',
    'y',
    'z',
    'rotation',
    'rotationX',
    'rotationY',
    'scaleX',
    'scaleY',
    'anchorX',
    'anchorY',
    'anchorZ',
    'opacity',
  ] as const)('invalidates when %s changes', (property) => {
    const selectWorldPlaneAnimation = createWorldPlaneAnimationSelector()
    const first = selectWorldPlaneAnimation({ title: { [property]: 1 } })
    const changed = selectWorldPlaneAnimation({ title: { [property]: 2 } })

    expect(changed).not.toBe(first)
    expect(changed.title?.[property]).toBe(2)
  })

  it('drops nodes after their world-plane animation ends', () => {
    const selectWorldPlaneAnimation = createWorldPlaneAnimationSelector()
    const animated = selectWorldPlaneAnimation({ title: { x: 80 } })
    const settled = selectWorldPlaneAnimation({
      title: { textProgress: 1 },
    })

    expect(animated).toEqual({ title: { x: 80 } })
    expect(settled).not.toBe(animated)
    expect(settled).toEqual({})
  })
})
