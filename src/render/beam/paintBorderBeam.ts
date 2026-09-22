// SPDX-License-Identifier: Apache-2.0
// Canvas adaptation of Border Beam's MIT palette, masks, and breathing geometry.
import type { BorderBeamEffect } from '@/scene/borderBeam'
import { beamDuration, beamTiming, normalizeBorderBeam } from '@/scene/borderBeam'
import { colorPalettes, smallColorPalettes, lineColorPalettes, sizeThemePresets, PULSE_RING_MAP, PULSE_OUTER_CORE, PULSE_OUTER_BLOOM, PULSE_INNER_BLOOM, PULSE_INNER_SIZES } from './presets'
import { pulseParams, pulseOscillatorDefs } from './motion'

export interface BeamShape {
  width: number
  height: number
  radius: number | readonly number[]
  ellipse?: boolean
  /** Solid layer fill used by the Auto theme. */
  fill?: string
}

export function resolveBeamTheme(effect: BorderBeamEffect, fill?: string): 'dark' | 'light' {
  if (effect.theme !== 'auto') return effect.theme === 'light' ? 'light' : 'dark'
  // These are the editor's native color encodings. No system preference enters
  // a render: opening the project on another computer preserves its appearance.
  const oklch = fill?.match(/oklch\(\s*([\d.]+)(%?)/)
  if (oklch) return Number(oklch[1]) / (oklch[2] ? 100 : 1) > 0.65 ? 'light' : 'dark'
  const hex = fill?.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)?.[1]
  const rgb = hex ? (hex.length === 3 ? [...hex].map(c => parseInt(c + c, 16)) : [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))) : fill?.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  return rgb?.length === 3 && (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) > 150 ? 'light' : 'dark'
}

function path(ctx: CanvasRenderingContext2D, shape: BeamShape, radius: BeamShape['radius'], inset = 0) {
  const { width: w, height: h } = shape
  ctx.beginPath()
  if (shape.ellipse) ctx.ellipse(w / 2, h / 2, Math.max(0, w / 2 - inset), Math.max(0, h / 2 - inset), 0, 0, Math.PI * 2)
  else ctx.roundRect(inset, inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2), (typeof radius === 'number' ? [radius] : [...radius]).map(r => Math.max(0, r - inset)))
}

interface Spot { color: string; x: number; y: number; w: number; h: number; opacity?: number }
function spot(ctx: CanvasRenderingContext2D, s: Spot) {
  if (s.w <= 0 || s.h <= 0) return
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.scale(s.w, s.h)
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  gradient.addColorStop(0, s.color)
  gradient.addColorStop(1, 'transparent')
  ctx.fillStyle = gradient
  ctx.globalAlpha *= s.opacity ?? 1
  ctx.fillRect(-1, -1, 2, 2)
  ctx.restore()
}

