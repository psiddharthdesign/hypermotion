// SPDX-License-Identifier: Apache-2.0

import type { Fill } from '@/scene/types'
import {
  clampEasingStrength,
  findEasingPreset,
  type EasingPresetId,
} from './easingPresets'
import type { SceneAPI } from '@/scene/doc'
import type { EasingKind, Keyframe, NodeId, Track, TrackId } from '@/scene/types'
import type { TextMotionVector } from './textMotionVector'
import {
  defaultTextMotionPath,
  normalizeTextMotionPath,
  type TextMotionPath,
} from './textMotionPath'
import {
  normalizeTextStaggerCurve,
  type TextStaggerCurve,
} from './textStaggerCurve'
import { parseNumberFlowText } from './numberFlow'

export type TextAnimationId =
  | 'appear'
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'curve-drop'
  | 'mask-up'
  | 'mask-down'
  | 'grow'
  | 'shrink'
  | 'blur'
  | 'blur-slide'
  | 'scramble'
  | 'flip'
  | 'character-wave'
  | 'color-fade'
  | 'gradient-reveal'
  | 'typewriter'
  | 'number-flow'
  | 'tracking'
  | 'skew'

export type TextAnimationMode = 'in' | 'out'
export type TextAnimationApplyTo = 'letters' | 'words' | 'lines' | 'layer'
export type TextAnimationOrder = 'forward' | 'backward'
export type TextAnimationDirection = 'up' | 'down' | 'left' | 'right'
export type TextAnimationAcceleration =
  | 'linear'
  | 'speed-up'
  | 'slow-down'
  | 'smooth'
  | 'spring'
export type TextAnimationSmoothing = 'none' | 'soft' | 'smooth'
export type NumberFlowTrend = 'auto' | 'up' | 'down' | 'individual'

/**
 * Per-segment motion offset in line-height multiples: +X moves right, +Y moves
 * down, and +Z moves toward the viewer. A null vector keeps the legacy
 * direction + travel-distance controls and rendering behavior.
 */
export type TextAnimationMotionVector = TextMotionVector

export interface TextAnimationConfig {
  id: TextAnimationId
  mode: TextAnimationMode
  applyTo: TextAnimationApplyTo
  order: TextAnimationOrder
  delay: number
  smoothing: TextAnimationSmoothing
  staggerCurve: TextStaggerCurve | null
  duration: number
  numberFrom: number
  numberFlowTrend: NumberFlowTrend
  numberFlowContinuous: boolean
  /** Numeric increment between visible rolls; null follows display precision. */
  numberFlowIncrement: number | null
  /** Whole-digit travel measured in the current text line height. */
  numberFlowSpinDistance: number
  /** Strength of the outgoing/incoming digit cross-fade, from 0 to 1. */
  numberFlowFadeAmount: number
  /** Soft clipping band at the top and bottom of the number, in em. */
  numberFlowMaskHeight: number
  /** Soft clipping band at the left and right of the number, in em. */
  numberFlowMaskWidth: number
  /** Portion of the segment duration used by each Number Flow channel. */
  numberFlowTransformTimingRatio: number
  numberFlowSpinTimingRatio: number
  numberFlowOpacityTimingRatio: number
  startTime: number
  acceleration: TextAnimationAcceleration
  easingPresetId: EasingPresetId
  easingStrength: number
  customEasing?: EasingKind
  direction: TextAnimationDirection
  travelDistance: number
  motionVector: TextAnimationMotionVector | null
  /**
   * Editable per-segment spatial trajectory in line-height units. Progress 0
   * is the settled text position and progress 1 is the authored start/hidden
   * position, matching the renderer's existing motion `amount` convention.
   */
  motionPath: TextMotionPath | null
  blurRadius: number
  startColor?: string
  endColor?: string
  startGradient?: Fill
  endGradient?: Fill
}

