// SPDX-License-Identifier: Apache-2.0

export interface TextStyleSource {
  characters: string
  fontName: unknown
  fontSize: unknown
  lineHeight: unknown
  letterSpacing: unknown
  getRangeFontName(start: number, end: number): unknown
  getRangeFontSize(start: number, end: number): unknown
  getRangeLineHeight(start: number, end: number): unknown
  getRangeLetterSpacing(start: number, end: number): unknown
}

export interface FirstTextStyle {
  fontName: FontName
  fontSize: number
  lineHeight: LineHeight
  letterSpacing: LetterSpacing
}

/** Read a representative text style without asking Figma for an empty range. */
export function readFirstTextStyle(node: TextStyleSource): FirstTextStyle {
  const hasCharacters = node.characters.length > 0
  const fontName = hasCharacters
    ? node.getRangeFontName(0, 1)
    : node.fontName
  const fontSize = hasCharacters
    ? node.getRangeFontSize(0, 1)
    : node.fontSize
  const lineHeight = hasCharacters
    ? node.getRangeLineHeight(0, 1)
    : node.lineHeight
  const letterSpacing = hasCharacters
    ? node.getRangeLetterSpacing(0, 1)
    : node.letterSpacing

  return {
    fontName: isFontName(fontName)
      ? fontName
      : { family: 'Inter', style: 'Regular' },
    fontSize: typeof fontSize === 'number' ? fontSize : 14,
    lineHeight: isLineHeight(lineHeight) ? lineHeight : { unit: 'AUTO' },
    letterSpacing: isLetterSpacing(letterSpacing)
      ? letterSpacing
      : { unit: 'PIXELS', value: 0 },
  }
}

function isFontName(value: unknown): value is FontName {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Partial<FontName>).family === 'string' &&
    typeof (value as Partial<FontName>).style === 'string'
  )
}

function isLineHeight(value: unknown): value is LineHeight {
  if (!value || typeof value !== 'object') return false
  const unit = (value as { unit?: unknown }).unit
  return (
    unit === 'AUTO' ||
    ((unit === 'PIXELS' || unit === 'PERCENT') &&
      typeof (value as { value?: unknown }).value === 'number')
  )
}

function isLetterSpacing(value: unknown): value is LetterSpacing {
  if (!value || typeof value !== 'object') return false
  const unit = (value as { unit?: unknown }).unit
  return (
    (unit === 'PIXELS' || unit === 'PERCENT') &&
    typeof (value as { value?: unknown }).value === 'number'
  )
}
