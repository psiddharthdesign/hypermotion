// SPDX-License-Identifier: Apache-2.0

import NumberFlow, { type NumberFlowProps } from '@number-flow/react'

export interface NumberReadoutProps {
  value: number
  className?: string
  format?: NumberFlowProps['format']
  prefix?: string
  suffix?: string
  trend?: NumberFlowProps['trend']
  animated?: boolean
  isolate?: boolean
}

/**
 * Animated numeric text for low-frequency, read-only UI values.
 *
 * Keep editable fields, playhead values, and other continuously changing
 * readouts on their immediate code paths so animation never delays editing.
 */
export function NumberReadout({
  value,
  className = '',
  format,
  prefix,
  suffix,
  trend = 0,
  animated = true,
  isolate = true,
}: NumberReadoutProps) {
  return (
    <NumberFlow
      value={value}
      format={format}
      prefix={prefix}
      suffix={suffix}
      trend={trend}
      animated={animated}
      isolate={isolate}
      respectMotionPreference
      willChange={false}
      transformTiming={{
        duration: 220,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      }}
      spinTiming={{
        duration: 220,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      }}
      opacityTiming={{ duration: 140, easing: 'ease-out' }}
      className={['tabular-nums', className].filter(Boolean).join(' ')}
    />
  )
}
