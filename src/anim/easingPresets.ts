// SPDX-License-Identifier: Apache-2.0

import type { EasingKind } from '@/scene'

/**
 * Named easing presets, Jitter-style.
 *
 * Each preset is a recipe that maps a single "strength" slider (0–100)
 * onto a concrete EasingKind. The slider lets a designer dial the
 * feeling of an animation without ever touching bezier handles — they
 * pick a character ("Bounce", "Elastic") and slide to taste.
 *
 * How the endpoints were chosen: each preset has a "soft" curve at
 * strength=0 and a "strong" curve at strength=100. Bezier presets linearly
 * interpolate control points between the two; overshoot presets scale
 * their past-1.0 overshoot amount with strength. Calibrated against
 * Jitter's feel by eyeballing, not measured — refine as users complain.
 *
 * `None` is the linear escape hatch. `Custom` is a stub for a future
 * hand-editable bezier editor; for now it behaves like Smooth.
 */

export type EasingPresetId =
  | 'none'
  | 'smooth'
  | 'natural'
  | 'slow-down'
  | 'accelerate'
  | 'elastic'
  | 'bounce'
  | 'overshoot'
  | 'impulse'
  | 'swing'
  | 'custom'

export interface EasingPresetDef {
  id: EasingPresetId
  label: string
  /** Short tag shown in the preset tile. */
  hint: string
  /** Builds an EasingKind from a 0–100 strength. */
  build: (strength: number) => EasingKind
}

/** Lerp a 4-tuple bezier by factor t in [0, 1]. */
function lerpBezier(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ]
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Strength 0–100 → 0–1 interp factor. */
const s = (strength: number) => clamp01(strength / 100)

export const EASING_PRESETS: EasingPresetDef[] = [
  {
    id: 'smooth',
    label: 'Smooth',
    hint: 'Ease in and out',
    build: (strength) => ({
      bezier: lerpBezier(
        [0.42, 0, 0.58, 1], // ease-in-out
        [0.85, 0, 0.15, 1], // strong s-curve
        s(strength),
      ),
    }),
  },
  {
    id: 'natural',
    label: 'Natural',
    hint: 'Organic feel',
    build: (strength) => ({
      bezier: lerpBezier(
        [0.25, 0.46, 0.45, 0.94],
        [0.05, 0.7, 0.1, 1],
        s(strength),
      ),
    }),
  },
  {
    id: 'slow-down',
    label: 'Slow Down',
    hint: 'Ease out',
    build: (strength) => ({
      bezier: lerpBezier(
        [0, 0, 0.58, 1], // ease-out
        [0, 0, 0.2, 1], // strong ease-out
        s(strength),
      ),
    }),
  },
  {
    id: 'accelerate',
    label: 'Accelerate',
    hint: 'Ease in',
    build: (strength) => ({
      bezier: lerpBezier(
        [0.42, 0, 1, 1], // ease-in
        [0.85, 0, 1, 1], // strong ease-in
        s(strength),
      ),
    }),
  },
  {
    id: 'elastic',
    label: 'Elastic',
    hint: 'Spring overshoot',
    build: (strength) => {
      // Scale overshoot: y2 past 1 by up to +1.0, y1 below 0 by up to -0.6.
      const k = s(strength)
      return {
        bezier: [
          0.5 + 0.18 * k,
          -0.6 * k,
          0.265 + 0.0 * k,
          1 + 1.0 * k,
        ],
      }
    },
  },
  {
    id: 'bounce',
    label: 'Bounce',
    hint: 'Settle in',
    build: (strength) => {
      // A lean-forward bezier with large overshoot, not a true multi-bounce.
      // Once we have piecewise-easing we can replace this with a real bounce.
      const k = s(strength)
      return {
        bezier: [0.3 + 0.1 * k, 1.5 + 0.4 * k, 0.6, 1],
      }
    },
  },
  {
    id: 'overshoot',
    label: 'Overshoot',
    hint: 'Past the target',
    build: (strength) => {
      const k = s(strength)
      return {
        bezier: [0.34, 1.2 + 0.8 * k, 0.64, 1],
      }
    },
  },
  {
    id: 'impulse',
    label: 'Impulse',
    hint: 'Quick burst',
    build: (strength) => ({
      bezier: lerpBezier(
        [0.7, 0, 0.3, 1],
        [0.95, 0, 0.05, 1],
        s(strength),
      ),
    }),
  },
  {
    id: 'swing',
    label: 'Swing',
    hint: 'Pendulum arc',
    build: (strength) => ({
      bezier: lerpBezier(
        [0.4, 0, 0.2, 1],
        [0.2, 0, 0.1, 1.1],
        s(strength),
      ),
    }),
  },
  {
    id: 'none',
    label: 'None',
    hint: 'Linear',
    build: () => 'linear',
  },
  {
    id: 'custom',
    label: 'Custom',
    hint: 'Hand-authored',
    // No real editor yet — mirror Smooth so "Custom" feels selectable
    // without doing anything bizarre. The dedicated bezier editor comes
    // in a follow-up; until then the strength slider still works.
    build: (strength) => ({
      bezier: lerpBezier(
        [0.42, 0, 0.58, 1],
        [0.85, 0, 0.15, 1],
        s(strength),
      ),
    }),
  },
]

export function findEasingPreset(id: EasingPresetId): EasingPresetDef {
  const p = EASING_PRESETS.find((x) => x.id === id)
  // `smooth` is always present and is the sensible fallback.
  return p ?? EASING_PRESETS.find((x) => x.id === 'smooth')!
}

/**
 * Return the 4 bezier control points for the given EasingKind, for the
 * curve preview. Strings ('ease-in' / 'ease-out' / 'ease-in-out') map to
 * their CSS equivalents; 'linear' to the diagonal. Spring falls through
 * to ease-out until the spring evaluator lands.
 */
export function bezierOf(
  easing: EasingKind,
): [number, number, number, number] {
  if (easing === 'linear') return [0, 0, 1, 1]
  if (easing === 'ease-in') return [0.42, 0, 1, 1]
  if (easing === 'ease-out') return [0, 0, 0.58, 1]
  if (easing === 'ease-in-out') return [0.42, 0, 0.58, 1]
  if (typeof easing === 'object' && 'bezier' in easing) return easing.bezier
  // Spring stub — treat as ease-out so the preview at least isn't linear.
  return [0, 0, 0.58, 1]
}