export interface TextAnimationPreset {
  id: TextAnimationId
  label: string
  category: string
  defaults: Partial<TextAnimationConfig>
}

export const DEFAULT_TEXT_ANIMATION: TextAnimationConfig = {
  id: 'blur-slide',
  mode: 'in',
  applyTo: 'letters',
  order: 'forward',
  delay: 0.12,
  smoothing: 'none',
  staggerCurve: null,
  duration: 0.8,
  numberFrom: 0,
  numberFlowTrend: 'auto',
  numberFlowContinuous: true,
  numberFlowIncrement: null,
  numberFlowSpinDistance: 1,
  numberFlowFadeAmount: 1,
  numberFlowMaskHeight: 0.25,
  numberFlowMaskWidth: 0.5,
  numberFlowTransformTimingRatio: 1,
  numberFlowSpinTimingRatio: 1,
  numberFlowOpacityTimingRatio: 0.5,
  startTime: 0,
  acceleration: 'slow-down',
  easingPresetId: 'smooth',
  easingStrength: 50,
  direction: 'up',
  travelDistance: 0.5,
  motionVector: null,
  motionPath: null,
  blurRadius: 20,
  startGradient: {
    kind: 'linear',
    angle: 90,
    stops: [
      { at: 0, color: '#7c3aed' },
      { at: 1, color: '#06b6d4' },
    ],
  },
  endGradient: {
    kind: 'linear',
    angle: 90,
    stops: [
      { at: 0, color: '#06b6d4' },
      { at: 0.5, color: '#f43f5e' },
      { at: 1, color: '#f59e0b' },
    ],
  },
}

export const TEXT_ANIMATION_PRESETS: TextAnimationPreset[] = [
  { id: 'appear', label: 'Appear', category: 'Basic', defaults: { duration: 0.35, blurRadius: 0, travelDistance: 0 } },
  { id: 'fade', label: 'Fade', category: 'Basic', defaults: { duration: 0.5, blurRadius: 0, travelDistance: 0 } },
  { id: 'slide-up', label: 'Slide ↑', category: 'Slide', defaults: { direction: 'up', travelDistance: 0.5, blurRadius: 0 } },
  { id: 'slide-down', label: 'Slide ↓', category: 'Slide', defaults: { direction: 'down', travelDistance: 0.5, blurRadius: 0 } },
  { id: 'slide-left', label: 'Slide ←', category: 'Slide', defaults: { direction: 'left', travelDistance: 0.5, blurRadius: 0 } },
  { id: 'slide-right', label: 'Slide →', category: 'Slide', defaults: { direction: 'right', travelDistance: 0.5, blurRadius: 0 } },
  {
    id: 'curve-drop',
    label: 'Curve Drop',
    category: 'Motion',
    defaults: {
      duration: 1.15,
      delay: 0.09,
      smoothing: 'soft',
      travelDistance: 0,
      blurRadius: 0,
      motionPath: defaultTextMotionPath(),
    },
  },
  { id: 'mask-up', label: 'Mask ↑', category: 'Mask', defaults: { direction: 'up', travelDistance: 0.7, blurRadius: 0 } },
  { id: 'mask-down', label: 'Mask ↓', category: 'Mask', defaults: { direction: 'down', travelDistance: 0.7, blurRadius: 0 } },
  { id: 'grow', label: 'Grow', category: 'Scale', defaults: { travelDistance: 0, blurRadius: 0 } },
  { id: 'shrink', label: 'Shrink', category: 'Scale', defaults: { travelDistance: 0, blurRadius: 0 } },
  { id: 'blur', label: 'Blur', category: 'Blur', defaults: { travelDistance: 0, blurRadius: 20 } },
  { id: 'blur-slide', label: 'Blur & Slide', category: 'Blur', defaults: { direction: 'up', travelDistance: 0.5, blurRadius: 20 } },
  { id: 'scramble', label: 'Scramble', category: 'Expressive', defaults: { duration: 0.9, delay: 0.04 } },
  { id: 'flip', label: 'Flip', category: 'Expressive', defaults: { duration: 0.75, delay: 0.08 } },
  { id: 'character-wave', label: 'Character Wave', category: 'Expressive', defaults: { duration: 0.9, delay: 0.06, smoothing: 'soft' } },
  { id: 'color-fade', label: 'Color Fade', category: 'Color', defaults: { duration: 0.65, delay: 0.05 } },
  { id: 'gradient-reveal', label: 'Gradient Reveal', category: 'Color', defaults: { duration: 0.85, delay: 0.08 } },
  { id: 'typewriter', label: 'Typewriter', category: 'Reveal', defaults: { duration: 0.9, delay: 0.06 } },
  { id: 'tracking', label: 'Tracking', category: 'Reveal', defaults: { duration: 0.7, delay: 0.04 } },
  { id: 'skew', label: 'Skew', category: 'Reveal', defaults: { duration: 0.65, delay: 0.06 } },
  {
    id: 'number-flow',
    label: 'Number Flow',
    category: 'Numbers',
    defaults: {
      applyTo: 'layer',
      delay: 0,
      duration: 0.8,
      travelDistance: 0,
      motionVector: null,
      motionPath: null,
      blurRadius: 8,
    },
  },
]

