// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'

/**
 * The Inspector's single field grammar from the reference panel:
 * a quiet label line above the value, with an optional fixed keyframe column.
 *
 * Keyframeable rows share the same value / 28px action guide. Static rows use
 * the full width instead of carrying a blank action column. Compound controls
 * intentionally span the full second line.
 */
export function FieldRow({
  label,
  children,
  keyframe,
  reserveAction = false,
  layout = 'inline',
}: {
  label: string
  children: ReactNode
  keyframe?: ReactNode
  /** Keep the 28px action guide aligned even when this row is static. */
  reserveAction?: boolean
  /** Wide compound controls span value + action while keeping the label grid. */
  layout?: 'inline' | 'compound'
}) {
  const hasActionColumn = (keyframe || reserveAction) && layout !== 'compound'
  return (
    <div
      data-inspector-row="1"
      className={[
        'grid min-h-7 min-w-0 items-center gap-x-2 gap-y-1',
        hasActionColumn
          ? 'grid-cols-[minmax(0,1fr)_28px]'
          : 'grid-cols-1',
      ].join(' ')}
    >
      <span
        className={[
          'min-w-0 break-words pr-1 text-[10px] leading-4 text-text-muted',
          hasActionColumn ? 'col-span-2' : '',
        ].join(' ')}
      >
        {label}
      </span>
      <div
        data-inspector-value="1"
        className="hm-inspector-value flex min-w-0 items-center gap-1.5"
      >
        {children}
      </div>
      {hasActionColumn ? (
        <div
          data-inspector-keyframe={keyframe ? '1' : undefined}
          data-inspector-action="1"
          aria-hidden={keyframe ? undefined : true}
          className="flex h-7 w-7 items-center justify-center"
        >
          {keyframe}
        </div>
      ) : null}
    </div>
  )
}
