// SPDX-License-Identifier: Apache-2.0

/**
 * Color conversions between sRGB hex and OKLCH.
 *
 * The scene stores colors as `oklch(L C H)` strings — a perceptual space
 * we picked because equal chroma / lightness steps look like equal
 * color steps. But designers reach for hex codes constantly (Figma,
 * Slack, Pantone-translated palettes), so the picker has to accept hex
 * input AND emit hex when displaying. These helpers do the round trip.
 *
 * Pipeline: sRGB hex → linear sRGB → CIE XYZ-via-OKLab → OKLCH.
 *
 * Math is from the Björn Ottosson reference (https://bottosson.github.io/posts/oklab/).
 * No dependencies — keeps the picker self-contained and avoids pulling
 * a 30 KB color library for one screen of conversion.
 */

export interface Lch {
  l: number // 0..1
  c: number // 0..0.4 practical
  h: number // 0..360
}

// ---------------------------------------------------------------------------
// hex ↔ sRGB
// ---------------------------------------------------------------------------

/** Parse `#abc`, `#aabbcc`, or `aabbcc` into [r, g, b] in 0..1 sRGB. */
export function parseHex(input: string): [number, number, number] | null {
  let s = input.trim().toLowerCase()
  if (s.startsWith('#')) s = s.slice(1)
  if (s.length === 3) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (s.length !== 6) return null
  if (!/^[0-9a-f]{6}$/.test(s)) return null
  const r = parseInt(s.slice(0, 2), 16) / 255
  const g = parseInt(s.slice(2, 4), 16) / 255
  const b = parseInt(s.slice(4, 6), 16) / 255
  return [r, g, b]
}

/** Format [r, g, b] in 0..1 sRGB as `#rrggbb`. */
export function formatHex(rgb: [number, number, number]): string {
  const to2 = (n: number) => {
    const c = Math.max(0, Math.min(255, Math.round(n * 255)))
    return c.toString(16).padStart(2, '0')
  }
  return '#' + to2(rgb[0]) + to2(rgb[1]) + to2(rgb[2])
}

// ---------------------------------------------------------------------------
// sRGB ↔ linear sRGB ↔ OKLab ↔ OKLCH
// ---------------------------------------------------------------------------

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** Linear sRGB → OKLab. From https://bottosson.github.io/posts/oklab/ */
function linearSrgbToOklab(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ]
}

function oklabToLinearSrgb(
  L: number,
  a: number,
  b: number,
): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Hex string → OKLCH; null if the hex is malformed. */
export function hexToOklch(hex: string): Lch | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map(srgbToLinear) as [number, number, number]
  const [L, A, B] = linearSrgbToOklab(r, g, b)
  const c = Math.sqrt(A * A + B * B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h }
}

/** OKLCH → hex string. Out-of-gamut colors get clamped to displayable sRGB. */
export function oklchToHex(lch: Lch): string {
  const a = lch.c * Math.cos((lch.h * Math.PI) / 180)
  const b = lch.c * Math.sin((lch.h * Math.PI) / 180)
  let [r, g, bl] = oklabToLinearSrgb(lch.l, a, b)
  // Naive gamut clamp: snap each channel into [0,1]. Fine for picker
  // round-trips; a perceptual gamut-mapping pass (e.g. Bjorn's CSS Color
  // 4 algorithm) is overkill for the editor's hex display.
  r = Math.max(0, Math.min(1, r))
  g = Math.max(0, Math.min(1, g))
  bl = Math.max(0, Math.min(1, bl))
  return formatHex([linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)])
}

// ---------------------------------------------------------------------------
// oklch() string parse / format — duplicated from FillField for now,
// rolled in here so the conversion module is the single source of truth.
// ---------------------------------------------------------------------------

export function formatOklch(lch: Lch): string {
  const L = clamp(lch.l, 0, 1).toFixed(3)
  const C = clamp(lch.c, 0, 0.4).toFixed(3)
  const H = Math.round(((lch.h % 360) + 360) % 360)
  return `oklch(${L} ${C} ${H})`
}

export function parseOklch(str: string | null | undefined): Lch | null {
  if (!str) return null
  const m = str
    .trim()
    .match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:\s*\/\s*[\d.%]+)?\s*\)$/i)
  if (!m) return null
  const parsePercentOr = (s: string) =>
    s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s)
  const l = parsePercentOr(m[1]!)
  const c = parsePercentOr(m[2]!)
  const h = Number(m[3]!)
  if ([l, c, h].some((n) => Number.isNaN(n))) return null
  return { l, c, h }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}