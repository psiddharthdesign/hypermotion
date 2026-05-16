// SPDX-License-Identifier: Apache-2.0

import type { Yoga, MeasureFunction } from 'yoga-layout/load'
import type { TextNode } from '@/scene'

/**
 * Text intrinsic measurement for Yoga.
 *
 * Yoga has no idea what a glyph is, so a text node sized `hug/hug` would
 * resolve to 0×0 — invisible, and useless for resize handles. We give
 * Yoga a measure function that computes the natural width/height of the
 * node's text using Canvas2D's `measureText`, which is fast (no DOM
 * mutation), font-aware, and works in a worker too.
 *
 * Wrap behavior:
 *   - widthMode === Undefined  → no wrap. Single line, width is the
 *                                 widest natural line in the source text.
 *   - widthMode === AtMost     → greedy word-wrap to the available width.
 *                                 Long single tokens that exceed width
 *                                 stay on their own line (no mid-word
 *                                 break) — matches how Figma reports
 *                                 intrinsic text under "Auto height."
 *   - widthMode === Exactly    → use the exact width as the wrap budget.
 *
 * Height is always lineCount * fontSize * lineHeight (lineHeight is the
 * scene-level multiplier, e.g. 1.4). Honoring per-line ascent/descent is
 * a Step 4.5 concern when we move to Pixi text — the DOM renderer's CSS
 * `line-height` matches this same arithmetic, so what we measure is what
 * gets painted.
 */

let sharedCanvas: HTMLCanvasElement | null = null
let sharedCtx: CanvasRenderingContext2D | null = null

function getCtx(): CanvasRenderingContext2D | null {
  if (sharedCtx) return sharedCtx
  if (typeof document === 'undefined') return null // SSR / worker without OffscreenCanvas
  sharedCanvas = document.createElement('canvas')
  sharedCtx = sharedCanvas.getContext('2d')
  return sharedCtx
}

function fontString(node: TextNode): string {
  // CSS shorthand: `<weight> <size>px/<line-height> <family>`. We omit
  // line-height from the shorthand because Canvas2D ignores it during
  // measureText anyway — line height only matters for our height math.
  return `${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`
}

function widestLineWidth(ctx: CanvasRenderingContext2D, lines: string[]): number {
  let max = 0
  for (const line of lines) {
    const w = ctx.measureText(line).width
    if (w > max) max = w
  }
  return max
}

/**
 * Greedy word wrap. Splits on spaces; a token longer than `maxWidth`
 * still occupies its own line rather than being mid-word-broken — the
 * resulting line will overflow visually, which matches Figma's "Auto
 * height" with a single very long word.
 */
function wrapToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = []
  // Preserve user-authored line breaks first; wrap each paragraph.
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      out.push('')
      continue
    }
    const tokens = paragraph.split(/(\s+)/) // keep whitespace as tokens so we don't lose it
    let line = ''
    for (const tok of tokens) {
      const candidate = line + tok
      if (ctx.measureText(candidate).width <= maxWidth || line === '') {
        line = candidate
      } else {
        out.push(line.replace(/\s+$/, ''))
        line = tok.replace(/^\s+/, '')
      }
    }
    out.push(line)
  }
  return out
}

/**
 * Build a Yoga MeasureFunction for one text node. The closure captures
 * the node by reference, so each `solveLayout` call generates fresh
 * measure funcs for the current text/font/size/etc — no stale closures
 * across re-solves.
 */
export function makeTextMeasure(yoga: Yoga, node: TextNode): MeasureFunction {
  return (width, widthMode, _height, _heightMode) => {
    void _height
    void _heightMode
    const ctx = getCtx()
    if (!ctx) {
      // No canvas available — fall back to a rough estimate so we don't
      // collapse to 0. 0.6em per glyph is a reasonable average for
      // proportional fonts.
      const charW = node.fontSize * 0.6
      const lines = node.text.split('\n').length || 1
      return {
        width: Math.max(1, node.text.length * charW),
        height: Math.max(1, lines * node.fontSize * node.lineHeight),
      }
    }
    ctx.font = fontString(node)

    let lines: string[]
    if (widthMode === yoga.MEASURE_MODE_UNDEFINED) {
      // Natural single-line measurement per source line. No wrap.
      lines = node.text.split('\n')
    } else {
      // Exactly + AtMost both wrap to the given width budget. The
      // difference matters for Yoga's internal sizing decisions, not
      // for what we report back.
      const budget = Math.max(1, width)
      lines = wrapToWidth(ctx, node.text, budget)
    }

    const lineCount = Math.max(1, lines.length)
    const measuredWidth = widestLineWidth(ctx, lines)
    // CRITICAL: ceil + 1px safety margin.
    //
    // `measureText` returns a fractional width (e.g. 127.34px). If we
    // hand that back to Yoga, the renderer's `rect.width` floors to
    // 127px while CSS still tries to lay out the full 127.34px of text
    // inside that box — the last word overflows by 0.34px and CSS
    // breaks it onto a new line. The visible result is "I set hug
    // width and the text still wrapped." Ceiling alone closes the gap
    // for most cases; the extra +1 is insurance against font-hinting
    // rounding that can still nudge sub-pixel widths in either tree.
    return {
      width: Math.max(1, Math.ceil(measuredWidth) + 1),
      height: Math.max(1, Math.ceil(lineCount * node.fontSize * node.lineHeight)),
    }
  }
}