// SPDX-License-Identifier: Apache-2.0

/** Scene-authorable controls from the MIT Border Beam library. */
export const BEAM_STYLES = ['sm', 'md', 'line', 'pulse-outside', 'pulse-inner'] as const
export const BEAM_PALETTES = ['colorful', 'mono', 'ocean', 'sunset', 'forest', 'candy', 'ice', 'gold'] as const
export type BorderBeamStyle = typeof BEAM_STYLES[number]
export type BorderBeamPalette = typeof BEAM_PALETTES[number]
export interface BorderBeamEffect {
  id?: string
  kind: 'border-beam'
  visible?: boolean
  size?: BorderBeamStyle
  colorVariant?: BorderBeamPalette
  /** Auto follows the layer's fill, making renders independent of OS theme. */
  theme?: 'dark' | 'light' | 'auto'
  /** Optional user palette, overriding the named palette. */
  colors?: string[]
  /** Multiplier for the automatically scaled crisp border. */
  edgeWidth?: number
  active?: boolean
  strength?: number
  duration?: number
  /** Omitted values follow the layer's animated corner radius. */
  borderRadius?: number
  brightness?: number
  saturation?: number
  glowSize?: number
  hueRange?: number
  staticColors?: boolean
  /** Timeline offset and entry/exit fades replace DOM lifecycle transitions. */
  startTime?: number
  endTime?: number
  fadeIn?: number
  fadeOut?: number
}

export function beamDuration(size: BorderBeamStyle): number {
  return size === 'line' ? 3.1 : size.startsWith('pulse') ? 2.3 : 1.96
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value)) : fallback
}

export const DEFAULT_BEAM_COLORS = ['#ff3264', '#ff9b32', '#be28f0', '#6446ff', '#288cff', '#32c850']

export function beamSpatialScale(width: number, height: number, size: BorderBeamStyle = 'md'): number {
  const reference = size === 'sm' ? { width: 120, height: 48 } : { width: 480, height: 240 }
  return Math.max(1, Math.min(32, width / reference.width, height / reference.height))
}

const BEAM_COLOR = /^(?:#[\da-f]{3,4}|#[\da-f]{6}(?:[\da-f]{2})?|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([\d.eE+%/,\s-]+\))$/i

export function normalizeBorderBeam(effect: BorderBeamEffect): BorderBeamEffect {
  const size = BEAM_STYLES.includes(effect.size!) ? effect.size! : 'md'
  return {
    ...effect, kind: 'border-beam', size,
    colorVariant: BEAM_PALETTES.includes(effect.colorVariant!) ? effect.colorVariant : 'colorful',
    theme: effect.theme === 'light' || effect.theme === 'dark' ? effect.theme : 'auto',
    colors: Array.isArray(effect.colors) && effect.colors.filter(c => typeof c === 'string' && BEAM_COLOR.test(c)).length >= 2
      ? effect.colors.filter(c => typeof c === 'string' && BEAM_COLOR.test(c)).slice(0, 8) : undefined,
    edgeWidth: bounded(effect.edgeWidth, 1, 0.25, 6),
    active: effect.active !== false, staticColors: effect.staticColors === true,
    strength: bounded(effect.strength, 1, 0, 1),
    duration: effect.duration === undefined ? undefined : bounded(effect.duration, beamDuration(size), 0.1, 120),
    borderRadius: effect.borderRadius === undefined ? undefined : bounded(effect.borderRadius, 0, 0, 10000),
    brightness: effect.brightness === undefined ? undefined : bounded(effect.brightness, 1.3, 0, 4),
    saturation: effect.saturation === undefined ? undefined : bounded(effect.saturation, 1.2, 0, 4),
    glowSize: bounded(effect.glowSize, 1, 0, 4),
    hueRange: bounded(effect.hueRange, 30, 0, 360),
    startTime: bounded(effect.startTime, 0, 0, 86400),
    endTime: effect.endTime === undefined ? undefined : bounded(effect.endTime, 0, 0, 86400),
    fadeIn: bounded(effect.fadeIn, 0.6, 0, 30),
    fadeOut: bounded(effect.fadeOut, 0.5, 0, 30),
  }
}

/** Pure scene-time phase, so out-of-order export/seek requests are identical. */
export function beamTiming(effect: BorderBeamEffect, sceneTime: number) {
  const e = normalizeBorderBeam(effect)
  const time = (Number.isFinite(sceneTime) ? sceneTime : 0) - e.startTime!
  const end = e.endTime === undefined ? Infinity : e.endTime - e.startTime!
  const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t) }
  const entrance = e.fadeIn! > 0 ? smooth(time / e.fadeIn!) : 1
  const exit = e.fadeOut! > 0 ? smooth((end - time) / e.fadeOut!) : 1
  const opacity = e.visible === false || !e.active || time < 0 || time >= end ? 0 : e.strength! * entrance * exit
  const duration = e.duration ?? beamDuration(e.size!)
  return { time, phase: ((time / duration) % 1 + 1) % 1, opacity }
}

export function hasAnimatedBeam(effects: readonly { kind: string; visible?: boolean; active?: boolean }[] | undefined): boolean {
  return !!effects?.some(e => e.kind === 'border-beam' && e.visible !== false && e.active !== false)
}

export function beamPadding(effect: BorderBeamEffect, width = 480, height = 240): number {
  const e = normalizeBorderBeam(effect)
  return e.size === 'pulse-outside' && e.active && e.visible !== false ? Math.ceil((64 * e.glowSize! + 16) * beamSpatialScale(width, height, e.size)) : 0
}
