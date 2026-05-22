// SPDX-License-Identifier: Apache-2.0

import type { Fill, GradientStop, Stroke, StrokeStyle } from '@/scene'
import { hexToOklch, formatOklch } from '@/ui/fields/colorConvert'
import type {
  FigmaCapturedFill,
  FigmaGradientFill,
  FigmaImageFill,
  FigmaSolidFill,
} from './types'

/**
 * Map a Figma fill to our Fill shape.
 *
 * Figma's `fills` is an array (a node can stack many paints). We don't
 * support stacked fills today — take the FIRST visible fill as the
 * canonical one. Future work: render stacked fills as nested
 * frames + clip rules. For MVP "single fill" matches what most designs
 * actually use.
 *
 * `assets` resolves IMAGE fills' `imageHash` into a base64 PNG that we
 * inline as a data URL. Hash → data URL mapping is built once during
 * import (see walk.ts).
 */
export function figmaToFill(
  fills: FigmaCapturedFill[],
  assets: Record<string, string>,
): Fill | null {
  const visible = fills.find((f) => f.visible)
  if (!visible) return null
  switch (visible.type) {
    case 'SOLID':
      return solid(visible)
    case 'GRADIENT_LINEAR':
      return linear(visible)
    case 'GRADIENT_RADIAL':
      return radial(visible)
    case 'GRADIENT_ANGULAR':
      return conic(visible)
    case 'GRADIENT_DIAMOND':
      // Figma's diamond gradient has no CSS analog. Approximate with a
      // radial; users get a similar fall-off shape and can tweak in the
      // Inspector after import.
      return radial(visible)
    case 'IMAGE':
      return image(visible, assets)
    default:
      return null
  }
}

/**
 * Map Figma's `strokes` + width/align/dashes to our Stroke shape. Like
 * fills, we take the first visible entry from the strokes array.
 */
export function figmaToStroke(
  strokes: FigmaCapturedFill[],
  weight: number,
  align: 'INSIDE' | 'OUTSIDE' | 'CENTER',
  dashes: number[],
  assets: Record<string, string>,
  widths?: { top: number; right: number; bottom: number; left: number },
): Stroke | null {
  const visible = strokes.find((s) => s.visible)
  // Per-side widths might exist even when uniform `weight` is 0 — e.g.,
  // a "1px bottom border only" tab. Don't bail early in that case.
  const hasAnyWidth =
    weight > 0 ||
    (widths && (widths.top > 0 || widths.right > 0 || widths.bottom > 0 || widths.left > 0))
  if (!visible || !hasAnyWidth) return null
  const fill = figmaToFill([visible], assets)
  const color = solidColorFor(fill)
  const style: StrokeStyle = dashes.length > 0 ? 'dashed' : 'solid'
  return {
    color,
    // Pick the largest side as the canonical "width" so the legacy
    // uniform-stroke fast path reads sensibly when the renderer
    // doesn't yet honor `widths`.
    width:
      widths !== undefined
        ? Math.max(widths.top, widths.right, widths.bottom, widths.left)
        : weight,
    widths,
    align: align.toLowerCase() as Stroke['align'],
    style,
    dashLength: dashes[0] ?? 6,
    dashGap: dashes[1] ?? 4,
    fill: fill && fill.kind !== 'solid' ? fill : null,
  }
}

// ---------------------------------------------------------------------------
// Per-kind converters
// ---------------------------------------------------------------------------

function solid(f: FigmaSolidFill): Fill {
  return {
    kind: 'solid',
    color: colorWithOpacity(f.color.r, f.color.g, f.color.b, f.opacity),
  }
}

function linear(f: FigmaGradientFill): Fill {
  // Figma's first two handles define the line: handle[0] is the start
  // (position 0), handle[1] is the end (position 1). The angle is the
  // direction from start to end measured in CSS-degree convention
  // (0° = up, 90° = right, increasing clockwise).
  const a = f.gradientHandlePositions[0] ?? { x: 0.5, y: 0 }
  const b = f.gradientHandlePositions[1] ?? { x: 0.5, y: 1 }
  // atan2 returns radians from +x axis (math convention). Convert to
  // CSS angle: rotate so 0° = up (= -y), then go clockwise.
  const dx = b.x - a.x
  const dy = b.y - a.y
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI
  if (angle < 0) angle += 360
  return {
    kind: 'linear',
    stops: stopsToOurs(f.gradientStops),
    angle: Math.round(angle),
  }
}