/** Progressive whole-layer reveal shared by DOM, Canvas2D, and WebGL. */
export function typewriterTextAtProgress(
  text: string,
  mode: TextAnimationMode,
  progress: number,
): string {
  const safeProgress = Math.max(
    0,
    Math.min(1, Number.isFinite(progress) ? progress : 0),
  )
  const visibleProgress = mode === 'out' ? 1 - safeProgress : safeProgress
  const characters = Array.from(text)
  const visibleCount = Math.max(
    0,
    Math.min(characters.length, Math.ceil(characters.length * visibleProgress)),
  )
  return characters.slice(0, visibleCount).join('')
}

export function textAnimationDefaults(id: TextAnimationId): TextAnimationConfig {
  const preset = TEXT_ANIMATION_PRESETS.find((p) => p.id === id)
  const direction = directionFromPresetId(id)
  return enforceTextAnimationPresetConstraints({
    ...DEFAULT_TEXT_ANIMATION,
    ...(direction ? { direction } : {}),
    id,
    ...(preset?.defaults ?? {}),
  })
}

/** Legacy presets whose direction/travel fields author a real translation. */
export function textAnimationUsesLegacyTranslation(
  id: TextAnimationId,
): boolean {
  return (
    id === 'slide-up' ||
    id === 'slide-down' ||
    id === 'slide-left' ||
    id === 'slide-right' ||
    id === 'blur-slide' ||
    id === 'skew'
  )
}

