// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'

/**
 * Boolean toggle. Currently rendered as a native checkbox styled to
 * match the Inspector. Upgrades to a proper iOS-style switch in a
 * later pass — keeping it native for accessibility in v1.
 */
export function CheckboxField({
  value,
  onCommit,
  mixed = false,
}: {
  value: boolean
  onCommit: (next: boolean) => void
  mixed?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = mixed
  }, [mixed])

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={mixed ? false : value}
      aria-checked={mixed ? 'mixed' : value}
      onChange={(e) => onCommit(e.target.checked)}
      className="h-4 w-4 cursor-pointer accent-accent"
    />
  )
}
