// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from './doc'
import {
  MAX_LAYER_BLUR_PX,
  clampLayerBlurAmount,
  normalizeLayerEffects,
} from './effects'
import {
  effectBlurPropertyId,
  effectIdFromBlurPropertyId,
  propertyDescriptor,
} from './props'

describe('layer effect normalization', () => {
  it('assigns unique effect ids and preserves existing identity', () => {
    const normalized = normalizeLayerEffects([
      {
        id: 'existing-shadow',
        kind: 'shadow',
        color: '#00000080',
        offsetX: 0,
        offsetY: 4,
        blur: 8,
      },
      { kind: 'blur', amount: 12 },
      { kind: 'blur', amount: 24 },
    ])

    const ids = normalized.map((effect) => effect.id)
    expect(ids[0]).toBe('existing-shadow')
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(
      true,
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(normalizeLayerEffects(normalized).map((effect) => effect.id)).toEqual(
      ids,
    )
  })

  it('describes stable per-effect blur property ids as numeric animation', () => {
    const propertyId = effectBlurPropertyId('soft-shadow')

    expect(propertyId).toBe('appearance.effects.soft-shadow.blur')
    expect(effectIdFromBlurPropertyId(propertyId)).toBe('soft-shadow')
    expect(propertyDescriptor(propertyId)).toMatchObject({
      group: 'appearance',
      layoutAffecting: false,
      interpolation: 'numeric',
    })
  })

  it('clamps invalid and excessive layer blur amounts', () => {
    expect(clampLayerBlurAmount(-5)).toBe(0)
    expect(clampLayerBlurAmount(Number.NaN)).toBe(0)
    expect(clampLayerBlurAmount(12.5)).toBe(12.5)
    expect(clampLayerBlurAmount(5_739.59)).toBe(MAX_LAYER_BLUR_PX)
    expect(
      normalizeLayerEffects([{ kind: 'blur', amount: 5_739.59 }]),
    ).toEqual([
      { id: 'effect-1', kind: 'blur', amount: MAX_LAYER_BLUR_PX },
    ])
  })

  it('normalizes layer blur on document reads and writes', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null)
    const ellipseId = api.createNode('ellipse', rootId, {
      appearance: {
        opacity: 1,
        fill: { kind: 'solid', color: '#2563eb' },
        stroke: null,
        cornerRadius: 0,
        effects: [{ kind: 'blur', amount: 1_000 }],
      },
    })
    const ellipse = api.getNode(ellipseId)
    expect(ellipse?.appearance.effects).toEqual([
      { id: 'effect-1', kind: 'blur', amount: MAX_LAYER_BLUR_PX },
    ])

    if (!ellipse) throw new Error('Expected ellipse')
    api.setNodeProperty(ellipseId, 'appearance', {
      ...ellipse.appearance,
      effects: [{ kind: 'blur', amount: -10 }],
    })
    expect(api.getNode(ellipseId)?.appearance.effects).toEqual([
      { id: 'effect-1', kind: 'blur', amount: 0 },
    ])
  })
})
