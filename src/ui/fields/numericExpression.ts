// SPDX-License-Identifier: Apache-2.0

/**
 * Format a finite number without throwing away authored decimal precision.
 * `String(number)` is JavaScript's shortest round-trippable representation,
 * unlike the old unconditional `toFixed(2)` display rounding.
 */
export function formatNumericValue(value: number): string {
  if (value == null || !Number.isFinite(value)) return ''
  return Object.is(value, -0) ? '0' : String(value)
}

/**
 * Compact read-only presentation for dense inspector fields. Editing still
 * uses `formatNumericValue`, so focusing a field reveals the exact authored
 * precision and does not round the stored value.
 */
export function formatNumericDisplayValue(value: number): string {
  if (value == null || !Number.isFinite(value)) return ''
  const rounded = Number(value.toFixed(2))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** Parse a finite numeric literal or a deliberately small math expression. */
export function parseNumericExpression(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  const direct = Number(trimmed)
  if (Number.isFinite(direct)) return direct
  if (!/^[\d+\-*/%().\s]+$/.test(trimmed)) return null

  try {
    // The whitelist above excludes identifiers, quotes, separators and member
    // access. It permits only arithmetic syntax designers expect in fields.
    const fn = new Function(`"use strict"; return (${trimmed})`) as () => unknown
    const result = fn()
    return typeof result === 'number' && Number.isFinite(result) ? result : null
  } catch {
    return null
  }
}

/** Remove floating-point noise introduced by repeated step/scrub additions. */
export function stabilizeNumericValue(value: number): number {
  if (!Number.isFinite(value)) return value
  return Number(value.toPrecision(14))
}