function radial(f: FigmaGradientFill): Fill {
  // Center comes from handle[0]; the other handles describe the radius
  // and aspect — we drop them and let our `radial-gradient(circle ...)`
  // emit a sensibly sized falloff to the farthest corner.
  const center = f.gradientHandlePositions[0] ?? { x: 0.5, y: 0.5 }
  return {
    kind: 'radial',
    stops: stopsToOurs(f.gradientStops),
    cx: clamp01(center.x),
    cy: clamp01(center.y),
    shape: 'ellipse',
  }
}

function conic(f: FigmaGradientFill): Fill {
  const center = f.gradientHandlePositions[0] ?? { x: 0.5, y: 0.5 }
  // Starting angle from the second handle relative to center. CSS
  // conic-gradient `from <angle>` controls where stop 0% sits.
  const ref = f.gradientHandlePositions[1] ?? { x: center.x + 0.5, y: center.y }
  const dx = ref.x - center.x
  const dy = ref.y - center.y
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI
  if (angle < 0) angle += 360
  return {
    kind: 'conic',
    stops: stopsToOurs(f.gradientStops),
    angle: Math.round(angle),
    cx: clamp01(center.x),
    cy: clamp01(center.y),
  }
}

function image(f: FigmaImageFill, assets: Record<string, string>): Fill | null {
  const asset = assets[f.imageHash]
  if (!asset) return null
  // The plugin embeds the MIME (`data:image/png;base64,...`) since
  // Figma's `getBytesAsync` returns the original asset format, which
  // can be PNG / JPEG / GIF / WebP. Older payloads used to ship the
  // raw base64; the `data:` prefix detects which we got and falls
  // back to PNG for the legacy path. Keeps both shapes loadable.
  const src = asset.startsWith('data:')
    ? asset
    : `data:image/png;base64,${asset}`
  const fit: Extract<Fill, { kind: 'image' }>['fit'] =
    f.scaleMode === 'FILL'
      ? 'cover'
      : f.scaleMode === 'FIT'
        ? 'contain'
        : f.scaleMode === 'TILE'
          ? 'tile'
          : f.scaleMode === 'STRETCH'
            ? 'fill'
            : // CROP isn't supported as a distinct mode in our schema; nearest
              // visual analog is `cover`. Surface a warning later if needed.
              'cover'
  return { kind: 'image', src, fit }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stopsToOurs(
  stops: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }>,
): GradientStop[] {
  return stops.map((s) => ({
    at: clamp01(s.position),
    color: colorWithOpacity(s.color.r, s.color.g, s.color.b, s.color.a),
  }))
}

function colorWithOpacity(r: number, g: number, b: number, opacity = 1): string {
  const alpha = clamp01(opacity)
  if (alpha < 1) return rgbToRgba(r, g, b, alpha)
  return rgbToOklch(r, g, b)
}

function rgbToRgba(r: number, g: number, b: number, alpha: number): string {
  return `rgba(${channelToByte(r)}, ${channelToByte(g)}, ${channelToByte(b)}, ${alpha})`
}

function channelToByte(n: number): number {
  return Math.round(clamp01(n) * 255)
}

function rgbToOklch(r: number, g: number, b: number): string {
  // Figma's r/g/b are 0..1 sRGB. Convert via hex round-trip — reuses
  // the OKLab math in colorConvert.ts without us re-implementing it.
  const hex =
    '#' +
    [r, g, b]
      .map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0'))
      .join('')
  const lch = hexToOklch(hex)
  if (!lch) return 'oklch(0.5 0 0)'
  return formatOklch(lch)
}

function solidColorFor(fill: Fill | null): string {
  if (!fill) return 'oklch(0.5 0 0)'
  if (fill.kind === 'solid') return fill.color
  // For gradient/image strokes, compute a representative solid color
  // from the first stop (gradient) or a neutral mid-grey (image). The
  // renderer uses this for the fast solid-stroke path; gradients render
  // through the SVG overlay regardless.
  if (fill.kind === 'linear' || fill.kind === 'radial' || fill.kind === 'conic') {
    return fill.stops[0]?.color ?? 'oklch(0.5 0 0)'
  }
  return 'oklch(0.5 0 0)'
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
