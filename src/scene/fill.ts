// SPDX-License-Identifier: Apache-2.0

/**
 * Fill serialization + defaults.
 *
 * Lives under `src/scene/` because the Fill *type* is here, but nothing
 * in this file does scene mutations — it's a pure utility that turns a
 * Fill into a CSS string, or hands back a sensible default Fill for a
 * given kind. Both Canvas (renderer) and Inspector (preview swatch +
 * initial value for new gradients) import from here.
 *
 * The DOM canvas and Pixi export renderer translate these same shapes
 * into their own paint primitives. Keeping the Fill model aligned with
 * the CSS gradient grammar means neither path has to do anything clever.
 */

import type * as React from 'react'
import type { Fill, GradientStop } from './types'

/**
 * Format a list of gradient stops the way CSS expects them, e.g.
 *   `oklch(0.2 0 0) 0%, oklch(0.95 0 0) 100%`
 * Used by both linear and radial serializers. Stops are emitted in
 * their current order — we don't re-sort because the Inspector already
 * keeps them sorted by `at` on every edit, and re-sorting here would
 * silently fight an animation that deliberately crosses stops.
 */
function stopsToCss(stops: GradientStop[]): string {
  if (stops.length === 0) return 'transparent 0%, transparent 100%'
  return stops
    .map((s) => `${s.color} ${(s.at * 100).toFixed(2)}%`)
    .join(', ')
}

/**
 * Turn a Fill into a CSS `background` value. Returns `undefined` when
 * the fill is null so the caller can drop the property entirely (Canvas
 * uses this to fall back to an inherited / default paint). Solid fills
 * emit a bare color, so they can still be read as a "plain" background
 * color by code that cares — the dashed-outline empty-frame check, for
 * example, stays unaffected.
 */
export function fillToCss(fill: Fill | null | undefined): string | undefined {
  if (!fill) return undefined
  switch (fill.kind) {
    case 'solid':
      return fill.color
    case 'linear':
      return `linear-gradient(${fill.angle}deg, ${stopsToCss(fill.stops)})`
    case 'radial': {
      const { shape, cx, cy } = fill
      const cxPct = (cx * 100).toFixed(2) + '%'
      const cyPct = (cy * 100).toFixed(2) + '%'
      // Default size keyword is farthest-corner, which gives a pleasing
      // "fills the box" behavior for both circles and ellipses without
      // needing an explicit radius field.
      return `radial-gradient(${shape} at ${cxPct} ${cyPct}, ${stopsToCss(fill.stops)})`
    }
    case 'conic': {
      const cxPct = (fill.cx * 100).toFixed(2) + '%'
      const cyPct = (fill.cy * 100).toFixed(2) + '%'
      // CSS `conic-gradient(from <angle> at <cx> <cy>, ...stops)`.
      return `conic-gradient(from ${fill.angle}deg at ${cxPct} ${cyPct}, ${stopsToCss(fill.stops)})`
    }
    case 'image': {
      // CSS image fills compose `url() <repeat?>` plus a sizing keyword
      // applied via background-size. The CSS string returned here only
      // needs the `background-image` portion — `imageBackgroundStyle`
      // below produces the full set of background-* declarations the
      // renderer needs.
      if (!fill.src) return undefined
      return `url(${JSON.stringify(fill.src)})`
    }
  }
}

/**
 * Full background-* CSS bundle for an image fill. Returned as an object
 * the renderer can spread directly into a `<div>` style. The reason this
 * exists separately from `fillToCss`: image fills need three CSS
 * properties (image, size, repeat), and `background` shorthand can't
 * cleanly co-exist with the `background:` value `fillToCss` returns
 * for solid/gradient fills. Keep them as distinct paths.
 */
export function imageBackgroundStyle(
  fill: Fill | null | undefined,
): React.CSSProperties | null {
  if (!fill || fill.kind !== 'image' || !fill.src) return null
  const size =
    fill.fit === 'tile'
      ? 'auto'
      : fill.fit === 'fill'
        ? '100% 100%'
        : fill.fit // 'cover' | 'contain' map straight to background-size
  const repeat = fill.fit === 'tile' ? 'repeat' : 'no-repeat'
  return {
    backgroundImage: `url(${JSON.stringify(fill.src)})`,
    backgroundSize: size,
    backgroundRepeat: repeat,
    backgroundPosition: 'center center',
  }
}

// ---------------------------------------------------------------------------
// Default fills — used when the user switches type in the Inspector. A
// freshly-switched gradient should look like a gradient, not a same-
// color-on-both-sides band, so defaults land at black↔white.
// ---------------------------------------------------------------------------

/** Two-stop black→white solid-neutral preset — used as the starter for any gradient. */
const NEUTRAL_STOPS: GradientStop[] = [
  { at: 0, color: 'oklch(1 0 0)' },
  { at: 1, color: 'oklch(0.18 0 0)' },
]

export function defaultFill(kind: Fill['kind']): Fill {
  switch (kind) {
    case 'solid':
      return { kind: 'solid', color: 'oklch(0.55 0.15 260)' }
    case 'linear':
      return { kind: 'linear', stops: [...NEUTRAL_STOPS], angle: 180 }
    case 'radial':
      return {
        kind: 'radial',
        stops: [...NEUTRAL_STOPS],
        cx: 0.5,
        cy: 0.5,
        shape: 'circle',
      }
    case 'conic':
      return {
        kind: 'conic',
        stops: [...NEUTRAL_STOPS],
        angle: 0,
        cx: 0.5,
        cy: 0.5,
      }
    case 'image':
      // Empty src — the popover prompts the user to drop an image or
      // paste a URL. An empty image fill renders as transparent rather
      // than throwing, so a half-configured fill doesn't break the canvas.
      return { kind: 'image', src: '', fit: 'cover' }
  }
}
