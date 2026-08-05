// SPDX-License-Identifier: Apache-2.0

import type { Rect } from '@/layout'
import type { Effect, Node } from '@/scene'
import {
  clampLayerBlurAmount,
  effectStableId,
} from '@/scene/effects'

export interface LayerEffectInsets {
  top: number
  right: number
  bottom: number
  left: number
}

const ZERO_EFFECT_INSETS: LayerEffectInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
})

/**
 * Pixel overflow required to keep raster effects from being clipped.
 *
 * Canvas blur kernels are not specified with a precise support radius. Two
 * authored blur radii gives Chromium enough room for the visible tail while
 * keeping vector textures bounded for realtime editing.
 */
export function layerEffectInsets(
  effects: readonly Effect[] | null | undefined,
): LayerEffectInsets {
  if (!effects?.length) return ZERO_EFFECT_INSETS

  let top = 0
  let right = 0
  let bottom = 0
  let left = 0
  for (const effect of effects) {
    if (effect.visible === false || effect.kind === 'inner-shadow') continue
    if (effect.kind === 'blur') {
      const padding = clampLayerBlurAmount(effect.amount) * 2
      top = Math.max(top, padding)
      right = Math.max(right, padding)
      bottom = Math.max(bottom, padding)
      left = Math.max(left, padding)
      continue
    }

    const blurPadding = Math.max(0, finite(effect.blur)) * 2
    const spread = Math.max(0, finite(effect.spread ?? 0))
    const offsetX = finite(effect.offsetX)
    const offsetY = finite(effect.offsetY)
    left = Math.max(left, blurPadding + spread - offsetX)
    right = Math.max(right, blurPadding + spread + offsetX)
    top = Math.max(top, blurPadding + spread - offsetY)
    bottom = Math.max(bottom, blurPadding + spread + offsetY)
  }

  return { top, right, bottom, left }
}

export function expandRectForLayerEffects(
  rect: Rect,
  effects: readonly Effect[] | null | undefined,
): Rect {
  const insets = layerEffectInsets(effects)
  return {
    x: rect.x - insets.left,
    y: rect.y - insets.top,
    width: Math.max(1, rect.width + insets.left + insets.right),
    height: Math.max(1, rect.height + insets.top + insets.bottom),
  }
}

export function hasVisibleLayerEffects(
  effects: readonly Effect[] | null | undefined,
): boolean {
  return !!effects?.some((effect) => effect.visible !== false)
}

/**
 * Overlay animation/gesture values on the persisted effect stack without
 * mutating it. One semantic blur track drives shadow blur and layer amount.
 */
export function resolveAnimatedLayerEffects(
  effects: readonly Effect[] | null | undefined,
  animatedBlur: Readonly<Record<string, number>> | null | undefined,
): readonly Effect[] {
  if (!effects?.length || !animatedBlur) return effects ?? []
  let changed = false
  const resolved = effects.map((effect, index) => {
    const value = animatedBlur[effectStableId(effect, index)]
    if (value === undefined || !Number.isFinite(value)) return effect
    changed = true
    return effect.kind === 'blur'
      ? { ...effect, amount: clampLayerBlurAmount(value) }
      : { ...effect, blur: Math.max(0, value) }
  })
  return changed ? resolved : effects
}

/**
 * Frames are compositing groups: an effect authored on the frame applies to
 * the frame's final pixels, including its children. Leaf layers can apply the
 * same effect directly to their own paint source.
 */
export function nodeEffectsWrapSubtree(
  node: Node,
  effects: readonly Effect[] | null | undefined = node.appearance.effects,
): boolean {
  return (
    node.kind === 'frame' &&
    node.children.length > 0 &&
    hasVisibleLayerEffects(effects)
  )
}

/**
 * Raster a layer once, then build its effects from that alpha mask. This is
 * especially important for imported SVGs: a box-shadow around their layout
 * rectangle is visibly wrong, while the source-alpha silhouette follows every
 * contour and transparent hole.
 */
