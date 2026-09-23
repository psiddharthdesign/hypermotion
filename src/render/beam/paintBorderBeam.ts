// SPDX-License-Identifier: Apache-2.0
// Scene-time Canvas rendering using Border Beam's MIT palettes and oscillators.
import type { BorderBeamEffect } from '@/scene/borderBeam'
import { beamDuration, beamPadding, beamSpatialScale, beamTiming, normalizeBorderBeam } from '@/scene/borderBeam'
import { amplifyBeamAlpha, beamRasterScale } from './raster'
import { beamColorPositions, beamDistribution } from './distribution'
import { cornerShapePath, needsCornerShapePath, traceQuadraticRoundedRect } from '@/render/cornerShape'
import { colorPalettes } from './presets'
import { pulseParams, pulseOscillatorDefs } from './motion'

export interface BeamShape {
  width: number
  height: number
  radius: number | readonly number[]
  ellipse?: boolean
  cornerSmoothing?: number
  /** DOM/Pixi use circular arcs; scene textures use the layer's corner path. */
  cornerCurve?: 'layer' | 'circular'
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


function outline(shape: BeamShape, inset: number): Path2D {
  const path = new Path2D()
  const w = Math.max(0, shape.width - inset * 2)
  const h = Math.max(0, shape.height - inset * 2)
  if (shape.ellipse) path.ellipse(shape.width / 2, shape.height / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (shape.cornerCurve === 'circular') path.roundRect(inset, inset, w, h,
    (typeof shape.radius === 'number' ? [Math.min(shape.radius,shape.width/2,shape.height/2)] : [...shape.radius]).map(r => Math.max(0, r - inset)))
  else {
    const radii = typeof shape.radius === 'number' ? undefined : {
      tl:shape.radius[0],tr:shape.radius[1],br:shape.radius[2],bl:shape.radius[3],
    }
    const radius = typeof shape.radius === 'number' ? Math.min(shape.radius,shape.width/2,shape.height/2) : 0
    if (needsCornerShapePath(shape.cornerSmoothing,radii)) {
      path.addPath(new Path2D(cornerShapePath({width:shape.width,height:shape.height,
        cornerRadius:radius,cornerRadii:radii,cornerSmoothing:shape.cornerSmoothing,inset})),new DOMMatrix().translate(inset,inset))
    } else traceQuadraticRoundedRect(path,inset,inset,w,h,Math.max(0,radius-inset))
  }
  return path
}

/**
 * Build a crisp colored perimeter first. Glow is a blurred copy of that same
 * perimeter, never independent blobs inside the layer. Working in a relative
 * coordinate space makes a 2400px frame at 20% read like a 480px card at 100%.
 */
export function paintBorderBeam(ctx: CanvasRenderingContext2D, effect: BorderBeamEffect, input: BeamShape, sceneTime: number): void {
  const e = normalizeBorderBeam(effect)
  const timing = beamTiming(e, sceneTime)
  if (!timing.opacity || !ctx.globalAlpha || input.width <= 0 || input.height <= 0) return
  if (e.strength! > 1 || timing.opacity < 1 || ctx.globalAlpha < 1) {
    // Render the fully entered effect, boost its actual pixel coverage, then
    // apply timeline/layer opacity once. Canvas globalAlpha rejects values >1.
    const padding = beamPadding(e, input.width, input.height)
    const width = input.width + padding * 2, height = input.height + padding * 2
    const transform = ctx.getTransform()
    const scale = beamRasterScale(width, height, Math.hypot(transform.a, transform.b) || 1)
    const boosted = ctx.canvas.ownerDocument.createElement('canvas')
    boosted.width = Math.max(1, Math.ceil(width * scale))
    boosted.height = Math.max(1, Math.ceil(height * scale))
    const target = boosted.getContext('2d', { willReadFrequently: e.strength! > 1 })!
    target.scale(scale, scale)
    target.translate(padding, padding)
    paintBorderBeam(target, { ...e, strength: 1, fadeIn: 0, fadeOut: 0 }, input, sceneTime)
    if (e.strength! > 1) {
      const image = target.getImageData(0, 0, boosted.width, boosted.height)
      amplifyBeamAlpha(image.data, e.strength!)
      target.putImageData(image, 0, 0)
    }
    ctx.save()
    ctx.globalAlpha *= timing.opacity
    ctx.drawImage(boosted, -padding, -padding, width, height)
    ctx.restore()
    return
  }
  const size = e.size!
  const unit = beamSpatialScale(input.width, input.height, size)
  const radius = e.borderRadius ?? input.radius
  const shape: BeamShape = { ...input, width: input.width / unit, height: input.height / unit,
    radius: typeof radius === 'number' ? radius / unit : radius.map(r => r / unit) }
  const { width: w, height: h } = shape
  const theme = resolveBeamTheme(e, input.fill)
  const outside = size === 'pulse-outside'
  const pulse = size.startsWith('pulse')
  const mono = !e.colors && e.colorVariant === 'mono'
  const presetColors = colorPalettes[e.colorVariant!].border.map(p => p.color)
  // Imported scenes can contain syntactically shaped but invalid CSS colors.
  // Never let a bad stop abort the entire layer/export.
  const colors = (e.colors ?? presetColors).map((color, i) =>
    CSS.supports('color', color) ? color : presetColors[i % presetColors.length])
  const duration = e.duration ?? beamDuration(size)
  const oscillators = pulse ? pulseOscillatorDefs('', pulseParams(size, theme, duration)) : []
  const motion = Object.fromEntries(oscillators.map(o => [o.prop,
    o.a + (o.b - o.a) * (1 - Math.cos((timing.time - o.delay) / o.period * Math.PI * 2)) / 2,
  ]))
  // Brightness above one bleaches colored strokes on white. Presets now retain
  // chroma on light surfaces; explicit brightness still gives the author control.
  const brightness = e.brightness ?? (theme === 'light' ? .85 : 1.25)
  const saturation = e.saturation ?? (theme === 'light' ? 1.35 : 1.2)
  const hue = e.staticColors || mono ? 0 : -e.hueRange! * Math.cos(timing.time / 12 * Math.PI * 2)
  const filter = `hue-rotate(${hue}deg) brightness(${brightness}) saturate(${saturation})`
  const alpha = ctx.globalAlpha * timing.opacity
  const edge = Math.min(w, h, (size === 'sm' ? 1.2 : 1.6) * e.edgeWidth!)
  const pad = beamPadding(e, input.width, input.height) / unit
  ctx.save()
  ctx.scale(unit, unit)
  const transform = ctx.getTransform()
  const pixelScale = Math.max(Number.EPSILON, Math.hypot(transform.a, transform.b))
  // Respect the caller's raster resolution, including downscaled 4K previews.
  const rasterScale = beamRasterScale(w + 2 * pad, h + 2 * pad, Math.min(4, pixelScale))
  const canvas = ctx.canvas.ownerDocument.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((w + 2 * pad) * rasterScale))
  canvas.height = Math.max(1, Math.ceil((h + 2 * pad) * rasterScale))
  const field = canvas.getContext('2d')!
  field.scale(rasterScale, rasterScale)
  field.translate(pad, pad)
  const rim = outline(shape, edge / 2)
  const uneven = e.nonUniform && e.variation! > 0
  const distribution = beamDistribution(e, timing.phase)
  const palette = uneven && size === 'line' ? field.createLinearGradient(0,0,w,0) : field.createConicGradient(-Math.PI / 2, w / 2, h / 2)
  const positions = beamColorPositions(colors.length,e)
  colors.forEach((color, i) => palette.addColorStop(positions[i], color))
  palette.addColorStop(1, colors[0])
  const stroke = (width: number, crisp = false) => {
    field.save()
    field.resetTransform()
    field.clearRect(0, 0, canvas.width, canvas.height)
    field.restore()
    if (width <= 0) return
    field.save()
    // Clip a stroke centered on the actual boundary. Reconstructing an inset
    // curve is only approximately parallel, especially on smoothed corners.
    if (crisp) field.clip(outline(shape,0))
    field.strokeStyle = palette
    field.lineWidth = crisp ? width*2 : width
    if (uneven) {
      // Sector clips retain the exact rounded outline while varying width.
      // A small overlap prevents antialiased cracks between adjacent sectors.
      const segments = 128
      const reach = Math.hypot(w,h) + pad * 2 + width
      for (let i=0;i<segments;i++) {
        const value = distribution((i+.5)/segments)
        const localWidth = width * (.12 + .88 * value)
        field.save()
        field.beginPath()
        if (size === 'line') field.rect(i*w/segments-.25, -pad, w/segments+.5, h+pad*2)
        else {
          const start = i/segments*Math.PI*2-Math.PI/2-.001
          const end = (i+1)/segments*Math.PI*2-Math.PI/2+.001
          field.moveTo(w/2,h/2)
          field.lineTo(w/2+Math.cos(start)*reach,h/2+Math.sin(start)*reach)
          field.lineTo(w/2+Math.cos(end)*reach,h/2+Math.sin(end)*reach)
          field.closePath()
        }
        field.clip()
        field.lineWidth = crisp ? localWidth*2 : localWidth
        if (size === 'line') {
          field.beginPath();field.moveTo(0,h-(crisp?0:edge)/2);field.lineTo(w,h-(crisp?0:edge)/2);field.stroke()
        } else field.stroke(crisp ? outline(shape,0) : rim)
        field.restore()
      }
    } else if (size === 'line') {
      field.beginPath()
      field.moveTo(0, h - (crisp ? 0 : edge / 2))
      field.lineTo(w, h - (crisp ? 0 : edge / 2))
      field.stroke()
    } else field.stroke(crisp ? outline(shape,0) : rim)
    field.restore()

    // Pulse styles breathe in several regions; border styles carry a defined
    // head and long fading tail. Both glow and rim share this angular mask.
    field.globalCompositeOperation = 'destination-in'
    if (uneven) {
      const mask = size === 'line' ? field.createLinearGradient(0,0,w,0) : field.createConicGradient(-Math.PI/2,w/2,h/2)
      for(let i=0;i<=128;i++) mask.addColorStop(i/128,`rgba(255,255,255,${distribution(i/128)})`)
      field.fillStyle = mask
    } else if (size === 'line') {
      const center = timing.phase * (w * 1.8) - w * .4
      const mask = field.createLinearGradient(center - w * .4, 0, center + w * .4, 0)
      mask.addColorStop(0, 'transparent')
      mask.addColorStop(.45, 'white')
      mask.addColorStop(.65, 'white')
      mask.addColorStop(1, 'transparent')
      field.fillStyle = mask
    } else {
      const mask = field.createConicGradient(pulse ? -Math.PI / 2 : timing.phase * Math.PI * 2 - Math.PI / 2, w / 2, h / 2)
      const stops = pulse
        ? [motion['--bop-tr-'] ?? 1, motion['--bop-br-'] ?? 1, motion['--bop-bl-'] ?? 1, motion['--bop-tl-'] ?? 1]
        : [.10, .12, .22, .7, 1, .9, .22, .10]
      stops.forEach((opacity, i) => mask.addColorStop(i / stops.length, `rgba(255,255,255,${opacity})`))
      mask.addColorStop(1, `rgba(255,255,255,${stops[0]})`)
      field.fillStyle = mask
    }
    field.fillRect(-pad, -pad, w + pad * 2, h + pad * 2)
    field.globalCompositeOperation = 'source-over'
  }

  const draw = (opacity: number, blur: number) => {
    ctx.globalAlpha = alpha * Math.min(1, opacity)
    // Canvas filter kernels are in backing-store pixels, not layer coordinates.
    ctx.filter = `${filter} blur(${blur * pixelScale}px)`
    ctx.drawImage(canvas, -pad, -pad, w + pad * 2, h + pad * 2)
  }
  ctx.save()
  if (outside) {
    const exterior = new Path2D()
    exterior.rect(-pad, -pad, w + pad * 2, h + pad * 2)
    exterior.addPath(outline(shape, 0))
    ctx.clip(exterior, 'evenodd')
  } else ctx.clip(outline(shape, 0))
  const breathe = pulse ? motion['--bgh-'] ?? 1 : 1
  if (e.glowSize! > 0) {
    // A wider source gives the halo enough color mass. Blurring a hairline
    // alone diluted it into the nearly invisible patches seen on white fills.
    stroke(Math.max(edge, 12 * Math.sqrt(e.glowSize!)))
    draw(theme === 'light' ? .8 : 1, (outside ? 5 : 4) * e.glowSize! * breathe)
    draw(theme === 'light' ? .55 : .8, (outside ? 14 : 10) * e.glowSize! * breathe)
  }
  ctx.restore()
  // Both inner and outer styles have a crisp colored edge. This stays readable
  // over white, saturated fills, and transparent media without altering content.
  stroke(edge, true)
  draw(mono && theme === 'light' ? .9 : 1, 0)
  ctx.restore()
}
