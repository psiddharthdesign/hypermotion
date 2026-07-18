// SPDX-License-Identifier: Apache-2.0

import type { EasingKind, Track } from '@/scene/types'
import type { SceneAPI } from '@/scene/doc'

/** Convert every supported easing shape to graph-editable bezier controls. */
export function graphBezierCoords(
  easing: EasingKind | undefined,
): [number, number, number, number] {
  const presets: Record<string, [number, number, number, number]> = {
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
    linear: [0, 0, 1, 1],
  }
  if (!easing) return presets['ease-in-out']!
  if (typeof easing === 'string') return presets[easing] ?? presets.linear!
  if ('bezier' in easing) return easing.bezier
  // Spring preview matches the animation engine's current graph fallback.
  return presets['ease-out']!
}

/** Resolve a single numeric track from the timeline's keyframe selection. */
export function describeGraphTarget(
  api: SceneAPI,
  selectedKeys: string[],
): { track: Track; keyframes: Track['keyframes'] } | null {
  if (selectedKeys.length === 0) return null
  let trackId: string | null = null
  for (const key of selectedKeys) {
    const separator = key.indexOf(':')
    if (separator < 0) return null
    const candidateTrackId = key.slice(0, separator)
    if (trackId === null) trackId = candidateTrackId
    else if (trackId !== candidateTrackId) return null
  }
  if (!trackId) return null
  const track = api.getTrack(trackId)
  if (!track) return null
  if (!track.keyframes.every((keyframe) => typeof keyframe.value === 'number')) {
    return null
  }
  if (track.keyframes.length < 2) return null
  return { track, keyframes: track.keyframes }
}

/**
 * Fit the value graph to both keyframe endpoints and easing handles.
 * Endpoint-only bounds clipped overshoot curves at roughly 100%; including
 * control values exposes the full 200-strength curve without changing data.
 */
export function graphValueBounds(track: Track): { min: number; max: number } {
  const values = track.keyframes
    .map((keyframe) => keyframe.value)
    .filter((value): value is number => typeof value === 'number')
  if (values.length === 0) return { min: -1, max: 1 }

  const candidates = [...values]
  for (let index = 0; index < track.keyframes.length - 1; index++) {
    const start = track.keyframes[index]!
    const end = track.keyframes[index + 1]!
    if (typeof start.value !== 'number' || typeof end.value !== 'number') {
      continue
    }
    const [, y1, , y2] = graphBezierCoords(
      start.easingOut ?? track.defaultEasing,
    )
    const delta = end.value - start.value
    candidates.push(start.value + y1 * delta, start.value + y2 * delta)
  }

  const rawMin = Math.min(...candidates)
  const rawMax = Math.max(...candidates)
  const rawSpan = rawMax - rawMin
  if (rawSpan < 1e-3) return { min: rawMin - 1, max: rawMax + 1 }
  const padding = rawSpan * 0.15
  return { min: rawMin - padding, max: rawMax + padding }
}
