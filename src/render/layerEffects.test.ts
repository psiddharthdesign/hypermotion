// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Effect } from '@/scene'
import {
  expandRectForLayerEffects,
  hasVisibleLayerEffects,
  layerEffectInsets,
  nodeEffectsWrapSubtree,
  paintLayerWithEffects,
  resolveAnimatedLayerEffects,
} from './layerEffects'
import { MAX_LAYER_BLUR_PX } from '@/scene/effects'
import { createSceneAPI } from '@/scene/doc'

describe('layer effect raster bounds', () => {
  it('resolves animated blur values onto the matching shadow and layer blur', () => {
    const shadowEffectId = 'effect-1'
    const layerBlurEffectId = 'effect-2'
    const effects: Effect[] = [
      {
        id: shadowEffectId,
        kind: 'shadow',
        color: '#00000080',
        offsetX: 0,
        offsetY: 4,
        blur: 4,
      },
      { id: layerBlurEffectId, kind: 'blur', amount: 6 },
    ]

    const resolved = resolveAnimatedLayerEffects(effects, {
      [shadowEffectId]: 18,
      [layerBlurEffectId]: 24,
    })

    expect(resolved).toEqual([
      {
        id: shadowEffectId,
        kind: 'shadow',
        color: '#00000080',
        offsetX: 0,
        offsetY: 4,
        blur: 18,
      },
      { id: layerBlurEffectId, kind: 'blur', amount: 24 },
    ])
    expect(effects).toMatchObject([
      { id: shadowEffectId, blur: 4 },
      { id: layerBlurEffectId, amount: 6 },
    ])

    const context = fakeCanvasContext()
    paintLayerWithEffects(
      context as unknown as CanvasRenderingContext2D,
      40,
      40,
      resolved,
      (source) => source.fillRect(0, 0, 40, 40),
    )
    expect(context.drawFilters).toContain('blur(18px)')
    expect(context.drawFilters).toContain('blur(24px)')
  })

  it('keeps offset SVG shadows and layer blur tails inside the texture', () => {
    const effects: Effect[] = [
      {
        kind: 'shadow',
        color: '#00000080',
        offsetX: -3,
        offsetY: 4,
        blur: 8,
        spread: 2,
      },
      { kind: 'blur', amount: 12 },
    ]

    expect(layerEffectInsets(effects)).toEqual({
      top: 24,
      right: 24,
      bottom: 24,
      left: 24,
    })
    expect(
      expandRectForLayerEffects(
        { x: 100, y: 80, width: 40, height: 30 },
        effects,
      ),
    ).toEqual({ x: 76, y: 56, width: 88, height: 78 })
  })

  it('ignores disabled and internally clipped effects for overflow', () => {
    const effects: Effect[] = [
      {
        kind: 'shadow',
        color: '#000',
        offsetX: 100,
        offsetY: 100,
        blur: 40,
        visible: false,
      },
      {
        kind: 'inner-shadow',
        color: '#000',
        offsetX: 4,
        offsetY: 4,
        blur: 8,
      },
    ]

    expect(layerEffectInsets(effects)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
    expect(hasVisibleLayerEffects(effects)).toBe(true)
    expect(hasVisibleLayerEffects([{ ...effects[0]!, visible: false }])).toBe(
      false,
    )
  })

  it('tracks directional shadow overflow without turning it into a box', () => {
    expect(
      layerEffectInsets([
        {
          kind: 'shadow',
          color: '#000',
          offsetX: 10,
          offsetY: -4,
          blur: 8,
          spread: 0,
        },
      ]),
    ).toEqual({ top: 20, right: 26, bottom: 12, left: 6 })
  })

  it('bounds pathological layer blur texture growth', () => {
    expect(layerEffectInsets([{ kind: 'blur', amount: 5_739.59 }])).toEqual({
      top: MAX_LAYER_BLUR_PX * 2,
      right: MAX_LAYER_BLUR_PX * 2,
      bottom: MAX_LAYER_BLUR_PX * 2,
      left: MAX_LAYER_BLUR_PX * 2,
    })
  })

  it('draws the source through a canvas blur filter', () => {
    const context = fakeCanvasContext()
    let painted = false

    paintLayerWithEffects(
      context as unknown as CanvasRenderingContext2D,
      40,
      40,
      [{ kind: 'blur', amount: 12 }],
      (source) => {
        painted = true
        source.fillRect(0, 0, 40, 40)
      },
    )

    expect(painted).toBe(true)
    expect(context.drawFilters).toContain('blur(12px)')
  })

  it('composites a frame effect around its children', () => {
    const api = createSceneAPI()
    const frameId = api.createNode('frame', null, {
      appearance: {
        opacity: 1,
        fill: null,
        stroke: null,
        cornerRadius: 0,
        effects: [{ kind: 'blur', amount: 12 }],
      },
    })
    api.createNode('rect', frameId)
    const frame = api.getNode(frameId)
    if (!frame) throw new Error('Expected frame')

    expect(nodeEffectsWrapSubtree(frame)).toBe(true)
    expect(
      nodeEffectsWrapSubtree({
        ...frame,
        children: [],
      }),
    ).toBe(false)
  })
})

interface FakeContext {
  canvas: {
    width: number
    height: number
    ownerDocument: { createElement: (name: string) => FakeContext['canvas'] }
    getContext: (name: string) => FakeContext
  }
  filter: string
  fillStyle: string
  globalCompositeOperation: GlobalCompositeOperation
  drawFilters: string[]
  save: () => void
  restore: () => void
  getTransform: () => { a: number; b: number; c: number; d: number }
  scale: () => void
  fillRect: () => void
  drawImage: () => void
}

function fakeCanvasContext(): FakeContext {
  const ownerDocument = {
    createElement: () => makeCanvas(),
  }
  const makeCanvas = (): FakeContext['canvas'] => {
    const stack: string[] = []
    const canvas = {
      width: 0,
      height: 0,
      ownerDocument,
      getContext: () => context,
    }
    const context: FakeContext = {
      canvas,
      filter: 'none',
      fillStyle: '#000',
      globalCompositeOperation: 'source-over',
      drawFilters: [],
      save: () => stack.push(context.filter),
      restore: () => {
        context.filter = stack.pop() ?? 'none'
      },
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1 }),
      scale: () => undefined,
      fillRect: () => undefined,
      drawImage: () => context.drawFilters.push(context.filter),
    }
    return canvas
  }
  return makeCanvas().getContext('2d')
}