export function applyTextAnimation(
  api: SceneAPI,
  nodeId: NodeId,
  id: TextAnimationId,
  startTime: number,
  existing?: TextAnimationConfig | null,
  options: { trackId?: TrackId; replaceAll?: boolean } = {},
): TextAnimationConfig {
  const defaults = textAnimationDefaults(id)
  const node = api.getNode(nodeId)
  const storedAnimation = node?.kind === 'text' ? node.textAnimation : null
  if (
    id === 'number-flow' &&
    (node?.kind !== 'text' || parseNumberFlowText(node.text) === null)
  ) {
    return existing ?? normalizeTextAnimation(storedAnimation) ?? defaults
  }
  const previous = existing ? normalizeTextAnimation(existing) : null
  const next = enforceTextAnimationPresetConstraints({
    ...defaults,
    ...(previous
      ? {
          mode: previous.mode,
          applyTo: previous.applyTo,
          order: previous.order,
          delay: previous.delay,
          smoothing: previous.smoothing,
          staggerCurve: previous.staggerCurve,
          easingPresetId: previous.easingPresetId,
          easingStrength: previous.easingStrength,
          customEasing: previous.customEasing,
          numberFrom: previous.numberFrom,
          numberFlowTrend: previous.numberFlowTrend,
          numberFlowContinuous: previous.numberFlowContinuous,
          numberFlowIncrement: previous.numberFlowIncrement,
          numberFlowSpinDistance: previous.numberFlowSpinDistance,
          numberFlowFadeAmount: previous.numberFlowFadeAmount,
          numberFlowMaskHeight: previous.numberFlowMaskHeight,
          numberFlowMaskWidth: previous.numberFlowMaskWidth,
          numberFlowTransformTimingRatio:
            previous.numberFlowTransformTimingRatio,
          numberFlowSpinTimingRatio: previous.numberFlowSpinTimingRatio,
          numberFlowOpacityTimingRatio: previous.numberFlowOpacityTimingRatio,
          motionVector: previous.motionVector,
          // Selecting Curve Drop from a legacy effect should install its
          // useful bowed default. Once a path exists, preset changes retain
          // it just like the independent XYZ motion vector.
          motionPath: previous.motionPath ?? defaults.motionPath,
        }
      : {}),
    startTime,
  })
  api.setNodeProperty(nodeId, 'textAnimation', next)
  stampTextAnimationKeyframes(
    api,
    nodeId,
    next,
    node?.kind === 'text' ? node.text : '',
    options,
  )
  return next
}

export function stampTextAnimationKeyframes(
  api: SceneAPI,
  nodeId: NodeId,
  config: TextAnimationConfig,
  text: string,
  options: { trackId?: TrackId; replaceAll?: boolean } = {},
): TrackId {
  if (options.replaceAll) clearTextAnimationKeyframes(api, nodeId)
  const start = config.startTime
  const end = start + config.duration + Math.max(0, textSegmentCount(text, config.applyTo) - 1) * config.delay
  const trackId = options.trackId ?? findTextAnimationTrackAtStart(api, nodeId, start) ?? genId()
  const existingTrack = api.getTrack(trackId)
  const track: Track = {
    ...existingTrack,
    id: trackId,
    nodeId,
    propertyId: 'text.progress',
    defaultEasing: easingForText(config),
    textAnimation: config,
    keyframes: reconcileTextAnimationKeyframes(
      existingTrack,
      start,
      end,
      easingForText(config),
      {
        presetId: config.easingPresetId,
        strength: config.easingStrength,
      },
      config.mode,
    ),
  }
  api.setTrack(track)
  return trackId
}

/**
 * Recover the semantic start and per-segment duration from a live timeline
 * track. UI option changes merge onto this result before restamping, so
 * changing words to letters adjusts only the repeated delay span instead of
 * accidentally treating that span as part of the animation duration.
 */
export function deriveTextAnimationTiming(
  config: TextAnimationConfig | null,
  track: Track | null,
  text: string,
): TextAnimationConfig | null {
  if (!config || !track || track.keyframes.length < 2) return config
  const times = track.keyframes.map((keyframe) => keyframe.time)
  const start = Math.min(...times)
  const end = Math.max(...times)
  const delaySpan =
    Math.max(0, textSegmentCount(text, config.applyTo) - 1) * config.delay
  return {
    ...config,
    startTime: start,
    duration: Math.max(0.05, end - start - delaySpan),
  }
}

/**
 * Text controls edit a semantic animation that already owns real timeline
 * keys. Preserve those key identities so persistent stagger relationships,
 * keyframe selection, and grouped edits remain attached while timing changes.
 */
