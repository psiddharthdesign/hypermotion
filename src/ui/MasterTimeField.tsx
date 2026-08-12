// SPDX-License-Identifier: Apache-2.0

import { TimeField } from '@/ui/fields/TimeField'

export interface MasterTimeFieldProps {
  value: number
  duration: number
  frameRate: number
  onChange: (next: number) => void
}

/** Exact sequence-time editor shown beside the Master transport. */
export function MasterTimeField({
  value,
  duration,
  frameRate,
  onChange,
}: MasterTimeFieldProps) {
  const safeDuration = Math.max(0, duration)
  const safeFrameRate = Math.max(1, frameRate)
  const safeValue = Math.max(0, Math.min(safeDuration, value))
  const lastFrame = Math.max(0, Math.round(safeDuration * safeFrameRate) - 1)
  const frame = Math.min(lastFrame, Math.round(safeValue * safeFrameRate))

  return (
    <div
      className="ml-1 flex shrink-0 items-center gap-1.5"
      data-master-time-field="1"
    >
      <TimeField
        value={safeValue}
        onCommit={onChange}
        min={0}
        max={safeDuration}
        step={1 / safeFrameRate}
        ariaLabel="Master time"
        width="w-20"
      />
      <span
        className="font-mono text-[9px] tabular-nums text-text-dim"
        aria-label={`Master frame ${frame}`}
      >
        f{frame}
      </span>
    </div>
  )
}
