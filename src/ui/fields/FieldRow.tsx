// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'

/**
 * Standard three-column Inspector row: optional keyframe indicator, label,
 * and field.
 *
 * Kept as its own component so every field (Number/Text/Select/...) gets
 * consistent spacing, label styling, and focus-within highlight without
 * each field re-rolling its own wrapper.
 *
 * Layout columns (left → right):
 *   1. `keyframe` — a tiny (~16px) slot for the Inspector's keyframe
 *      toggle diamond. Always reserved so every row aligns whether or
 *      not it carries a button; fields that aren't animatable just
 *      leave the slot empty.
 *   2. label     — the property name.
 *   3. children  — the actual field(s). Anything fits here — one input,
 *      a segmented control, a row of four padding cells.
 *
 * Voice (Framer-leaning): label is text-text-muted at 12px, sitting in a
 * 72px column. Field column is `flex-1` so multi-cell layouts (Width +
 * unit dropdown) get the full remaining width.
 */
export function FieldRow({
  label,
  children,
  keyframe,
}: {
  label: string
  children: ReactNode
  keyframe?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-4 shrink-0 items-center justify-center">
        {keyframe}
      </div>
      <span className="w-[72px] shrink-0 text-[12px] text-text-muted">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {children}
      </div>
    </div>
  )
}