function reconcileTextAnimationKeyframes(
  existingTrack: Track | null,
  start: number,
  end: number,
  easing: EasingKind,
  easingPreset: NonNullable<Keyframe['easingPreset']>,
  mode: TextAnimationMode,
): Keyframe[] {
  const existing = [...(existingTrack?.keyframes ?? [])]
    .map((keyframe, index) => ({ keyframe, index }))
    .sort(
      (a, b) =>
        a.keyframe.time - b.keyframe.time || a.index - b.index,
    )
    .map((entry) => entry.keyframe)
  if (existing.length < 2) {
    const first = textKeyframe(
      start,
      0,
      easing,
      mode,
      easingPreset,
      existing[0]?.id,
    )
    return [first, textKeyframe(end, 1, undefined, mode)]
  }

  const oldStart = existing[0]!.time
  const oldEnd = existing[existing.length - 1]!.time
  const oldSpan = oldEnd - oldStart
  const nextSpan = end - start
  return existing.map((keyframe, index) => {
    if (index === 0) {
      return textKeyframe(
        start,
        0,
        easing,
        mode,
        easingPreset,
        keyframe.id,
      )
    }
    if (index === existing.length - 1) {
      return textKeyframe(end, 1, undefined, mode, undefined, keyframe.id)
    }
    const progress =
      Math.abs(oldSpan) > 1e-9
        ? Math.max(0, Math.min(1, (keyframe.time - oldStart) / oldSpan))
        : index / (existing.length - 1)
    return {
      ...keyframe,
      time: start + nextSpan * progress,
    }
  })
}

function findTextAnimationTrackAtStart(
  api: SceneAPI,
  nodeId: NodeId,
  startTime: number,
): TrackId | null {
  for (const track of api.getTracksForNode(nodeId)) {
    if (track.propertyId !== 'text.progress') continue
    if (track.keyframes.length < 2) continue
    const start = Math.min(...track.keyframes.map((keyframe) => keyframe.time))
    if (Math.abs(start - startTime) <= 0.01) return track.id
  }
  return null
}

export function updateTextAnimationEasing(
  api: SceneAPI,
  nodeId: NodeId,
  config: TextAnimationConfig,
  trackId?: TrackId,
): void {
  const easing = easingForText(config)
  for (const track of api.getTracksForNode(nodeId)) {
    if (track.propertyId !== 'text.progress') continue
    if (trackId && track.id !== trackId) continue
    const keyframes = track.keyframes.map((keyframe, index) => {
      const isLast = index === track.keyframes.length - 1
      if (keyframe.presetOrigin !== config.mode || isLast) return keyframe
      return {
        ...keyframe,
        easingOut: easing,
        easingPreset: {
          presetId: config.easingPresetId,
          strength: config.easingStrength,
        },
      }
    })
    api.setTrack({ ...track, defaultEasing: easing, textAnimation: config, keyframes })
  }
}

/** Update semantic text-effect metadata without touching timeline keys. */
export function updateTextAnimationTrackMetadata(
  api: SceneAPI,
  nodeId: NodeId,
  config: TextAnimationConfig,
  trackId: TrackId,
): boolean {
  const track = api.getTrack(trackId)
  if (
    !track ||
    track.nodeId !== nodeId ||
    track.propertyId !== 'text.progress'
  ) {
    return false
  }
  api.setTrack({ ...track, textAnimation: config })
  return true
}

function clearTextAnimationKeyframes(
  api: SceneAPI,
  nodeId: NodeId,
): void {
  for (const track of api.getTracksForNode(nodeId)) {
    if (track.propertyId !== 'text.progress') continue
    api.deleteTrack(track.id)
  }
}

function textSegmentCount(text: string, applyTo: TextAnimationApplyTo): number {
  if (applyTo === 'layer') return 1
  if (applyTo === 'lines') return Math.max(1, text.split('\n').filter(Boolean).length)
  if (applyTo === 'words') return Math.max(1, text.split(/\s+/).filter(Boolean).length)
  return Math.max(1, Array.from(text).filter((char) => !/\s/.test(char)).length)
}

