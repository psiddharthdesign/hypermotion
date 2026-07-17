// SPDX-License-Identifier: Apache-2.0

import type { TextCase, TextNode } from './types'

/**
 * Resolve the characters a renderer must measure and paint while preserving
 * the authored value on the TextNode. CSS handles the same transformation in
 * the DOM renderer; canvas-based renderers need the transformed string.
 */
export function resolveTextCase(text: string, textCase: TextCase = 'original'): string {
  switch (textCase) {
    case 'upper':
      return text.toLocaleUpperCase()
    case 'lower':
      return text.toLocaleLowerCase()
    case 'title':
      return text.replace(/(^|[\s\p{P}])(\p{L})/gu, (_match, prefix: string, letter: string) =>
        `${prefix}${letter.toLocaleUpperCase()}`,
      )
    case 'small-caps':
    case 'small-caps-forced':
    case 'original':
    default:
      return text
  }
}

export function displayedText(node: Pick<TextNode, 'text' | 'textCase'>): string {
  return resolveTextCase(node.text, node.textCase ?? 'original')
}
