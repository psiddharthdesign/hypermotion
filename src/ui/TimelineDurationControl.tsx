// SPDX-License-Identifier: Apache-2.0

import { TimeField } from '@/ui/fields/TimeField'

export interface TimelineDurationControlProps {
  duration: number
  onChange: (next: number) => void
  min?: number
  max?: number
  disabled?: boolean
  ariaLabel: string
  onScrubPreview?: (next: number) => void
  onScrubCommit?: (next: number) => void
  onScrubCancel?: () => void
}

/**
 * Shared Scene/Master duration editor.
 *
 * The caller owns timing semantics: Scene updates authored composition
 * duration, while Master resizes its final occurrence. This component keeps
 * their direct-manipulation grammar identical.
 */
export function TimelineDurationControl({
  duration,
  onChange,
  min = 0.1,
  max,
  disabled = false,
  ariaLabel,
  onScrubPreview,
  onScrubCommit,
  onScrubCancel,
}: TimelineDurationControlProps) {
  const clamp = (value: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, value))
  const nudge = (delta: number) => {
    const next = clamp(duration + delta)
    if (next !== duration) onChange(next)
  }
  const atMin = duration <= min
  const atMax = max !== undefined && duration >= max

  return (
    <div className="flex items-center gap-1" data-timeline-duration-control="1">
      <button
        type="button"
        disabled={disabled || atMin}
        onClick={() => nudge(-1)}
        className="flex h-6 w-6 items-center justify-center rounded text-text-muted enabled:hover:bg-panel enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        title="−1 second"
        aria-label={`Decrease ${ariaLabel} by 1 second`}
      >
        −
      </button>
      <TimeField
        value={duration}
        onCommit={(next) => onChange(clamp(next))}
        onScrubPreview={
          onScrubPreview ? (next) => onScrubPreview(clamp(next)) : undefined
        }
        onScrubCommit={
          onScrubCommit ? (next) => onScrubCommit(clamp(next)) : undefined
        }
        onScrubCancel={onScrubCancel}
        min={min}
        max={max}
        step={0.5}
        ariaLabel={ariaLabel}
        disabled={disabled}
        width="w-24"
      />
      <button
        type="button"
        disabled={disabled || atMax}
        onClick={() => nudge(1)}
        className="flex h-6 w-6 items-center justify-center rounded text-text-muted enabled:hover:bg-panel enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        title="+1 second"
        aria-label={`Increase ${ariaLabel} by 1 second`}
      >
        +
      </button>
    </div>
  )
}
