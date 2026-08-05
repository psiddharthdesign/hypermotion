// SPDX-License-Identifier: Apache-2.0

import type { TextAnimationApplyTo } from '@/anim/textAnimations'
import type { TextAlign } from '@/scene'

export interface CanvasTextLine {
  text: string
  canJustify: boolean
}

export interface CanvasTextAnimationSegment {
  text: string
  x: number
  y: number
  width: number
  height: number
  animate: boolean
  order: number
  /** Number of displayed characters before this segment on its visual line. */
  trackingIndex: number
  /** Displayed character count on the visual line containing this segment. */
  lineCharacterCount: number
  /** Keeps animated tracking centred/right-aligned like the authored text. */
  trackingAlignment: 0 | 0.5 | 1
  /** Visual line whose glyph/word centres share one spatial motion rail. */
  visualLineIndex: number
}

type MeasureText = (text: string) => number

/**
 * Return glyph origins whose right edge follows the measured width of each
 * progressively longer run. Canvas does not apply kerning between separate
 * fillText() calls, so adding isolated glyph advances drifts beyond the width
 * returned by measureText() and can clip the last glyph in an atlas cell.
 */
export function trackedGlyphOffsets(
  text: string,
  tracking: number,
  measure: MeasureText,
): number[] {
  const offsets: number[] = []
  let prefix = ''
  Array.from(text).forEach((character, index) => {
    prefix += character
    offsets.push(
      measure(prefix) -
        measure(character) +
        (Number.isFinite(tracking) ? index * tracking : 0),
    )
  })
  return offsets
}

/**
 * Greedy line breaking shared by static and animated Canvas2D text.
 * Keeping one implementation is important: animated words/glyphs must inherit
 * the exact same visual lines as the unanimated text instead of doing a second,
 * subtly different wrap pass.
 */
export function layoutCanvasTextLines(
  text: string,
  maxWidth: number,
  measure: MeasureText,
): CanvasTextLine[] {
  const lines: CanvasTextLine[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push({ text: '', canJustify: false })
      continue
    }
    const paragraphLines: string[] = []
    const tokens = paragraph.split(/(\s+)/)
    let line = ''
    for (const token of tokens) {
      const candidate = line + token
      if (measure(candidate) <= maxWidth || line === '') {
        line = candidate
      } else {
        paragraphLines.push(line.trimEnd())
        line = token.trimStart()
      }
    }
    paragraphLines.push(line.trimEnd())
    paragraphLines.forEach((value, index) => {
      lines.push({
        text: value,
        canJustify:
          index < paragraphLines.length - 1 && /\S\s+\S/.test(value),
      })
    })
  }
  return lines.length > 0 ? lines : [{ text: '', canJustify: false }]
}

/**
 * Place text-animation segments on the already-resolved visual lines.
 *
 * The old renderer laid animated segments from x=0 and only reacted to source
 * newlines. That meant centre/right aligned text jumped left as soon as an
 * effect was applied, and wrapped text collapsed into overlapping rows. This
 * function derives every segment from the same line boxes, alignment and
 * justification used by the static painter.
 */
export function layoutCanvasTextAnimationSegments({
  text,
  applyTo,
  x,
  y,
  maxWidth,
  lineHeightPx,
  align,
  tracking = 0,
  measure,
}: {
  text: string
  applyTo: Exclude<TextAnimationApplyTo, 'layer'>
  x: number
  y: number
  maxWidth: number
  lineHeightPx: number
  align: TextAlign
  /** Letter spacing already included by `measure`, in canvas pixels. */
  tracking?: number
  measure: MeasureText
}): CanvasTextAnimationSegment[] {
  const resolvedTracking = Number.isFinite(tracking) ? tracking : 0
  if (applyTo === 'lines') {
    const segments: CanvasTextAnimationSegment[] = []
    let visualLineIndex = 0
    let order = 0
    for (const authoredLine of text.split('\n')) {
      const wrappedLines = layoutCanvasTextLines(
        authoredLine,
        maxWidth,
        measure,
      )
      const animate = authoredLine.length > 0
      const authoredOrder = animate ? order++ : order
      const wrappedWidth = Math.max(
        0,
        ...wrappedLines.map((line) => measure(line.text)),
      )
      const groupWidth =
        wrappedLines.length > 1 ? maxWidth : Math.min(maxWidth, wrappedWidth)
      const groupX =
        align === 'center'
          ? x + Math.max(0, (maxWidth - groupWidth) / 2)
          : align === 'end'
            ? x + Math.max(0, maxWidth - groupWidth)
            : x
      segments.push({
        text: authoredLine,
        x: groupX,
        y: y + visualLineIndex * lineHeightPx,
        width: groupWidth,
        height: wrappedLines.length * lineHeightPx,
        animate,
        // One authored line owns one quad even when it wraps visually. Its
        // transform origin, Scramble seed, and timing then match the DOM span.
        order: authoredOrder,
        trackingIndex: 0,
        lineCharacterCount: Array.from(authoredLine).length,
        trackingAlignment:
          align === 'center' ? 0.5 : align === 'end' ? 1 : 0,
        visualLineIndex,
      })
      visualLineIndex += wrappedLines.length
    }
    return segments
  }

  const lines = layoutCanvasTextLines(text, maxWidth, measure)
  const segments: CanvasTextAnimationSegment[] = []
  let order = 0

  lines.forEach((line, lineIndex) => {
    const lineWidth = measure(line.text)
    const lineX =
      align === 'center'
        ? x + Math.max(0, (maxWidth - lineWidth) / 2)
        : align === 'end'
          ? x + Math.max(0, maxWidth - lineWidth)
          : x
    const trackingAlignment: 0 | 0.5 | 1 =
      align === 'center' ? 0.5 : align === 'end' ? 1 : 0
    const lineCharacterCount = Array.from(line.text).length

    const rawSegments =
      applyTo === 'words' ? line.text.split(/(\s+)/) : Array.from(line.text)
    const whitespaceCount = line.canJustify
      ? rawSegments.filter((part) => /^\s+$/.test(part)).length
      : 0
    const extraPerWhitespace =
      whitespaceCount > 0
        ? Math.max(0, maxWidth - lineWidth) / whitespaceCount
        : 0
    let prefix = ''
    let justifyOffset = 0

    for (const part of rawSegments) {
      if (part === '') continue
      const prefixWidth = measure(prefix)
      const trackingIndex = Array.from(prefix).length
      // measure(prefix) contains only the gaps *inside* the prefix. The gap
      // between prefix and part belongs before this segment, not inside its
      // atlas cell. Moving it from width to x keeps tracked segments from
      // overlapping while preserving their measured right edge.
      const boundaryTracking = trackingIndex > 0 ? resolvedTracking : 0
      const width = Math.max(
        0,
        measure(prefix + part) - prefixWidth - boundaryTracking,
      )
      const whitespace = /^\s+$/.test(part)
      const animate = !whitespace && part.length > 0
      segments.push({
        text: part,
        x: lineX + prefixWidth + boundaryTracking + justifyOffset,
        y: y + lineIndex * lineHeightPx,
        width,
        height: lineHeightPx,
        animate,
        order: animate ? order++ : order,
        trackingIndex,
        lineCharacterCount,
        trackingAlignment,
        visualLineIndex: lineIndex,
      })
      prefix += part
      if (whitespace) justifyOffset += extraPerWhitespace
    }
  })

  return segments
}