/** Paint only the decoration; the layer and children retain their own opacity. */
export function paintBorderBeam(ctx: CanvasRenderingContext2D, effect: BorderBeamEffect, shape: BeamShape, sceneTime: number): void {
  const e = normalizeBorderBeam(effect)
  const timing = beamTiming(e, sceneTime)
  if (!timing.opacity || shape.width <= 0 || shape.height <= 0) return
  const size = e.size!, variant = e.colorVariant!, theme = resolveBeamTheme(e, shape.fill)
  const preset = sizeThemePresets[size][theme]
  const pulse = size.startsWith('pulse')
  const outside = size === 'pulse-outside'
  const radius = e.borderRadius ?? shape.radius
  const brightness = e.brightness ?? ('brightness' in preset ? preset.brightness : 1.3)
  const saturation = e.saturation ?? preset.saturation
  const hue = e.staticColors || variant === 'mono' ? 0 : pulse
    ? ((timing.time / (size === 'pulse-inner' ? 16 : 14)) % 1) * 360 * e.hueRange! / 30
    : -e.hueRange! * Math.cos(timing.time / 12 * Math.PI * 2)
  const filter = `hue-rotate(${hue}deg) brightness(${brightness}) saturate(${saturation})`
  const opacity = ctx.globalAlpha * timing.opacity * (variant === 'mono' ? .5 : 1)
  const w = shape.width, h = shape.height
  // A temporary color field lets Canvas reproduce CSS's radial gradients and
  // conic alpha mask without introducing a wall-clock animation or DOM capture.
  const canvas = ctx.canvas.ownerDocument.createElement('canvas')
  const scale = Math.min(4, Math.max(1, Math.hypot(ctx.getTransform().a, ctx.getTransform().b)))
  const pad = outside ? 80 : 0
  canvas.width = Math.ceil((w + pad * 2) * scale)
  canvas.height = Math.ceil((h + pad * 2) * scale)
  const field = canvas.getContext('2d')!
  field.scale(scale, scale)
  field.translate(pad, pad)
  const duration = e.duration ?? beamDuration(size)
  const oscillators = pulse ? pulseOscillatorDefs('', pulseParams(size, theme, duration)) : []
  const motion = Object.fromEntries(oscillators.map(o => [o.prop, o.a + (o.b - o.a) * (1 - Math.cos((timing.time - o.delay) / o.period * Math.PI * 2)) / 2]))
  const v = (key: string, fallback = 1) => motion[`--${key}-`] ?? fallback
  const palette = size === 'sm' ? smallColorPalettes[variant].border : colorPalettes[variant].border
  const drawPalette = (bloom = false) => {
    if (size === 'line') {
      const x = timing.phase * (w + 200) - 100
      for (const s of [...lineColorPalettes[variant][theme]].reverse()) spot(field, {
        color: s.color, x: x + s.offsetX, y: h + s.offsetY,
        w: s.sizeW, h: s.sizeH * (.7 + .3 * Math.sin(timing.time * Math.PI * 2 / duration) ** 2),
      })
      return
    }
    if (outside || (pulse && bloom)) {
      const defs = outside ? bloom ? PULSE_OUTER_BLOOM : PULSE_OUTER_CORE : PULSE_INNER_BLOOM
      for (const d of [...defs].reverse()) {
        const p = colorPalettes[variant].border[d.ci]
        const pos = p.pos.split(' ').map(Number.parseFloat)
        spot(field, { color: p.color,
          x: ('x' in d ? parseFloat(d.x) : pos[0]) * w / 100 + v(`bx${d.region}`, 0),
          y: ('y' in d ? parseFloat(d.y) : pos[1]) * h / 100 + v(`by${d.region}`, 0),
          w: d.w * v(`bw${d.region}`), h: d.h * v(`bh${d.region}`) * v('bgh'), opacity: v(`bop-${d.quad}`),
        })
      }
      return
    }
    for (let i = palette.length - 1; i >= 0; i--) {
      const p = palette[i]
      const pos = p.pos.split(' ').map(Number.parseFloat)
      const dimensions = pulse && !bloom ? PULSE_INNER_SIZES[i] : p.size.split(' ').map(Number.parseFloat)
      const ring = PULSE_RING_MAP[i]
      spot(field, { color: p.color,
        x: pos[0] * w / 100 + (pulse ? v(`bx${ring.region}`, 0) : 0),
        y: pos[1] * h / 100 + (pulse ? v(`by${ring.region}`, 0) : 0),
        w: dimensions[0] * (pulse ? v(`bw${ring.region}`) : 1),
        h: dimensions[1] * (pulse ? v(`bh${ring.region}`) * v('bgh') : 1),
        opacity: pulse ? v(`bop-${ring.quad}`) : 1,
      })
    }
  }
  drawPalette()
  if (!pulse && size !== 'line') {
    // The moving specular highlight is layered above the stationary palette.
    const highlight = field.createConicGradient(timing.phase * Math.PI * 2 - Math.PI / 2, w / 2, h / 2)
    const ink = theme === 'dark' ? '255,255,255' : '0,0,0'
    for (const [position, alpha] of [[0, 0], [.54, 0], [.6, .3], [.66, .75], [.72, .3], [.78, 0], [1, 0]]) highlight.addColorStop(position, `rgba(${ink},${alpha})`)
    field.save(); path(field, shape, radius, .5); field.strokeStyle = highlight; field.lineWidth = 1; field.stroke(); field.restore()
    field.globalCompositeOperation = 'destination-in'
    const mask = field.createConicGradient(timing.phase * Math.PI * 2 - Math.PI / 2, w / 2, h / 2)
    for (const [position, alpha] of [[0, 0], [.22, 0], [.36, .4], [.52, 1], [.8, 1], [.92, .1], [1, 0]]) mask.addColorStop(position, `rgba(255,255,255,${alpha})`)
    field.fillStyle = mask
    field.fillRect(0, 0, w, h)
    field.globalCompositeOperation = 'source-over'
  }
  const drawField = (alpha: number, blur: number) => {
    ctx.globalAlpha = Math.min(1, opacity * alpha)
    ctx.filter = `${filter} blur(${blur * e.glowSize!}px)`
    ctx.drawImage(canvas, -pad, -pad, w + pad * 2, h + pad * 2)
  }
  ctx.save()
  // Outside halos never wash over transparent content; inner styles are clipped
  // to the layer outline, exactly like the library's overflow-hidden wrapper.
  if (outside) {
    ctx.beginPath(); ctx.rect(-w - 400, -h - 400, w * 3 + 800, h * 3 + 800)
    const outline = new Path2D()
    if (shape.ellipse) outline.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    else outline.roundRect(0, 0, w, h, typeof radius === 'number' ? radius : [...radius])
    const exterior = new Path2D(); exterior.rect(-400, -400, w + 800, h + 800); exterior.addPath(outline)
    ctx.clip(exterior, 'evenodd')
    drawField(preset.innerOpacity, 4)
    field.clearRect(-pad, -pad, w + pad * 2, h + pad * 2)
    drawPalette(true)
    drawField(preset.bloomOpacity, 14)
  } else {
    path(ctx, shape, radius); ctx.clip()
    drawField(preset.innerOpacity, size === 'sm' ? 3 : 6)
    ctx.save()
    // A one-pixel perimeter mask keeps the colored rim crisp.
    path(ctx, shape, radius, .5)
    ctx.globalAlpha = Math.min(1, opacity * preset.strokeOpacity)
    ctx.filter = filter
    ctx.strokeStyle = ctx.createPattern(canvas, 'no-repeat')!
    const pattern = ctx.strokeStyle as CanvasPattern
    pattern.setTransform(new DOMMatrix().scale(1 / scale).translate(-pad * scale, -pad * scale))
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
    if (pulse) { field.clearRect(0, 0, w, h); drawPalette(true) }
    drawField(preset.bloomOpacity, size === 'sm' ? 8 : 12)
  }
  ctx.restore()
}
