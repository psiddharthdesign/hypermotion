// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { Track } from '@/scene'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { isCursorInstance } from '@/scene/builtins/cursorComponent'

export interface CursorVariantKeyframeSelection {
  track: Track
  selectedKeyframeIds: string[]
  stateValues: string[]
  /** Null means the selected keyframes currently contain mixed states. */
  currentState: string | null
}

/**
 * Resolve a cursor State edit from the exact timeline keyframe selection.
 *
 * The editor is intentionally limited to one semantic `variant` track. This
 * prevents a single dropdown change from silently rewriting unrelated cursor
 * clips or other discrete properties selected elsewhere in the timeline.
 */
export function resolveCursorVariantKeyframeSelection(
  api: SceneAPI,
  selectedKeys: readonly string[],
): CursorVariantKeyframeSelection | null {
  if (selectedKeys.length === 0) return null

  let trackId: string | null = null
  const selectedKeyframeIds: string[] = []
  const seenKeyframeIds = new Set<string>()
  for (const key of selectedKeys) {
    const separator = key.indexOf(':')
    if (separator <= 0 || separator >= key.length - 1) return null
    const candidateTrackId = key.slice(0, separator)
    if (trackId === null) trackId = candidateTrackId
    else if (candidateTrackId !== trackId) return null

    const keyframeId = key.slice(separator + 1)
    if (!seenKeyframeIds.has(keyframeId)) {
      seenKeyframeIds.add(keyframeId)
      selectedKeyframeIds.push(keyframeId)
    }
  }
  if (!trackId) return null

  const track = api.getTrack(trackId)
  if (!track || track.propertyId !== 'variant') return null
  const instance = api.getNode(track.nodeId)
  if (!instance || instance.kind !== 'instance') return null
  if (!isCursorInstance(api, instance)) return null

  const component = api.getNode(instance.componentId)
  if (!component || component.kind !== 'component') return null
  const stateAxis = component.variants.find((axis) => axis.name === 'State')
  const stateValues = stateAxis?.values.filter(Boolean) ?? []
  if (stateValues.length === 0) return null

  const keyframes = selectedKeyframeIds.map((id) =>
    track.keyframes.find((keyframe) => keyframe.id === id),
  )
  if (keyframes.some((keyframe) => !keyframe)) return null

  const states = keyframes.map((keyframe) => {
    const value = keyframe!.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return typeof value.State === 'string' && stateValues.includes(value.State)
      ? value.State
      : null
  })
  const firstState = states[0] ?? null
  const currentState = states.every((state) => state === firstState)
    ? firstState
    : null

  return {
    track,
    selectedKeyframeIds,
    stateValues,
    currentState,
  }
}

/** Replace only the selected cursor State keyframe values in one undo step. */
export function setSelectedCursorVariantKeyframeState(
  api: SceneAPI,
  selectedKeys: readonly string[],
  state: string,
): number {
  const selection = resolveCursorVariantKeyframeSelection(api, selectedKeys)
  if (!selection || !selection.stateValues.includes(state)) return 0

  const selectedIds = new Set(selection.selectedKeyframeIds)
  let updatedCount = 0
  const keyframes = selection.track.keyframes.map((keyframe) => {
    if (!selectedIds.has(keyframe.id)) return keyframe
    const current = keyframe.value
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      current.State === state &&
      Object.keys(current).length === 1
    ) {
      return keyframe
    }
    updatedCount += 1
    return { ...keyframe, value: { State: state } }
  })
  if (updatedCount === 0) return 0

  api.doc.transact(() => {
    api.setTrack({ ...selection.track, keyframes })
  }, UNDOABLE_GESTURE_ORIGIN)
  return updatedCount
}