function textKeyframe(
  time: number,
  value: number,
  easingOut?: EasingKind,
  presetOrigin?: TextAnimationMode,
  easingPreset?: Keyframe['easingPreset'],
  id = genId(),
): Keyframe {
  return {
    id,
    time,
    value,
    ...(easingOut ? { easingOut } : {}),
    ...(presetOrigin ? { presetOrigin } : {}),
    ...(easingPreset ? { easingPreset } : {}),
  }
}

function genId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}

function easingForText(config: TextAnimationConfig): EasingKind {
  if (config.easingPresetId === 'custom' && config.customEasing) {
    return config.customEasing
  }
  return findEasingPreset(config.easingPresetId).build(config.easingStrength)
}

export function normalizeTextAnimation(raw: unknown): TextAnimationConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<TextAnimationConfig>
  const id = isTextAnimationId(value.id) ? value.id : DEFAULT_TEXT_ANIMATION.id
  const base = textAnimationDefaults(id)
  const smoothing = isSmoothing(value.smoothing) ? value.smoothing : base.smoothing
  const staggerCurve = normalizeTextStaggerCurve(value.staggerCurve)
  return enforceTextAnimationPresetConstraints({
    ...base,
    mode: value.mode === 'out' ? 'out' : 'in',
    applyTo: isApplyTo(value.applyTo) ? value.applyTo : base.applyTo,
    order: value.order === 'backward' ? 'backward' : 'forward',
    delay: Math.max(0, finiteNumber(value.delay, base.delay)),
    smoothing,
    staggerCurve: value.staggerCurve == null ? null : staggerCurve,
    duration: Math.max(0.05, finiteNumber(value.duration, base.duration)),
    numberFrom: finiteNumber(value.numberFrom, base.numberFrom),
    numberFlowTrend: isNumberFlowTrend(value.numberFlowTrend)
      ? value.numberFlowTrend
      : base.numberFlowTrend,
    numberFlowContinuous:
      typeof value.numberFlowContinuous === 'boolean'
        ? value.numberFlowContinuous
        : base.numberFlowContinuous,
    numberFlowIncrement: normalizeNumberFlowIncrement(
      value.numberFlowIncrement,
      base.numberFlowIncrement,
    ),
    numberFlowSpinDistance: clamp(
      finiteNumber(value.numberFlowSpinDistance, base.numberFlowSpinDistance),
      0.25,
      2,
    ),
    numberFlowFadeAmount: clamp(
      finiteNumber(value.numberFlowFadeAmount, base.numberFlowFadeAmount),
      0,
      1,
    ),
    numberFlowMaskHeight: clamp(
      finiteNumber(value.numberFlowMaskHeight, base.numberFlowMaskHeight),
      0,
      1,
    ),
    numberFlowMaskWidth: clamp(
      finiteNumber(value.numberFlowMaskWidth, base.numberFlowMaskWidth),
      0,
      2,
    ),
    numberFlowTransformTimingRatio: clampTimingRatio(
      value.numberFlowTransformTimingRatio,
      base.numberFlowTransformTimingRatio,
    ),
    numberFlowSpinTimingRatio: clampTimingRatio(
      value.numberFlowSpinTimingRatio,
      base.numberFlowSpinTimingRatio,
    ),
    numberFlowOpacityTimingRatio: clampTimingRatio(
      value.numberFlowOpacityTimingRatio,
      base.numberFlowOpacityTimingRatio,
    ),
    startTime: Math.max(0, finiteNumber(value.startTime, base.startTime)),
    acceleration: isAcceleration(value.acceleration) ? value.acceleration : base.acceleration,
    easingPresetId: isEasingPresetId(value.easingPresetId) ? value.easingPresetId : base.easingPresetId,
    easingStrength: clampEasingStrength(
      finiteNumber(value.easingStrength, base.easingStrength),
    ),
    customEasing: isEasingKind(value.customEasing) ? value.customEasing : base.customEasing,
    direction: isDirection(value.direction) ? value.direction : base.direction,
    travelDistance: Math.max(0, finiteNumber(value.travelDistance, base.travelDistance)),
    motionVector: normalizeMotionVector(value.motionVector),
    motionPath:
      value.motionPath === null
        ? null
        : value.motionPath === undefined
          ? base.motionPath
          : normalizeTextMotionPath(value.motionPath),
    blurRadius: Math.max(0, finiteNumber(value.blurRadius, base.blurRadius)),
    startColor: typeof value.startColor === 'string' ? value.startColor : base.startColor,
    endColor: typeof value.endColor === 'string' ? value.endColor : base.endColor,
    startGradient: value.startGradient ?? base.startGradient,
    endGradient: value.endGradient ?? base.endGradient,
  })
}

