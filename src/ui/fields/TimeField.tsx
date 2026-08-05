// SPDX-License-Identifier: Apache-2.0

import { NumberField, type NumberFieldProps } from './NumberField'
import {
  formatTimeValue,
  parseTimeValueDraft,
  type TimeValueUnit,
} from './timeValue'

export interface TimeFieldProps
  extends Omit<NumberFieldProps, 'parseValue' | 'formatValue' | 'suffix'> {
  /** Unit used by the caller's numeric value. Bare drafts use this unit. */
  valueUnit?: TimeValueUnit
  /** Visible suffix; defaults to s or ms from valueUnit. */
  suffix?: string
}

/**
 * Duration-aware NumberField.
 *
 * Bare values remain in the configured value unit. Explicit `ms`, `s`, `m`,
 * and `h` expressions are converted on commit, so `2m` becomes 120 seconds
 * in a seconds field and `2s` becomes 2000 in a milliseconds field.
 */
export function TimeField({
  valueUnit = 'seconds',
  suffix = valueUnit === 'milliseconds' ? 'ms' : 's',
  ...props
}: TimeFieldProps) {
  const parseValue =
    valueUnit === 'milliseconds' ? parseMilliseconds : parseSeconds
  const formatValue =
    valueUnit === 'milliseconds' ? formatMilliseconds : formatSeconds

  return (
    <NumberField
      {...props}
      suffix={suffix}
      parseValue={parseValue}
      formatValue={formatValue}
      formatDisplayValue={formatValue}
    />
  )
}

const parseSeconds = (draft: string) => parseTimeValueDraft(draft, 'seconds')
const parseMilliseconds = (draft: string) =>
  parseTimeValueDraft(draft, 'milliseconds')
const formatSeconds = (value: number) => formatTimeValue(value, 'seconds')
const formatMilliseconds = (value: number) =>
  formatTimeValue(value, 'milliseconds')
