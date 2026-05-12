// SPDX-License-Identifier: Apache-2.0

/**
 * Native <select> styled to match the rest of the Inspector.
 *
 * Kept as a native element (not a popover) on purpose — native selects
 * are accessible, keyboard-driven, and cross-platform without any
 * library weight. We can swap to a custom popover later if design
 * pushes for a consistent look with dark menus, but this is fine for v1.
 *
 * Accepts either flat options or grouped options. Grouped options render
 * as native <optgroup>s, which is the right shape for the font picker
 * (System / Google Sans / Google Serif / …).
 */

type FlatOption<T extends string> = T | { value: T; label: string }
type Group<T extends string> = {
  /** `label` is shown by the browser as the section header. */
  label: string
  options: Array<{ value: T; label: string }>
}

export function SelectField<T extends string>({
  value,
  options,
  groups,
  onCommit,
  width = 'w-24',
}: {
  value: T
  options?: readonly FlatOption<T>[]
  /**
   * Alternative to `options` — render as <optgroup>s. If both are
   * provided, `options` wins; the call-site should only pass one.
   */
  groups?: readonly Group<T>[]
  onCommit: (next: T) => void
  width?: string
}) {
  // Framer-style: solid dark fill, no border, accent ring on focus.
  // Native chevron from the OS still sits at the right edge.
  const className = [
    width,
    'cursor-pointer h-7 rounded-md bg-app-bg pl-2 pr-1 text-[12px] text-text outline-none',
    'ring-1 ring-transparent transition-shadow',
    'hover:ring-border focus:ring-2 focus:ring-accent/45',
  ].join(' ')
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value as T)}
      className={className}
    >
      {options
        ? normalize(options).map((o) => (
            <option key={o.value} value={o.value} className="bg-panel text-text">
              {o.label}
            </option>
          ))
        : (groups ?? []).map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value} className="bg-panel text-text">
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
    </select>
  )
}

function normalize<T extends string>(
  options: readonly FlatOption<T>[],
): Array<{ value: T; label: string }> {
  return options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  )
}