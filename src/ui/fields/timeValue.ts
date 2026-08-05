// SPDX-License-Identifier: Apache-2.0

import { parseTimeExpression, formatTimeSeconds } from './timeExpression'
import { formatNumericValue, parseNumericExpression } from './numericExpression'

export type TimeValueUnit = 'seconds' | 'milliseconds'

/** Parse a TimeField draft into its caller-facing value unit. */
export function parseTimeValueDraft(
  text: string,
  valueUnit: TimeValueUnit,
): number | null {
  const hasAuthoredUnit = /[a-z]/i.test(text)
  if (!hasAuthoredUnit) {
    const bare = parseNumericExpression(text)
    return bare !== null && bare >= 0 ? bare : null
  }

  const seconds = parseTimeExpression(text)
  if (seconds === null) return null
  return valueUnit === 'milliseconds' ? seconds * 1000 : seconds
}

export function formatTimeValue(
  value: number,
  valueUnit: TimeValueUnit,
): string {
  if (!Number.isFinite(value) || value < 0) return ''
  return valueUnit === 'seconds'
    ? formatTimeSeconds(value)
    : formatNumericValue(value)
}
