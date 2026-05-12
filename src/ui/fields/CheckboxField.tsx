// SPDX-License-Identifier: Apache-2.0

/**
 * Boolean toggle. Currently rendered as a native checkbox styled to
 * match the Inspector. Upgrades to a proper iOS-style switch in a
 * later pass — keeping it native for accessibility in v1.
 */
export function CheckboxField({
  value,
  onCommit,
}: {
  value: boolean
  onCommit: (next: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onCommit(e.target.checked)}
      className="h-4 w-4 cursor-pointer accent-accent"
    />
  )
}