// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'

/**
 * Mutations on the Y.Doc-backed `uiState` slab.
 *
 * The slab carries timeline grouping state — track groups,
 * keyframe groups, and the per-group collapsed flag. It used to live
 * in Zustand, which meant `Y.UndoManager` ignored grouping changes
 * and Cmd+Z silently no-op'd them. Routing every mutation through
 * `api.setUiState(...)` puts them inside a `doc.transact`, which the
 * UndoManager captures alongside scene edits.
 *
 * Each helper reads the latest slab via `api.getUiState()` (which is
 * a defensive plain-object copy), computes the next shape, and calls
 * `setUiState` with a partial patch. The transaction guarantees the
 * write is one atomic undo step.
 */

/** Bundle the given track ids into a new track group. Auto-collapsed
 * — the whole point of grouping is to clean up the timeline. */
export function groupTracks(api: SceneAPI, trackIds: string[]): void {
  if (trackIds.length < 2) return
  const ui = api.getUiState()
  const ids = new Set(trackIds)
  const next: typeof ui.trackGroups = {}
  // Pull these track ids out of any prior groups — a track belongs
  // to at most one group at a time.
  for (const [gid, g] of Object.entries(ui.trackGroups)) {
    const filtered = g.trackIds.filter((t) => !ids.has(t))
    if (filtered.length >= 2) next[gid] = { ...g, trackIds: filtered }
  }
  const newId = `tg_${Math.random().toString(36).slice(2, 9)}`
  next[newId] = { trackIds: [...trackIds], collapsed: true }
  api.setUiState({ trackGroups: next })
}

/**
 * Push tracks INTO an existing track group. Used when the user wants
 * to expand a group rather than create a new one — for example,
 * dragging a keyframe set onto a group's span bar, or right-clicking
 * the bar and picking "Add selected tracks to this group".
 *
 * Semantics:
 *   - If the target group doesn't exist, this is a no-op (the user
 *     probably just dissolved it concurrently).
 *   - Tracks already in OTHER groups are silently moved. A track
 *     belongs to at most one group at a time, same as `groupTracks`.
 *   - Tracks already in the target group are no-ops (idempotent).
 *   - The order is preserved: existing members first, then new
 *     additions in the order the caller passed them.
 *   - Other groups that are emptied below 2 members by the move are
 *     dropped, matching the invariant `groupTracks` enforces.
 */
export function addTracksToGroup(
  api: SceneAPI,
  groupId: string,
  trackIds: string[],
): void {
  const ui = api.getUiState()
  const target = ui.trackGroups[groupId]
  if (!target) return
  const incoming = new Set(trackIds)
  // Pull each incoming track out of any prior group so it lands in
  // exactly one place. Drop any group that ends up below 2 members.
  const next: typeof ui.trackGroups = {}
  for (const [gid, g] of Object.entries(ui.trackGroups)) {
    if (gid === groupId) continue // we'll rewrite the target last
    const filtered = g.trackIds.filter((t) => !incoming.has(t))
    if (filtered.length >= 2) next[gid] = { ...g, trackIds: filtered }
  }
  // Build the target's new track list: keep existing members,
  // append new ones in caller-provided order, dedupe.
  const seen = new Set(target.trackIds)
  const merged = [...target.trackIds]
  for (const tid of trackIds) {
    if (!seen.has(tid)) {
      merged.push(tid)
      seen.add(tid)
    }
  }
  next[groupId] = { ...target, trackIds: merged }
  api.setUiState({ trackGroups: next })
}

/** Dissolve every track group that contains any of these track ids. */
export function ungroupTracks(api: SceneAPI, trackIds: string[]): void {
  const ui = api.getUiState()
  const ids = new Set(trackIds)
  const next: typeof ui.trackGroups = {}
  for (const [gid, g] of Object.entries(ui.trackGroups)) {
    const overlaps = g.trackIds.some((t) => ids.has(t))
    if (!overlaps) next[gid] = g
  }
  api.setUiState({ trackGroups: next })
}

/** Flip a track group's collapsed flag. */
export function toggleTrackGroupCollapsed(
  api: SceneAPI,
  groupId: string,
): void {
  const ui = api.getUiState()
  const g = ui.trackGroups[groupId]
  if (!g) return
  api.setUiState({
    trackGroups: {
      ...ui.trackGroups,
      [groupId]: { ...g, collapsed: !g.collapsed },
    },
  })
}

/** Bundle the given keyframe keys into a new kf group. Auto-collapsed. */
export function groupKeyframes(api: SceneAPI, keys: string[]): void {
  if (keys.length < 2) return
  const ui = api.getUiState()
  const set = new Set(keys)
  const next: typeof ui.kfGroups = {}
  for (const [gid, members] of Object.entries(ui.kfGroups)) {
    const filtered = members.filter((k) => !set.has(k))
    if (filtered.length >= 2) next[gid] = filtered
  }
  const newId = `g_${Math.random().toString(36).slice(2, 9)}`
  next[newId] = [...keys]
  api.setUiState({
    kfGroups: next,
    kfGroupCollapsed: { ...ui.kfGroupCollapsed, [newId]: true },
  })
}

/** Dissolve every kf group that contains any of these keys. */
export function ungroupKeyframes(api: SceneAPI, keys: string[]): void {
  const ui = api.getUiState()
  const set = new Set(keys)
  const nextGroups: typeof ui.kfGroups = {}
  const nextCollapsed: typeof ui.kfGroupCollapsed = {}
  for (const [gid, members] of Object.entries(ui.kfGroups)) {
    const overlaps = members.some((k) => set.has(k))
    if (!overlaps) {
      nextGroups[gid] = members
      if (ui.kfGroupCollapsed[gid]) nextCollapsed[gid] = true
    }
  }
  api.setUiState({
    kfGroups: nextGroups,
    kfGroupCollapsed: nextCollapsed,
  })
}

/** Dissolve keyframe groups by id. Useful when the UI is rendering the
 * group itself, rather than acting from a keyframe selection. */
export function ungroupKeyframeGroups(
  api: SceneAPI,
  groupIds: string[],
): void {
  const ui = api.getUiState()
  const ids = new Set(groupIds)
  const nextGroups: typeof ui.kfGroups = {}
  const nextCollapsed: typeof ui.kfGroupCollapsed = {}
  for (const [gid, members] of Object.entries(ui.kfGroups)) {
    if (ids.has(gid)) continue
    nextGroups[gid] = members
    if (ui.kfGroupCollapsed[gid]) nextCollapsed[gid] = true
  }
  api.setUiState({
    kfGroups: nextGroups,
    kfGroupCollapsed: nextCollapsed,
  })
}

/** Flip a keyframe group's collapsed flag. */
export function toggleKfGroupCollapsed(
  api: SceneAPI,
  groupId: string,
): void {
  const ui = api.getUiState()
  api.setUiState({
    kfGroupCollapsed: {
      ...ui.kfGroupCollapsed,
      [groupId]: !ui.kfGroupCollapsed[groupId],
    },
  })
}
