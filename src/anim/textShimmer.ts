import { parseOklch } from './color'
import { oklchToHex } from '@/ui/fields/colorConvert'
import type { Fill } from '@/scene/types'
import type { TextAnimationConfig } from './textAnimations'
import { evaluator } from './easing'
import { findEasingPreset } from './easingPresets'

/** Scene-time driven paint shared by the editor and export renderer. */
export function textShimmerFill(config: TextAnimationConfig, time: number, baseColor = '#111111'): Fill {
  const elapsed = time - config.startTime
  const duration = Math.max(0.05, config.duration)
  const progress = elapsed <= 0 ? 0 : config.shimmerLoop === false
    ? Math.min(1, elapsed / duration)
    : (elapsed % duration) / duration
  const easing = config.easingPresetId === 'custom' && config.customEasing
    ? config.customEasing : findEasingPreset(config.easingPresetId).build(config.easingStrength)
  const width = config.shimmerWidth ?? 0.25
  const center = -width + evaluator(easing)(progress) * (1 + width * 2)
  const base = rgba(baseColor)
  const light = rgba(config.shimmerColor ?? '#ffffff')
  const opacity = (config.shimmerOpacity ?? 0.35) * base[3]
  const softness = Math.max(0.001, config.shimmerBlur ?? 0.7)
  return {
    kind: 'linear', angle: config.direction === 'left' ? 270 : 90,
    stops: Array.from({ length: 65 }, (_, i) => {
      const at = i / 64
      const distance = Math.abs(at - center) / Math.max(0.01, width / 2)
      const edge = Math.max(0, Math.min(1, (1 - distance) / softness))
      const intensity = edge * edge * (3 - 2 * edge)
      const highlightAlpha = light[3] * intensity
      const alpha = opacity * (1 - intensity) + highlightAlpha
      const color = base.slice(0, 3).map((v, j) => alpha === 0 ? 0 : Math.round((v * opacity * (1 - intensity) + light[j]! * highlightAlpha) / alpha))
      return { at, color: '#' + [...color, Math.round(alpha * 255)].map(v => v.toString(16).padStart(2, '0')).join('') }
    }),
  }
}

function rgba(color: string): [number, number, number, number] {
  const oklch = parseOklch(color)
  let hex = (oklch
    ? oklchToHex({ l: oklch.L, c: oklch.C, h: oklch.H })
    : color.trim()).replace('#', '')
  if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(c => c + c).join('')
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) hex = '111111'
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    Math.max(0, Math.min(1, oklch?.alpha ?? (hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1))),
  ]
}
