// SPDX-License-Identifier: Apache-2.0

import type { Fill } from '@/scene/types'
import {
  clampEasingStrength,
  findEasingPreset,
  type EasingPresetId,
} from './easingPresets'
import type { SceneAPI } from '@/scene/doc'
import type { EasingKind, Keyframe, NodeId, Track, TrackId } from '@/scene/types'

export type TextAnimationId =
  | 'appear'
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
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

export interface TextAnimationConfig {
  id: TextAnimationId
  mode: TextAnimationMode
  applyTo: TextAnimationApplyTo
  order: TextAnimationOrder
  delay: number
  smoothing: TextAnimationSmoothing
  duration: number
  startTime: number
  acceleration: TextAnimationAcceleration
  easingPresetId: EasingPresetId
  easingStrength: number
  customEasing?: EasingKind
  direction: TextAnimationDirection
  travelDistance: number
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
  duration: 0.8,
  startTime: 0,
  acceleration: 'slow-down',
  easingPresetId: 'smooth',
  easingStrength: 50,
  direction: 'up',
  travelDistance: 0.5,
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
]

export function textAnimationDefaults(id: TextAnimationId): TextAnimationConfig {
  const preset = TEXT_ANIMATION_PRESETS.find((p) => p.id === id)
  const direction = directionFromPresetId(id)
  return {
    ...DEFAULT_TEXT_ANIMATION,
    ...(direction ? { direction } : {}),
    id,
    ...(preset?.defaults ?? {}),
  }
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
  const previous = existing ? normalizeTextAnimation(existing) : null
  const next: TextAnimationConfig = {
    ...defaults,
    ...(previous
      ? {
          mode: previous.mode,
          applyTo: previous.applyTo,
          order: previous.order,
          delay: previous.delay,
          smoothing: previous.smoothing,
          easingPresetId: previous.easingPresetId,
          easingStrength: previous.easingStrength,
          customEasing: previous.customEasing,
        }
      : {}),
    startTime,
  }
  api.setNodeProperty(nodeId, 'textAnimation', next)
  const node = api.getNode(nodeId)
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
  const trackId =
    options.trackId ??
    findTextAnimationTrackAtStart(api, nodeId, start) ??
    genId()
  const track: Track = {
    id: trackId,
    nodeId,
    propertyId: 'text.progress',
    defaultEasing: easingForText(config),
    textAnimation: config,
    keyframes: [
      textKeyframe(start, 0, easingForText(config), config.mode),
      textKeyframe(end, 1, undefined, config.mode),
    ],
  }
  api.setTrack(track)
  return trackId
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
      return { ...keyframe, easingOut: easing }
    })
    api.setTrack({ ...track, defaultEasing: easing, textAnimation: config, keyframes })
  }
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
  return Math.max(1, Array.from(text).filter((char) => char !== ' ' && char !== '\n').length)
}

function textKeyframe(
  time: number,
  value: number,
  easingOut?: EasingKind,
  presetOrigin?: TextAnimationMode,
): Keyframe {
  return {
    id: genId(),
    time,
    value,
    ...(easingOut ? { easingOut } : {}),
    ...(presetOrigin ? { presetOrigin } : {}),
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
  return {
    ...base,
    mode: value.mode === 'out' ? 'out' : 'in',
    applyTo: isApplyTo(value.applyTo) ? value.applyTo : base.applyTo,
    order: value.order === 'backward' ? 'backward' : 'forward',
    delay: finiteNumber(value.delay, base.delay),
    smoothing: isSmoothing(value.smoothing) ? value.smoothing : base.smoothing,
    duration: Math.max(0.05, finiteNumber(value.duration, base.duration)),
    startTime: Math.max(0, finiteNumber(value.startTime, base.startTime)),
    acceleration: isAcceleration(value.acceleration) ? value.acceleration : base.acceleration,
    easingPresetId: isEasingPresetId(value.easingPresetId) ? value.easingPresetId : base.easingPresetId,
    easingStrength: clampEasingStrength(
      finiteNumber(value.easingStrength, base.easingStrength),
    ),
    customEasing: isEasingKind(value.customEasing) ? value.customEasing : base.customEasing,
    direction: isDirection(value.direction) ? value.direction : base.direction,
    travelDistance: Math.max(0, finiteNumber(value.travelDistance, base.travelDistance)),
    blurRadius: Math.max(0, finiteNumber(value.blurRadius, base.blurRadius)),
    startColor: typeof value.startColor === 'string' ? value.startColor : base.startColor,
    endColor: typeof value.endColor === 'string' ? value.endColor : base.endColor,
    startGradient: value.startGradient ?? base.startGradient,
    endGradient: value.endGradient ?? base.endGradient,
  }
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
