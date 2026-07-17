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
  animate: boolean
  order: number
  /** Number of displayed characters before this segment on its visual line. */
  trackingIndex: number
  /** Displayed character count on the visual line containing this segment. */
  lineCharacterCount: number
  /** Keeps animated tracking centred/right-aligned like the authored text. */
  trackingAlignment: 0 | 0.5 | 1
}

type MeasureText = (text: string) => number

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
  measure,
}: {
  text: string
  applyTo: Exclude<TextAnimationApplyTo, 'layer'>
  x: number
  y: number
  maxWidth: number
  lineHeightPx: number
  align: TextAlign
  measure: MeasureText
}): CanvasTextAnimationSegment[] {
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

    if (applyTo === 'lines') {
      const animate = line.text.length > 0
      segments.push({
        text: line.text,
        x: lineX,
        y: y + lineIndex * lineHeightPx,
        width: lineWidth,
        animate,
        order: animate ? order++ : order,
        trackingIndex: 0,
        lineCharacterCount,
        trackingAlignment,
      })
      return
    }

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
      const width = Math.max(0, measure(prefix + part) - prefixWidth)
      const whitespace = /^\s+$/.test(part)
      const animate = !whitespace && part.length > 0
      segments.push({
        text: part,
        x: lineX + prefixWidth + justifyOffset,
        y: y + lineIndex * lineHeightPx,
        width,
        animate,
        order: animate ? order++ : order,
        trackingIndex,
        lineCharacterCount,
        trackingAlignment,
      })
      prefix += part
      if (whitespace) justifyOffset += extraPerWhitespace
    }
  })

  return segments
}