export function paintLayerWithEffects(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effects: readonly Effect[] | null | undefined,
  paintSource: (source: CanvasRenderingContext2D) => void,
): void {
  const visible = effects?.filter((effect) => effect.visible !== false) ?? []
  if (visible.length === 0) {
    paintSource(ctx)
    return
  }

  const scale = rasterScaleForContext(ctx)
  const source = makeCanvas(ctx, width, height, scale)
  const sourceContext = source.getContext('2d')
  if (!sourceContext) {
    paintSource(ctx)
    return
  }
  sourceContext.scale(scale, scale)
  paintSource(sourceContext)

  // Drop shadows always sit behind the layer. Reverse traversal preserves the
  // Inspector stack: earlier rows remain visually above later shadow rows.
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const effect = visible[index]
    if (effect?.kind !== 'shadow') continue
    const silhouette = alphaTintCanvas(
      ctx,
      source,
      width,
      height,
      scale,
      effect.color,
    )
    const spread = Math.max(0, finite(effect.spread ?? 0))
    ctx.save()
    const blur = Math.max(0, finite(effect.blur))
    if (blur > 0) ctx.filter = `blur(${blur}px)`
    ctx.drawImage(
      silhouette,
      finite(effect.offsetX) - spread,
      finite(effect.offsetY) - spread,
      width + spread * 2,
      height + spread * 2,
    )
    ctx.restore()
  }

  const blurs = visible
    .filter((effect): effect is Extract<Effect, { kind: 'blur' }> =>
      effect.kind === 'blur',
    )
    .map((effect) => clampLayerBlurAmount(effect.amount))
    .filter((amount) => amount > 0)
  ctx.save()
  if (blurs.length > 0) {
    ctx.filter = blurs.map((amount) => `blur(${amount}px)`).join(' ')
  }
  ctx.drawImage(source, 0, 0, width, height)
  ctx.restore()

  // Inner shadows are the tinted inverse of an offset, blurred alpha mask,
  // clipped back into the original SVG silhouette.
  for (const effect of visible) {
    if (effect.kind !== 'inner-shadow') continue
    const inner = makeCanvas(ctx, width, height, scale)
    const innerContext = inner.getContext('2d')
    if (!innerContext) continue
    innerContext.scale(scale, scale)
    innerContext.fillStyle = effect.color
    innerContext.fillRect(0, 0, width, height)
    innerContext.globalCompositeOperation = 'destination-out'
    const blur = Math.max(0, finite(effect.blur))
    if (blur > 0) innerContext.filter = `blur(${blur}px)`
    const spread = Math.max(0, finite(effect.spread ?? 0))
    innerContext.drawImage(
      source,
      -finite(effect.offsetX) + spread,
      -finite(effect.offsetY) + spread,
      Math.max(0.001, width - spread * 2),
      Math.max(0.001, height - spread * 2),
    )
    innerContext.filter = 'none'
    innerContext.globalCompositeOperation = 'destination-in'
    innerContext.drawImage(source, 0, 0, width, height)
    ctx.drawImage(inner, 0, 0, width, height)
  }
}

function alphaTintCanvas(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  width: number,
  height: number,
  scale: number,
  color: string,
): HTMLCanvasElement {
  const silhouette = makeCanvas(ctx, width, height, scale)
  const silhouetteContext = silhouette.getContext('2d')
  if (!silhouetteContext) return silhouette
  silhouetteContext.scale(scale, scale)
  silhouetteContext.fillStyle = color
  silhouetteContext.fillRect(0, 0, width, height)
  silhouetteContext.globalCompositeOperation = 'destination-in'
  silhouetteContext.drawImage(source, 0, 0, width, height)
  return silhouette
}

function makeCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
): HTMLCanvasElement {
  const canvas = ctx.canvas.ownerDocument.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  return canvas
}

function rasterScaleForContext(ctx: CanvasRenderingContext2D): number {
  const transform = ctx.getTransform()
  const x = Math.hypot(transform.a, transform.b)
  const y = Math.hypot(transform.c, transform.d)
  return Math.max(0.25, Math.min(4, Math.max(x, y, 1)))
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}
