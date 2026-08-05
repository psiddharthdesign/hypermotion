// SPDX-License-Identifier: Apache-2.0

import type { Effect } from './types'

/**
 * Practical upper bound for an authored whole-layer blur.
 *
 * Canvas, CSS, and Pixi all allocate effect padding from this value. Keeping
 * one shared cap prevents an accidental scrub value from creating enormous
 * textures (or making the layer appear to vanish) while still allowing a very
 * soft, composition-scale blur.
 */
export const MAX_LAYER_BLUR_PX = 128

export function clampLayerBlurAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_LAYER_BLUR_PX, Math.max(0, value))
    : 0
}

const EFFECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * Resolve the stable identity for one effect row. Normalized scene nodes
 * always carry an id; the index fallback keeps raw legacy fixtures readable.
 */
export function effectStableId(effect: Effect, index: number): string {
  const candidate = effect.id?.trim()
  return candidate && EFFECT_ID_PATTERN.test(candidate)
    ? candidate
    : `effect-${index + 1}`
}

/** Normalize persisted effect rows without changing their order or identity. */
export function normalizeLayerEffects(
  effects: readonly Effect[] | null | undefined,
): Effect[] {
  if (!Array.isArray(effects)) return []
  const used = new Set<string>()
  return effects.map((effect, index) => {
    let id = effectStableId(effect, index)
    let suffix = index + 1
    while (used.has(id)) {
      suffix += 1
      id = `effect-${suffix}`
    }
    used.add(id)
    return effect.kind === 'blur'
      ? { ...effect, id, amount: clampLayerBlurAmount(effect.amount) }
      : { ...effect, id }
  })
}
