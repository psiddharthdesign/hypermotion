// SPDX-License-Identifier: Apache-2.0

/**
 * Parse a user-authored duration into seconds.
 *
 * Bare numbers are seconds. A number may instead be followed by a seconds,
 * milliseconds, minutes, or hours unit (with or without whitespace). The grammar is kept
 * deliberately small so a malformed draft never silently becomes a different
 * duration.
 */
export function parseTimeExpression(input: string): number | null {
  const match = input.match(
    /^\s*\+?(\d+(?:\.\d*)?|\.\d+)\s*(ms|msec|msecs|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?\s*$/i,
  )
  if (!match) return null

  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) return null

  const multiplier = unitMultiplier(match[2])
  const seconds = value * multiplier
  return Number.isFinite(seconds) ? seconds : null
}

/**
 * Format seconds as an editable, unitless number.
 *
 * Keeping the canonical draft in seconds means a field can render its own
 * `s` suffix without changing units after commit. `String(number)` preserves
 * the shortest round-trippable decimal representation; exponential notation
 * is expanded because the input grammar intentionally accepts plain decimals
 * only.
 */
export function formatTimeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (Object.is(seconds, -0)) return '0'

  const text = String(seconds)
  return /e/i.test(text) ? expandExponential(text) : text
}

function unitMultiplier(unit: string | undefined): number {
  if (!unit) return 1

  switch (unit.toLowerCase()) {
    case 'ms':
    case 'msec':
    case 'msecs':
    case 'millisecond':
    case 'milliseconds':
      return 0.001
    case 'm':
    case 'min':
    case 'mins':
    case 'minute':
    case 'minutes':
      return 60
    case 'h':
    case 'hr':
    case 'hrs':
    case 'hour':
    case 'hours':
      return 60 * 60
    default:
      return 1
  }
}

/** Expand a finite, non-negative exponential number to plain decimal text. */
function expandExponential(input: string): string {
  const [coefficient, exponentText] = input.toLowerCase().split('e')
  const exponent = Number(exponentText)
  const [integer, fraction = ''] = coefficient!.split('.')
  const digits = `${integer}${fraction}`
  const decimalPosition = integer!.length + exponent

  if (decimalPosition <= 0) {
    return `0.${'0'.repeat(-decimalPosition)}${digits}`
  }
  if (decimalPosition >= digits.length) {
    return `${digits}${'0'.repeat(decimalPosition - digits.length)}`
  }
  return `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`
}
