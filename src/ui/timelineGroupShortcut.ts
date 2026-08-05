// SPDX-License-Identifier: Apache-2.0

export type TimelineGroupShortcutIntent =
  | { kind: 'none' }
  | { kind: 'keyframes'; keys: string[] }
  | { kind: 'tracks'; trackIds: string[] }

/**
 * Resolve which timeline model owns Cmd/Ctrl+G.
 *
 * Keyframes win because a keyframe click is the most specific timeline
 * gesture and track selection can legitimately remain in Zustand while a
 * local keyframe set is active. With no explicit timeline selection, the
 * event must continue to the canvas layer-group command.
 */
export function resolveTimelineGroupShortcutIntent(
  selectedTrackIds: readonly string[],
  selectedKeyframeKeys: ReadonlySet<string>,
): TimelineGroupShortcutIntent {
  if (selectedKeyframeKeys.size > 0) {
    return { kind: 'keyframes', keys: [...selectedKeyframeKeys] }
  }
  const trackIds = [...new Set(selectedTrackIds)]
  if (trackIds.length > 0) return { kind: 'tracks', trackIds }
  return { kind: 'none' }
}
