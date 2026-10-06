// SPDX-License-Identifier: Apache-2.0

/** Shift extends a key selection; Cmd/Ctrl toggles a complete key bundle. */
export function extendKeyframeSelection(
  previous: Iterable<string>,
  keys: Iterable<string>,
  shift: boolean,
): Set<string> {
  const next = new Set(previous)
  const members = [...keys]
  if (!shift && members.length > 0 && members.every(key => next.has(key))) {
    for (const key of members) next.delete(key)
  } else {
    for (const key of members) next.add(key)
  }
  return next
}
