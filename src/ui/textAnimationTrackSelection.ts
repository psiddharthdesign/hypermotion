// SPDX-License-Identifier: Apache-2.0

import type { Track } from '@/scene'

/**
 * Resolve the semantic text clip a preset edit should target.
 *
 * A selected timeline track is always explicit. Without that selection, only
 * a clip under the playhead is editable; a lone clip elsewhere must not be
 * reused because applying a preset there is an authoring request for a new
 * clip at the current time.
 */
export function selectTextAnimationTrackForAuthoring(
  tracks: readonly Track[],
  trackFilter?: ReadonlySet<string>,
  playhead?: number,
): Track | null {
  const textTracks = tracks.filter(
    (track) =>
      track.propertyId === 'text.progress' && track.keyframes.length >= 2,
  )
  if (trackFilter) {
    const selected = textTracks.find((track) => trackFilter.has(track.id))
    if (selected) return selected
  }
  if (playhead !== undefined) {
    return (
      textTracks.find((track) => trackContainsTime(track, playhead)) ?? null
    )
  }
  return textTracks[0] ?? null
}

function trackContainsTime(track: Track, time: number): boolean {
  const times = track.keyframes.map((keyframe) => keyframe.time)
  const start = Math.min(...times)
  const end = Math.max(...times)
  return time >= start - 0.01 && time <= end + 0.01
}
