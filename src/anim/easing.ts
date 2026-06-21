// SPDX-License-Identifier: Apache-2.0

/**
 * Easing evaluators.
 *
 * Cubic-bezier is the workhorse for MVP. Springs come later (Step 5.1);
 * the tagged union on `EasingKind` already reserves the slot.
 *
 * The bezier solver is a direct Newton-Raphson on the parametric form,
 * matched to the CSS spec's tolerance (1e-6 with a 10-iteration cap).
 * Cached curve coefficients per call — micro-optimizations are not the
 * interesting perf story here (solving a scene's 40 keyframes is free,
 * rAF dominates everything).
 */

import type { EasingKind } from '@/scene'

export type EasingEvaluator = (t: number) => number

const IDENTITY: EasingEvaluator = (t) => t

const PRESETS: Record<string, [number, number, number, number]> = {
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

export function evaluator(easing: EasingKind | undefined): EasingEvaluator {
  if (!easing || easing === 'linear') return IDENTITY
  if (typeof easing === 'string') {
    const preset = PRESETS[easing]
    if (preset) return bezierEvaluator(preset)
    return IDENTITY
  }
  if ('bezier' in easing) return bezierEvaluator(easing.bezier)
  if ('spring' in easing) {
    return springEvaluator(easing.spring)
  }
  return IDENTITY
}

function springEvaluator(spring: {
  stiffness: number
  damping: number
  mass: number
}): EasingEvaluator {
  const stiffness = Math.max(1, spring.stiffness)
  const damping = Math.max(0.1, spring.damping)
  const mass = Math.max(0.1, spring.mass)
  const omega0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))

  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    if (zeta < 1) {
      const omegaD = omega0 * Math.sqrt(1 - zeta * zeta)
      const envelope = Math.exp(-zeta * omega0 * t)
      const value =
        1 -
        envelope *
          (Math.cos(omegaD * t) +
            (zeta * omega0 / omegaD) * Math.sin(omegaD * t))
      return value
    }
    const value = 1 - Math.exp(-omega0 * t) * (1 + omega0 * t)
    return Math.max(0, Math.min(1.5, value))
  }
}

function bezierEvaluator(
  c: [number, number, number, number],
): EasingEvaluator {
  const [x1, y1, x2, y2] = c
  // Coefficients for the one-dimensional bezier (CSS convention:
  // B(t) = 3(1-t)²t * P1 + 3(1-t)t² * P2 + t³)
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleDerivX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t

  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    // Newton-Raphson for t such that sampleX(t) = x
    let t = x
    for (let i = 0; i < 10; i++) {
      const xi = sampleX(t) - x
      if (Math.abs(xi) < 1e-6) return sampleY(t)
      const d = sampleDerivX(t)
      if (Math.abs(d) < 1e-6) break
      t -= xi / d
    }
    // Bisection fallback
    let lo = 0
    let hi = 1
    for (let i = 0; i < 20; i++) {
      t = (lo + hi) / 2
      const xi = sampleX(t) - x
      if (Math.abs(xi) < 1e-6) break
      if (xi < 0) lo = t
      else hi = t
    }
    return sampleY(t)
  }
}
