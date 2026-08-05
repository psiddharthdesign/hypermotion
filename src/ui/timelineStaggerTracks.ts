// SPDX-License-Identifier: Apache-2.0

import type { Track } from '@/scene'

export interface TimelineStaggerTrackMember {
  trackId: string
  kfId: string
  nodeId: string
}

export interface TimelineStaggerTrackSet {
  sourceNodeId: string
  active: boolean
  expanded: boolean
  members: readonly TimelineStaggerTrackMember[]
}

/**
 * Resolve only the stagger-owned keyframes that should be hidden from normal
 * property rows.
 *
 * A collapsed inactive stagger owns its member keys through the overview row,
 * but it must not swallow loose keys that happen to share the same track.
 * While editing a collapsed stagger, the source layer is the editable proxy,
 * so its owned keys remain beside any loose keys on that property row. Follower
 * rows still expose their loose keys while their owned keys remain represented
 * by the proxy. Expanded staggers expose every member track unchanged.
 *
 * Keyframe ids are unioned per track so overlapping collapsed relationships
 * cannot accidentally reveal a key hidden by another relationship.
 */
export function hiddenStaggerKeyframeIdsByTrack(
  sets: readonly TimelineStaggerTrackSet[],
): Map<string, Set<string>> {
  const hidden = new Map<string, Set<string>>()

  for (const set of sets) {
    if (set.expanded) continue
    for (const member of set.members) {
      if (set.active && member.nodeId === set.sourceNodeId) continue
      const ids = hidden.get(member.trackId) ?? new Set<string>()
      ids.add(member.kfId)
      hidden.set(member.trackId, ids)
    }
  }

  return hidden
}

/**
 * Return the normal property-row view of a track after stagger-owned keys have
 * been removed. The track disappears only when every one of its keys is owned
 * by a collapsed stagger; mixed tracks remain as a single property row.
 */
export function filterTimelineTrackByHiddenStaggerKeyframes(
  track: Track,
  hiddenIdsByTrack: ReadonlyMap<string, ReadonlySet<string>>,
): Track | null {
  const hiddenIds = hiddenIdsByTrack.get(track.id)
  if (!hiddenIds || hiddenIds.size === 0) return track

  const keyframes = track.keyframes.filter(
    (keyframe) => !hiddenIds.has(keyframe.id),
  )
  if (keyframes.length === 0) return null
  if (keyframes.length === track.keyframes.length) return track
  return { ...track, keyframes }
}
