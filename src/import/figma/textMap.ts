// SPDX-License-Identifier: Apache-2.0

import type { Size, SizeAxis, TextNode } from '@/scene'
import { figmaToFill } from './fillMap'
import { isGoogleFont } from '@/ui/fonts/googleFonts'
import type { FigmaCapturedText } from './types'

/**
 * Map a Figma text node to a partial TextNode for createNode().
 *
 * `text/color/fontFamily/fontSize/fontWeight/lineHeight/letterSpacing/
 * textAlign` flow through directly. `size` prefers Figma's modern
 * `layoutSizingHorizontal/Vertical` (FILL / HUG / FIXED) when present,
 * because it's the only field that surfaces FILL — the "stretch to
 * parent width" mode that wraps long descriptions inside cards. Falls
 * back to the legacy `textAutoResize` for older captures:
 *   - 'NONE'              → fixed width + height (the captured rect)
 *   - 'HEIGHT'            → fixed width + hug height (wraps, grows down)
 *   - 'WIDTH_AND_HEIGHT'  → hug both (auto-sizes to glyph metrics)
 *
 * Pre-fix bug: a text marked FILL in Figma got treated as HUG by our
 * import (because `textAutoResize` reports 'WIDTH_AND_HEIGHT' for FILL
 * texts too), making the text expand single-line and overflow the
 * containing frame. Reading layoutSizing first fixes that.
 *
 * The first visible fill on the text node provides the color. Falls
 * back to a readable default if there's no fill — Figma rarely sends
 * fill-less text but our render path needs SOMETHING.
 */
export function figmaToText(
  node: FigmaCapturedText,
  assets: Record<string, string>,
): Partial<TextNode> {
  const fillObj = figmaToFill(node.fills, assets)
  const color =
    fillObj && fillObj.kind === 'solid'
      ? fillObj.color
      : 'oklch(0.86 0.012 280)'
  const size: Size = {
    width: resolveTextWidth(node),
    height: resolveAxis(
      node.layoutSizingVertical,
      node.height,
      // Vertical fallback stays generous: NONE means fixed pixel
      // height, anything else means hug-the-content vertically. Hug
      // height with a fixed width works fine in Yoga because the
      // text element has a real width constraint to wrap inside —
      // the same problem as horizontal hug doesn't apply.
      node.textAutoResize === 'NONE' ? node.height : 'hug',
    ),
  }
  // Hyper Motion stores `lineHeight` as a UNITLESS multiplier of
  // font-size (CSS-style "line-height: 1.4"). Figma sends it as
  // already-resolved pixels in `lineHeightPx`. Divide to get the
  // ratio so our text-measure code does `fontSize × lineHeight`
  // and lands on the correct rendered height.
  //
  // Without this conversion, a 14px font with lineHeightPx=20 was
  // being multiplied as 14 × 20 = 280px tall per line — that's why
  // imported text was inflating row heights.
  const lineHeightRatio =
    node.fontSize > 0 ? node.lineHeightPx / node.fontSize : 1.4
  // Font fallback: if Figma sent a family we don't have on our Google
  // Fonts allowlist (custom brand fonts, paid foundries, etc.), the
  // browser would fall back to its own generic serif — usually Times
  // New Roman, which looks nothing like the Figma source. Pin to Inter
  // instead: it's broadly neutral, already in our load list, and
  // matches what most modern Figma files use as their primary face.
  const fontFamily = isGoogleFont(node.fontFamily) ? node.fontFamily : 'Inter'
  if (fontFamily !== node.fontFamily) {
    console.warn(
      `[figma-import] font "${node.fontFamily}" not in our Google Fonts ` +
        `allowlist; falling back to Inter for "${node.characters.slice(0, 24)}".`,
    )
  }
  return {
    text: node.characters,
    fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    lineHeight: lineHeightRatio,
    letterSpacing: node.letterSpacingPx,
    textAlign:
      node.textAlignHorizontal === 'LEFT'
        ? 'start'
        : node.textAlignHorizontal === 'RIGHT'
          ? 'end'
          : 'center',
    color,
    size,
  }
}

function resolveTextWidth(node: FigmaCapturedText): SizeAxis {
  if (node.layoutSizingHorizontal === 'FILL') return 'fill'
  if (node.layoutSizingHorizontal === 'HUG') return 'hug'
  // Figma can report layoutSizingHorizontal=FIXED for text that is
  // still auto-width (`textAutoResize: WIDTH_AND_HEIGHT`) when the
  // text sits in a free-positioned frame. Treat the text auto-resize
  // field as authoritative for labels so tiny browser/Figma font
  // metric drift cannot wrap "Sign Up" into two lines.
  if (node.textAutoResize === 'WIDTH_AND_HEIGHT') return 'hug'
  return node.width
}

/**
 * Translate one axis of a Figma sizing field. When the modern
 * `layoutSizing*` value is present we honor it directly:
 *   - 'FILL'  → 'fill' (stretch to parent's available space)
 *   - 'HUG'   → 'hug'  (size to content)
 *   - 'FIXED' → captured pixel size
 *
 * When it's missing (older plugin captures), we fall through to the
 * caller's legacy fallback expression.
 */
function resolveAxis(
  modern: 'FIXED' | 'HUG' | 'FILL' | undefined,
  capturedPx: number,
  legacyFallback: SizeAxis,
): SizeAxis {
  if (modern === 'FILL') return 'fill'
  if (modern === 'HUG') return 'hug'
  if (modern === 'FIXED') return capturedPx
  return legacyFallback
}
