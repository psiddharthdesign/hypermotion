// SPDX-License-Identifier: Apache-2.0

import type { Size, TextNode } from '@/scene'
import { figmaToFill } from './fillMap'
import { isGoogleFont } from '@/ui/fonts/googleFonts'
import type { FigmaCapturedText } from './types'

/**
 * Map a Figma text node to a partial TextNode for createNode().
 *
 * `text/color/fontFamily/fontSize/fontWeight/lineHeight/letterSpacing/
 * textAlign` flow through directly. The imported text box is pinned to
 * Figma's captured pixel dimensions. Figma has already resolved HUG,
 * FILL, mixed runs, and its exact font metrics; asking the browser and
 * Yoga to resolve those modes again can produce a different box while
 * a web font is loading, which then wraps labels that are single-line
 * in Figma. Keeping the captured box makes clipboard import a snapshot
 * of the authored frame instead of a responsive reinterpretation.
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
    width: node.width,
    height: node.height,
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
    fontStyle: node.fontStyle === 'italic' ? 'italic' : 'normal',
    lineHeight: lineHeightRatio,
    letterSpacing: node.letterSpacingPx,
    textAlign:
      node.textAlignHorizontal === 'LEFT'
        ? 'start'
        : node.textAlignHorizontal === 'RIGHT'
          ? 'end'
          : node.textAlignHorizontal === 'JUSTIFIED'
            ? 'justify'
            : 'center',
    textAlignVertical:
      node.textAlignVertical === 'CENTER'
        ? 'center'
        : node.textAlignVertical === 'BOTTOM'
          ? 'bottom'
          : 'top',
    textCase: mapTextCase(node.textCase),
    textDecoration:
      node.textDecoration === 'UNDERLINE'
        ? 'underline'
        : node.textDecoration === 'STRIKETHROUGH'
          ? 'strikethrough'
          : 'none',
    color,
    size,
  }
}

function mapTextCase(value: FigmaCapturedText['textCase']): TextNode['textCase'] {
  switch (value) {
    case 'UPPER':
      return 'upper'
    case 'LOWER':
      return 'lower'
    case 'TITLE':
      return 'title'
    case 'SMALL_CAPS':
      return 'small-caps'
    case 'SMALL_CAPS_FORCED':
      return 'small-caps-forced'
    case 'ORIGINAL':
    default:
      return 'original'
  }
}
