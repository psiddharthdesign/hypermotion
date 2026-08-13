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
export {
  PRESETS,
  applyPreset,
  planLayerPresetTargets,
  planTextPresetTargets,
  planTextStaggerStartTimes,
  type AnimPresetId,
  type LayerPresetTargetPlan,
  type TextPresetTargetPlan,
} from './presets'
export {
  keyframeValuesForPatch,
  recordKeyframesForPatch,
  stampToActiveTracksForPatch,
} from './recordKeyframes'
export {
  EASING_PRESETS,
  MAX_EASING_STRENGTH,
  clampEasingStrength,
  findEasingPreset,
  bezierOf,
  type EasingPresetId,
  type EasingPresetDef,
} from './easingPresets'
export {
  applyEasingToSelection,
  easingKindsEqual,
  inspectEasingSelection,
  type ApplyEasingResult,
  type EasingSelection,
  type EasingSelectionScope,
  type EasingSelectionSummary,
} from './keyframeEasing'
export {
  DEFAULT_TEXT_ANIMATION,
  TEXT_ANIMATION_PRESETS,
  applyTextAnimation,
  deriveTextAnimationTiming,
  normalizeTextAnimation,
  stampTextAnimationKeyframes,
  textAnimationDefaults,
  textAnimationUsesLegacyTranslation,
  typewriterTextAtProgress,
  updateTextAnimationEasing,
  updateTextAnimationTrackMetadata,
  type TextAnimationAcceleration,
  type TextAnimationApplyTo,
  type TextAnimationConfig,
  type TextAnimationDirection,
  type TextAnimationId,
  type TextAnimationMode,
  type TextAnimationMotionVector,
  type NumberFlowDigitMode,
  type NumberFlowDigitOrder,
  type NumberFlowTrend,
  type TextAnimationOrder,
  type TextAnimationPreset,
  type TextAnimationSmoothing,
} from './textAnimations'
export {
  easeTextAnimationProgress,
  textSegmentEnvelopeProgress,
  textSegmentLinearProgress,
  textSegmentStartOffset,
} from './textSegmentEnvelope'
export {
  MAX_TEXT_STAGGER_CURVE_POINTS,
  evaluateTextStaggerCurve,
  normalizeTextStaggerCurve,
  removeTextStaggerCurvePoint,
  splitTextStaggerCurveAt,
  textStaggerCurveForPreset,
  type TextStaggerCurve,
  type TextStaggerCurvePoint,
  type TextStaggerCurvePreset,
} from './textStaggerCurve'
export {
  MAX_TEXT_MOTION_PATH_POINTS,
  defaultTextMotionPath,
  evaluateTextMotionPath,
  normalizeTextMotionPath,
  removeTextMotionPathPoint,
  setTextMotionPathDistance,
  splitTextMotionPathAt,
  textMotionPathDistance,
  type TextMotionPath,
  type TextMotionPathPoint,
} from './textMotionPath'
export {
  DEFAULT_LAYER_MOTION_PATH_PARAMETERIZATION,
  MAX_LAYER_MOTION_PATH_POINTS,
  defaultLayerMotionPath,
  evaluateLayerMotionPath,
  evaluateLayerMotionPathSample,
  normalizeLayerMotionPath,
  type LayerMotionPath,
  type LayerMotionPathParameterization,
  type LayerMotionPathPoint,
  type LayerMotionPathPosition,
  type LayerMotionPathSample,
} from './layerMotionPath'
export {
  resolveTextMotionRailAmount,
  resolveTextSegmentMotion,
} from './textSegmentMotion'
export {
  createTextMotionRailWorkspace,
  refreshTextMotionRailWorkspace,
  resolveTextMotionRailOffsets,
  textMotionPathUsesSharedRail,
  type TextMotionRailPoint,
  type TextMotionRailSegment,
  type TextMotionRailWorkspace,
} from './textMotionRail'