function enforceTextAnimationPresetConstraints(
  config: TextAnimationConfig,
): TextAnimationConfig {
  if (config.id !== 'number-flow') return config
  return {
    ...config,
    applyTo: 'layer',
    delay: 0,
    travelDistance: 0,
    motionVector: null,
    motionPath: null,
    blurRadius: clamp(config.blurRadius, 0, 32),
  }
}

function isNumberFlowTrend(value: unknown): value is NumberFlowTrend {
  return (
    value === 'auto' ||
    value === 'up' ||
    value === 'down' ||
    value === 'individual'
  )
}

function clampTimingRatio(value: unknown, fallback: number): number {
  return clamp(finiteNumber(value, fallback), 0.05, 1)
}

function normalizeNumberFlowIncrement(
  value: unknown,
  fallback: number | null,
): number | null {
  if (value == null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value <= 0) return null
  return Math.min(value, 1_000_000_000_000_000)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeMotionVector(
  value: unknown,
): TextAnimationMotionVector | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<Record<keyof TextAnimationMotionVector, unknown>>
  return {
    x: clampedMotionAxis(candidate.x),
    y: clampedMotionAxis(candidate.y),
    z: clampedMotionAxis(candidate.z),
  }
}

function clampedMotionAxis(value: unknown): number {
  return Math.max(-10, Math.min(10, finiteNumber(value, 0)))
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function directionFromPresetId(id: TextAnimationId): TextAnimationDirection | null {
  if (id.endsWith('-up')) return 'up'
  if (id.endsWith('-down')) return 'down'
  if (id.endsWith('-left')) return 'left'
  if (id.endsWith('-right')) return 'right'
  return null
}

function isTextAnimationId(value: unknown): value is TextAnimationId {
  return typeof value === 'string' && TEXT_ANIMATION_PRESETS.some((p) => p.id === value)
}

function isApplyTo(value: unknown): value is TextAnimationApplyTo {
  return value === 'letters' || value === 'words' || value === 'lines' || value === 'layer'
}

function isSmoothing(value: unknown): value is TextAnimationSmoothing {
  return value === 'none' || value === 'soft' || value === 'smooth'
}

function isDirection(value: unknown): value is TextAnimationDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right'
}

function isAcceleration(value: unknown): value is TextAnimationAcceleration {
  return (
    value === 'linear' ||
    value === 'speed-up' ||
    value === 'slow-down' ||
    value === 'smooth' ||
    value === 'spring'
  )
}

function isEasingPresetId(value: unknown): value is EasingPresetId {
  return (
    value === 'none' ||
    value === 'smooth' ||
    value === 'natural' ||
    value === 'slow-down' ||
    value === 'accelerate' ||
    value === 'elastic' ||
    value === 'bounce' ||
    value === 'overshoot' ||
    value === 'impulse' ||
    value === 'swing' ||
    value === 'custom'
  )
}

function isEasingKind(value: unknown): value is EasingKind {
  if (typeof value === 'string') {
    return value === 'linear' || value === 'ease-in' || value === 'ease-out' || value === 'ease-in-out'
  }
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<{ bezier: unknown }>
  return (
    Array.isArray(candidate.bezier) &&
    candidate.bezier.length === 4 &&
    candidate.bezier.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}
