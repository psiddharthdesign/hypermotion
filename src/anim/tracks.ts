// SPDX-License-Identifier: Apache-2.0

import type {
  EasingKind,
  Keyframe,
  KeyframeId,
  KeyframeValue,
  NodeId,
  PropertyId,
  Track,
  TrackId,
} from '@/scene'
import type { SceneAPI } from '@/scene/doc'

/**
 * Track-level helpers on top of `SceneAPI.setTrack / deleteTrack`.
 *
 * Tracks are keyed by `(nodeId, propertyId)` from the UI's point of view —
 * a node has at most one track per property. This helper layer hides
 * the TrackId generation + lookup from callers so the timeline UI and
 * preset library can say "add a keyframe on this node/property at this
 * time" without worrying about whether a track already exists.
 */

export function listTracksForNode(api: SceneAPI, nodeId: NodeId): Track[] {
  return api.getTracksForNode(nodeId)
}

export function findTrack(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
): Track | null {
  return (
    api.getTracksForNode(nodeId).find((t) => t.propertyId === propertyId) ??
    null
  )
}

export function ensureTrack(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
  defaultEasing: EasingKind = 'ease-in-out',
): Track {
  const existing = findTrack(api, nodeId, propertyId)
  if (existing) return existing
  const track: Track = {
    id: genId(),
    nodeId,
    propertyId,
    keyframes: [],
    defaultEasing,
  }
  api.setTrack(track)
  return track
}

export function removeTrack(api: SceneAPI, trackId: TrackId): void {
  const track = api.getTrack(trackId)
  api.deleteTrack(trackId)
  if (track?.propertyId === 'text.progress') {
    api.setNodeProperty(track.nodeId, 'textAnimation', null)
  }
}

/**
 * Add a keyframe on (node, property) at time `t`. Creates the track if
 * it doesn't exist. If a keyframe already exists at time `t` (within
 * epsilon), its value is replaced rather than a duplicate appended.
 *
 * `presetOrigin` tags the keyframe as produced by an IN/OUT preset so
 * that reapplying the same direction's preset can clean up the old
 * stamp without touching hand-authored keyframes. Leave it off for any
 * direct user action (Inspector button, timeline drag) so user-stamped
 * work is never eligible for auto-pruning.
 */
export function addKeyframe(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
  time: number,
  value: KeyframeValue,
  easingOut?: EasingKind,
  presetOrigin?: 'in' | 'out',
): Keyframe {
  const track = ensureTrack(api, nodeId, propertyId)
  const kfs = [...track.keyframes]
  // 10 ms — generous enough to catch playhead float-drift (frame * spf
  // can produce values like 0.23333334 vs the keyframe's 0.23333333),
  // tight enough to keep intentional adjacent keyframes distinct.
  // Standard motion-tool authoring puts keyframes more than ~30ms apart.
  const epsilon = 0.01
  const existingIdx = kfs.findIndex((k) => Math.abs(k.time - time) < epsilon)
  const kf: Keyframe = {
    id: existingIdx >= 0 ? kfs[existingIdx]!.id : genId(),
    time,
    value,
    ...(easingOut ? { easingOut } : {}),
    ...(presetOrigin ? { presetOrigin } : {}),
  }
  if (existingIdx >= 0) kfs[existingIdx] = kf
  else {
    kfs.push(kf)
    kfs.sort((a, b) => a.time - b.time)
  }
  api.setTrack({ ...track, keyframes: kfs })
  return kf
}

/**
 * Strip every keyframe whose `presetOrigin === direction` from every
 * track on `nodeId`. Tracks that go empty after the strip are deleted.
 * Used by `applyPreset` to make "apply another IN preset" behave like
 * replacement instead of stacking — the user thinks of IN / OUT as
 * single slots, not as a layer list.
 *
 * Hand-authored keyframes (no presetOrigin) are untouched even when
 * they live on the same tracks: a user who hand-tweaked the fade-in's
 * opacity midpoint shouldn't lose that midpoint to a preset re-apply.
 */
export function clearPresetKeyframes(
  api: SceneAPI,
  nodeId: NodeId,
  direction: 'in' | 'out',
): void {
  const tracks = api.getTracksForNode(nodeId)
  for (const track of tracks) {
    const kept = track.keyframes.filter((k) => k.presetOrigin !== direction)
    if (kept.length === track.keyframes.length) continue
    if (kept.length === 0) {
      api.deleteTrack(track.id)
    } else {
      api.setTrack({ ...track, keyframes: kept })
    }
  }
}

export function removeKeyframe(
  api: SceneAPI,
  trackId: TrackId,
  kfId: KeyframeId,
): void {
  const track = api.getTrack(trackId)
  if (!track) return
  const kfs = track.keyframes.filter((k) => k.id !== kfId)
  if (
    kfs.length === 0 ||
    (track.propertyId === 'text.progress' && kfs.length < 2)
  ) {
    // Empty track is dead weight. Text animations need a start and end
    // progress keyframe; with fewer than two, the effect is inactive.
    api.deleteTrack(trackId)
    if (track.propertyId === 'text.progress') {
      api.setNodeProperty(track.nodeId, 'textAnimation', null)
    }
  } else {
    api.setTrack({ ...track, keyframes: kfs })
  }
}

export function moveKeyframe(
  api: SceneAPI,
  trackId: TrackId,
  kfId: KeyframeId,
  nextTime: number,
): void {
  const track = api.getTrack(trackId)
  if (!track) return
  const kfs = track.keyframes
    .map((k) => (k.id === kfId ? { ...k, time: Math.max(0, nextTime) } : k))
    .sort((a, b) => a.time - b.time)
  api.setTrack({ ...track, keyframes: kfs })
}

/**
 * Find the keyframe on (node, property) closest to `time` within
 * `tolerance` seconds, if any. Used by the Inspector's keyframe indicator
 * to answer "is there a keyframe at the playhead?" — the tolerance is
 * generous enough to catch a keyframe a fraction of a frame away, so
 * minor float drift in the playhead doesn't desync the button's state
 * from the track.
 */
export function findKeyframeAt(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
  time: number,
  tolerance = 0.02,
): Keyframe | null {
  const track = findTrack(api, nodeId, propertyId)
  if (!track) return null
  for (const k of track.keyframes) {
    if (Math.abs(k.time - time) <= tolerance) return k
  }
  return null
}

/**
 * Toggle the presence of a keyframe on (node, property) at `time`.
 *
 *   - If one already exists within `tolerance`, it's removed.
 *   - Otherwise a new keyframe is stamped with `currentValue` at `time`.
 *
 * This is the Inspector-button interaction: click once to record this
 * value at the playhead, click again to un-record. Returns what
 * happened so callers can animate the button accordingly if they want.
 *
 * If the track goes empty after the removal, `removeKeyframe` cleans
 * up the dead-weight track — matching what the timeline's alt-delete
 * behavior does.
 */
export function toggleKeyframe(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
  time: number,
  currentValue: KeyframeValue,
  tolerance = 0.02,
): 'added' | 'removed' {
  const existingTrack = findTrack(api, nodeId, propertyId)
  if (existingTrack) {
    const kf = existingTrack.keyframes.find(
      (k) => Math.abs(k.time - time) <= tolerance,
    )
    if (kf) {
      removeKeyframe(api, existingTrack.id, kf.id)
      return 'removed'
    }
  }
  addKeyframe(api, nodeId, propertyId, time, currentValue)
  return 'added'
}

function genId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}
