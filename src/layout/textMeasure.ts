// SPDX-License-Identifier: Apache-2.0

import type { Yoga, MeasureFunction } from 'yoga-layout/load'
import { numberFlowTextAtProgress } from '@/anim/numberFlow'
import { displayedText } from '@/scene/text'
import type { TextNode } from '@/scene/types'

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
  const style = node.fontStyle ?? 'normal'
  const variant =
    node.textCase === 'small-caps' || node.textCase === 'small-caps-forced'
      ? 'small-caps'
      : 'normal'
  return `${style} ${variant} ${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`
}

function measureTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  letterSpacing: number,
): number {
  const base = ctx.measureText(text).width
  if (!Number.isFinite(letterSpacing) || letterSpacing === 0) return base
  const glyphCount = Array.from(text).length
  return base + Math.max(0, glyphCount - 1) * letterSpacing
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
      if (measureTextWidth(ctx, candidate, 0) <= maxWidth || line === '') {
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
    return measureTextNodeSize(
      node,
      widthMode === yoga.MEASURE_MODE_UNDEFINED ? undefined : Math.max(1, width),
    )
  }
}

/**
 * Measure one text node without constructing a Yoga tree.
 *
 * The selected-text resize preview uses this to update only its lightweight
 * DOM proxy while the authored scene layout stays frozen. Keeping this math
 * shared with Yoga prevents the proxy from snapping to a different wrap on
 * release.
 */
export function measureTextNodeSize(
  node: TextNode,
  widthBudget?: number,
): { width: number; height: number } {
  const ctx = getCtx()
  const texts = measurementTexts(node)
  if (!ctx) {
    // No canvas available — fall back to a rough estimate so we don't
    // collapse to 0. 0.6em per glyph is a reasonable average for
    // proportional fonts.
    const charW = node.fontSize * 0.6 + Math.max(0, node.letterSpacing)
    const naturalWidth = Math.max(
      1,
      ...texts.map((text) => text.length * charW),
    )
    const effectiveWidth = Math.max(1, widthBudget ?? naturalWidth)
    const estimatedLines = widthBudget
      ? Math.max(1, Math.ceil(naturalWidth / effectiveWidth))
      : Math.max(1, ...texts.map((text) => text.split('\n').length))
    return {
      width: widthBudget ? effectiveWidth : naturalWidth,
      height: Math.max(
        1,
        Math.ceil(estimatedLines * node.fontSize * node.lineHeight),
      ),
    }
  }
  ctx.font = fontString(node)
  const lineSets = texts.map((text) =>
    widthBudget === undefined
      ? text.split('\n')
      : wrapToWidthWithTracking(
          ctx,
          text,
          Math.max(1, widthBudget),
          node.letterSpacing,
        ),
  )
  const lineCount = Math.max(1, ...lineSets.map((lines) => lines.length))
  const measuredWidth = Math.max(
    0,
    ...lineSets.map((lines) =>
      widestLineWidthWithTracking(ctx, lines, node.letterSpacing),
    ),
  )
  // CRITICAL: ceil + 1px safety margin.
  //
  // `measureText` returns a fractional width (e.g. 127.34px). If we
  // hand that back to Yoga, the renderer's `rect.width` floors to
  // 127px while CSS still tries to lay out the full 127.34px of text
  // inside that box — the last word overflows by 0.34px and CSS
  // breaks it onto a new line. The extra pixel also keeps the isolated
  // live preview aligned with the released Yoga result.
  return {
    width: Math.max(1, Math.ceil(measuredWidth) + 1),
    height: Math.max(
      1,
      Math.ceil(lineCount * node.fontSize * node.lineHeight),
    ),
  }
}

/**
 * Number Flow can begin with a wider value than the authored destination.
 * Reserve the larger endpoint so hug-sized text does not clip or relayout
 * while the timeline advances.
 */
function measurementTexts(node: TextNode): string[] {
  const target = displayedText(node)
  const config = node.textAnimation
  if (config?.id !== 'number-flow') return [target]

  const from = numberFlowTextAtProgress(
    target,
    config.numberFrom,
    'in',
    0,
  )
  return from === target ? [target] : [target, from]
}

function widestLineWidthWithTracking(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  letterSpacing: number,
): number {
  let max = 0
  for (const line of lines) {
    const w = measureTextWidth(ctx, line, letterSpacing)
    if (w > max) max = w
  }
  return max
}

function wrapToWidthWithTracking(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  letterSpacing: number,
): string[] {
  if (!Number.isFinite(letterSpacing) || letterSpacing === 0) {
    return wrapToWidth(ctx, text, maxWidth)
  }
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      out.push('')
      continue
    }
    const tokens = paragraph.split(/(\s+)/)
    let line = ''
    for (const tok of tokens) {
      const candidate = line + tok
      if (measureTextWidth(ctx, candidate, letterSpacing) <= maxWidth || line === '') {
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
