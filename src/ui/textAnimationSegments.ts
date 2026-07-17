// SPDX-License-Identifier: Apache-2.0

import type { TextAnimationApplyTo } from '@/anim/textAnimations'

export interface DomTextAnimationSegment {
  text: string
  animate: boolean
  kind: 'inline' | 'line' | 'layer'
  breakAfter?: boolean
}

/**
 * DOM segmentation metadata. Newlines are represented as explicit breaks for
 * line effects instead of being left beside block spans, which previously
 * produced an extra line box and changed authored leading during animation.
 */
export function splitDomTextAnimationSegments(
  text: string,
  applyTo: TextAnimationApplyTo,
): DomTextAnimationSegment[] {
  if (applyTo === 'layer') return [{ text, animate: true, kind: 'layer' }]
  if (applyTo === 'lines') {
    const lines = text.split('\n')
    return lines.map((line, index) => ({
      text: line,
      // Empty authored lines still need their line box, but carry no delay.
      animate: line.length > 0,
      kind: 'line',
      breakAfter: index < lines.length - 1,
    }))
  }
  if (applyTo === 'words') {
    return text.split(/(\s+)/).map((part) => ({
      text: part,
      animate: !/^\s+$/.test(part) && part.length > 0,
      kind: 'inline',
    }))
  }
  return Array.from(text).map((character) => ({
    text: character,
    animate: !/\s/.test(character),
    kind: 'inline',
  }))
}
