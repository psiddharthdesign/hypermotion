// SPDX-License-Identifier: Apache-2.0

import type { KeyframeValue, NodeId, PropertyId, TrackId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import {
  addKeyframe,
  findKeyframeAt,
  findTrack,
  removeKeyframe,
} from './tracks'

export interface MultiKeyframeTarget {
  nodeId: NodeId
  currentValue: KeyframeValue
}

export interface MultiKeyframeSummary {
  targetCount: number
  trackCount: number
  atPlayheadCount: number
  state: 'none' | 'track' | 'partial' | 'at'
}

export interface MultiKeyframeToggleResult {
  action: 'added' | 'removed'
  trackIds: TrackId[]
}

/** Resolve the shared diamond state for one property across many layers. */
export function inspectMultiKeyframes(
  api: SceneAPI,
  targets: readonly MultiKeyframeTarget[],
  propertyId: PropertyId,
  time: number,
): MultiKeyframeSummary {
  let trackCount = 0
  let atPlayheadCount = 0
  for (const target of targets) {
    const track = findTrack(api, target.nodeId, propertyId)
    if (track?.keyframes.length) trackCount++
    if (findKeyframeAt(api, target.nodeId, propertyId, time)) {
      atPlayheadCount++
    }
  }

  const targetCount = targets.length
  const state =
    targetCount > 0 && atPlayheadCount === targetCount
      ? 'at'
      : atPlayheadCount > 0
        ? 'partial'
        : trackCount > 0
          ? 'track'
          : 'none'
  return { targetCount, trackCount, atPlayheadCount, state }
}

/**
 * Toggle one property for an entire layer selection as one document update.
 *
 * A mixed/partial selection always converges toward "keyframed everywhere";
 * it never removes some layers while adding others. Only an all-keyframed
 * selection removes the playhead keyframe from every layer.
 */
export function toggleMultiKeyframes(
  api: SceneAPI,
  targets: readonly MultiKeyframeTarget[],
  propertyId: PropertyId,
  time: number,
): MultiKeyframeToggleResult {
  const uniqueTargets = dedupeTargets(targets)
  const summary = inspectMultiKeyframes(api, uniqueTargets, propertyId, time)
  const action = summary.state === 'at' ? 'removed' : 'added'

  api.doc.transact(() => {
    for (const target of uniqueTargets) {
      if (action === 'added') {
        addKeyframe(
          api,
          target.nodeId,
          propertyId,
          time,
          target.currentValue,
        )
        continue
      }
      const track = findTrack(api, target.nodeId, propertyId)
      const keyframe = findKeyframeAt(
        api,
        target.nodeId,
        propertyId,
        time,
      )
      if (track && keyframe) removeKeyframe(api, track.id, keyframe.id)
    }
  }, 'multi-keyframe-toggle')

  const trackIds = uniqueTargets.flatMap((target) => {
    const track = findTrack(api, target.nodeId, propertyId)
    return track ? [track.id] : []
  })
  return { action, trackIds }
}

function dedupeTargets(
  targets: readonly MultiKeyframeTarget[],
): MultiKeyframeTarget[] {
  const byNode = new Map<NodeId, MultiKeyframeTarget>()
  for (const target of targets) byNode.set(target.nodeId, target)
  return [...byNode.values()]
}
