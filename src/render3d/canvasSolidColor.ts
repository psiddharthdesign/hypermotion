// SPDX-License-Identifier: Apache-2.0

let canvasColorParserContext: CanvasRenderingContext2D | null | undefined
const parsedCanvasColorCache = new Map<string, string | null>()

export function parseCanvasSolidColor(css: string): string | null {
  const value = css.trim()
  if (!value || value.includes('gradient(') || value.startsWith('url(')) {
    return null
  }
  const cached = parsedCanvasColorCache.get(value)
  if (cached !== undefined || parsedCanvasColorCache.has(value)) return cached ?? null

  // Camera-only playback calls `syncBackground` every display frame. The old
  // parser allocated a fresh canvas/context for the unchanged fill each time,
  // creating hundreds of short-lived GPU-backed objects during Space-bar
  // playback. Keep one tiny parser context and cache the normalized result.
  if (typeof document === 'undefined') return value
  if (canvasColorParserContext === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    canvasColorParserContext = canvas.getContext('2d')
  }
  const ctx = canvasColorParserContext
  if (!ctx) {
    parsedCanvasColorCache.set(value, value)
    return value
  }
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000000'
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  // Canvas retains modern inputs such as `oklch(...)` in fillStyle, while
  // Three's color parser does not understand that syntax. Sampling the
  // painted pixel converts every browser-supported solid color to sRGB.
  // Emit hex rather than modern space-separated rgb(): the pinned Three.js
  // parser accepts legacy comma rgb() only and otherwise silently leaves the
  // background at its previous color.
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  const parsed = `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
  parsedCanvasColorCache.set(value, parsed)
  return parsed
}
