// SPDX-License-Identifier: Apache-2.0

/**
 * Color interpolation in OKLCH space.
 *
 * Why OKLCH: interpolating in sRGB or HSL produces muddy midpoints —
 * tween from red to green and you get a dead gray at 0.5. OKLCH
 * interpolates through perceptual color space, so transitions stay
 * visually coherent (the midpoint of red → green is a real olive, not
 * brown soup). This matches how a human expects colors to blend.
 *
 * Scope: we parse and emit OKLCH strings specifically — every color
 * in the app already flows through that format (see
 * `DEFAULT_APPEARANCE.fill` etc.). RGB / HSL / hex fallbacks land if
 * we ever accept imported palettes, but for keyframed tweens we assume
 * OKLCH on both endpoints. When a parse fails we defer to step
 * semantics (returns null; the caller falls through to step).
 */

export interface OklchColor {
  /** Lightness, 0..1. */
  L: number
  /** Chroma, 0..~0.4 in practice. */
  C: number
  /** Hue in degrees, 0..360. NaN when chroma is 0 (no meaningful hue). */
  H: number
  /** Alpha 0..1, defaults to 1 when omitted. */
  alpha: number
}

/**
 * Parse an `oklch(...)` string into an {@link OklchColor}. Accepts both
 * the space-separated modern syntax (`oklch(0.7 0.2 300)`) and the
 * percentage-lightness variant (`oklch(70% 0.2 300)`). Alpha is
 * optional: `oklch(0.7 0.2 300 / 0.5)` or `oklch(0.7 0.2 300 / 50%)`.
 *
 * Returns null for anything we don't know how to parse — callers should
 * step-interpolate in that case.
 */
export function parseOklch(input: string): OklchColor | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  // Cheap prefix check so we don't regex unrelated values.
  if (!trimmed.toLowerCase().startsWith('oklch')) return null
  const body = trimmed.slice(trimmed.indexOf('(') + 1, trimmed.lastIndexOf(')'))
  if (!body) return null
  // Split the three components and an optional alpha after a `/`.
  // Commas are tolerated because some tooling still emits the legacy
  // comma-separated form — the CSS spec accepts both.
  const [main, alphaStr] = body.split('/').map((s) => s.trim())
  const rawParts = (main ?? '').split(/[\s,]+/).filter(Boolean)
  if (rawParts.length < 3) return null
  const L = parseNumberOrPercent(rawParts[0]!, 1)
  const C = parseNumberOrPercent(rawParts[1]!, 0.4)
  const H = parseAngle(rawParts[2]!)
  const alpha = alphaStr !== undefined ? parseNumberOrPercent(alphaStr, 1) : 1
  if (L === null || C === null || H === null || alpha === null) return null
  return { L, C, H, alpha }
}

/**
 * Serialize an {@link OklchColor} back to a CSS string. We emit the
 * modern space-separated form because that's what the app writes as
 * `DEFAULT_APPEARANCE.fill` and what the fillToCss serializer knows
 * how to forward to CSS without further munging.
 *
 * Precision: 4 decimal places for L/C (plenty for human-visible
 * diffs), 2 for hue. Trailing zeros kept for determinism — makes
 * diffs stable when colors get written back to scene state.
 */
export function formatOklch(c: OklchColor): string {
  const L = clamp(c.L, 0, 1).toFixed(4)
  const C = Math.max(0, c.C).toFixed(4)
  const H = normalizeHue(c.H).toFixed(2)
  if (c.alpha >= 1) return `oklch(${L} ${C} ${H})`
  const A = clamp(c.alpha, 0, 1).toFixed(4)
  return `oklch(${L} ${C} ${H} / ${A})`
}

/**
 * Linearly interpolate two {@link OklchColor}s.
 *
 *   - L, C, alpha tween linearly — they are scalar.
 *   - Hue tweens along the SHORT arc of the color wheel. If the two
 *     hues straddle 360° (e.g. red at 20° and violet at 340°) the
 *     naïve linear interp goes the LONG way (180° sweep through
 *     green); shortest-arc takes the 40° shortcut that users actually
 *     expect.
 *   - When a color has zero chroma, its hue is meaningless (grayscale)
 *     — we inherit the other color's hue so the transition doesn't
 *     visibly jump through some arbitrary angle.
 */
export function lerpOklch(a: OklchColor, b: OklchColor, u: number): OklchColor {
  const t = clamp(u, 0, 1)
  const aHueMeaningful = a.C > 0 && !Number.isNaN(a.H)
  const bHueMeaningful = b.C > 0 && !Number.isNaN(b.H)
  let aH = aHueMeaningful ? a.H : b.H
  let bH = bHueMeaningful ? b.H : a.H
  if (Number.isNaN(aH)) aH = 0
  if (Number.isNaN(bH)) bH = 0
  // Shortest-arc interpolation. Walk the smaller of the two possible
  // paths around the wheel by wrapping the delta to the (-180, 180] range.
  let dH = bH - aH
  if (dH > 180) dH -= 360
  else if (dH < -180) dH += 360
  return {
    L: a.L + (b.L - a.L) * t,
    C: a.C + (b.C - a.C) * t,
    H: normalizeHue(aH + dH * t),
    alpha: a.alpha + (b.alpha - a.alpha) * t,
  }
}

/**
 * Convenience: take two OKLCH strings and an easing-adjusted u in
 * [0, 1], return the interpolated OKLCH string. Returns null if either
 * endpoint fails to parse; the caller should fall through to step
 * interpolation in that case.
 */
export function lerpOklchStrings(
  aStr: string,
  bStr: string,
  u: number,
): string | null {
  const a = parseOklch(aStr)
  const b = parseOklch(bStr)
  if (!a || !b) return null
  return formatOklch(lerpOklch(a, b, u))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function normalizeHue(h: number): number {
  let r = h % 360
  if (r < 0) r += 360
  return r
}

function parseNumberOrPercent(s: string, percentBase: number): number | null {
  if (s.endsWith('%')) {
    const v = Number(s.slice(0, -1))
    return Number.isFinite(v) ? (v / 100) * percentBase : null
  }
  // 'none' is a valid CSS color-component token meaning "missing" —
  // treat it as 0 so we degrade gracefully instead of returning null.
  if (s === 'none') return 0
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

function parseAngle(s: string): number | null {
  // Hue can be bare (treated as degrees), or suffixed with a unit
  // (deg / rad / turn / grad). We only normalize the ones CSS actually
  // accepts for hue; anything else returns null.
  if (s === 'none') return 0
  const match = /^(-?[\d.]+)(deg|rad|turn|grad)?$/.exec(s)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n)) return null
  switch (match[2]) {
    case 'rad':
      return (n * 180) / Math.PI
    case 'turn':
      return n * 360
    case 'grad':
      return n * 0.9
    case 'deg':
    case undefined:
    default:
      return n
  }
}