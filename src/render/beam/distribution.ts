// SPDX-License-Identifier: Apache-2.0
import type { BorderBeamEffect } from '@/scene/borderBeam'

function random(seed: number, index: number): number {
  let value = (seed | 0) ^ Math.imul(index + 1, 0x9e3779b9)
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296
}

/** A repeatable, seamless pattern of unequal highlights and asymmetric tails.
 * Position is one turn clockwise from the top (or left-to-right on a line).
 */
export function beamDistribution(effect: BorderBeamEffect, phase: number) {
  const variation = effect.variation ?? 1
  const seed = effect.seed ?? 1
  const spread = Math.max(.0001, effect.spread ?? 1)
  const shift = effect.animatePattern === false ? 0 : phase
  const amount = -Math.expm1(-variation * 2)
  const lobes = [0,1,2].map(i => ({
    center: i / 3 + random(seed,i) * .22,
    width: (.08 + random(seed,i+3) * .12) * spread,
    strength: i === 0 ? 1 : .45 + random(seed,i+6) * .5,
  }))
  return (position: number) => {
    let value = 0
    for (const lobe of lobes) {
      const delta = ((position - shift - lobe.center + .5) % 1 + 1) % 1 - .5
      const width = lobe.width * (delta < 0 ? 1.8 : .65)
      value += lobe.strength * Math.exp(-4 * (delta / width) ** 2)
    }
    return 1 - amount + amount * Math.min(1, value)
  }
}

/** Unequal, stable color spans, with an explicit seam stop at one full turn. */
export function beamColorPositions(count: number, effect: BorderBeamEffect): number[] {
  const variation = effect.nonUniform ? effect.variation ?? 1 : 0
  const weights = Array.from({length:count},(_,i) =>
    .05 + Math.exp(-variation * (1 - random(effect.seed ?? 1,i+12)) * 3))
  const total = weights.reduce((a,b)=>a+b,0)
  let position = 0
  return [...weights.map(weight => { const start=position;position+=weight/total;return start }),1]
}
