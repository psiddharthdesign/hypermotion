// SPDX-License-Identifier: Apache-2.0

/**
 * Animation engine (Step 5).
 *
 * Hand-written timeline + keyframe evaluator. Reads the scene + keyframe
 * tracks, writes animated property values into the render engine on each
 * rAF tick.
 *
 * Keyframes target semantic properties where possible (variant, flex
 * gap, padding, opacity, scale) — NOT absolute x/y. When layout changes,
 * FLIP interpolates between the old and new solved rects (Step 5.1).
 *
 * Public surface: the singleton engine + its typed snapshot value. The
 * react-facing hook is `useAnimatedValues` in src/ui/hooks. Mutations
 * to tracks go through `addTrack` / `removeTrack` / `setKeyframe` —
 * the engine picks up changes via its scene subscription.
 */

export { getAnimEngine } from './engine'
export type { AnimEngine, AnimatedValue } from './engine'
export { evaluator } from './easing'
export type { EasingEvaluator } from './easing'
export {
  addKeyframe,
  removeKeyframe,
  moveKeyframe,
  ensureTrack,
  listTracksForNode,
  removeTrack,
  findTrack,
  findKeyframeAt,
  toggleKeyframe,
} from './tracks'
export { PRESETS, applyPreset, type AnimPresetId } from './presets'
export {
  recordKeyframesForPatch,
  stampToActiveTracksForPatch,
} from './recordKeyframes'
export {
  EASING_PRESETS,
  findEasingPreset,
  bezierOf,
  type EasingPresetId,
  type EasingPresetDef,
} from './easingPresets'