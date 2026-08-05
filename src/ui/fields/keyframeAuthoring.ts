// SPDX-License-Identifier: Apache-2.0

import type {
  KeyframeValue,
  NodeId,
  PropertyId,
  TrackId,
} from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import {
  pruneStaggerMembershipForRemovedKeyframe,
  toggleDraftStaggerSetPropertyFromMember,
  toggleStaggerSetPropertyFromMember,
} from '@/anim/staggerSets'
import { findKeyframeAt, findTrack, toggleKeyframe } from '@/anim/tracks'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export interface InspectorKeyframeAuthoringState {
  staggerOn: boolean
  activeStaggerSetId: string | null
  staggerDraftLayerIds: readonly NodeId[]
  staggerDelay: number
}

export interface InspectorKeyframeAuthoringResult {
  action: 'added' | 'removed'
  trackIds: TrackId[]
  staggered: boolean
}

/**
 * Route a single Inspector diamond through the active stagger session.
 *
 * This decision must not depend on whether the property already belongs to
 * the set. The first and every later keyframe authored while S is active are
 * one relationship-wide bundle. With S off, the ordinary toggle still reuses
 * the same `(nodeId, propertyId)` track without joining the new key to the
 * stagger relationship.
 */
export function toggleInspectorPropertyKeyframe(
  api: SceneAPI,
  state: InspectorKeyframeAuthoringState,
  nodeId: NodeId,
  propertyId: PropertyId,
  time: number,
  currentValue: KeyframeValue,
): InspectorKeyframeAuthoringResult {
  if (state.staggerOn && state.activeStaggerSetId) {
    const set = api.getUiState().staggerSets[state.activeStaggerSetId]
    const staggerResult = set
      ? toggleStaggerSetPropertyFromMember(
          api,
          state.activeStaggerSetId,
          nodeId,
          propertyId,
          time,
          currentValue,
        )
      : state.staggerDraftLayerIds.length > 1 &&
          state.staggerDraftLayerIds.includes(nodeId)
        ? toggleDraftStaggerSetPropertyFromMember(
            api,
            {
              setId: state.activeStaggerSetId,
              layerIds: state.staggerDraftLayerIds,
              delay: state.staggerDelay,
              order: 'forward',
            },
            nodeId,
            propertyId,
            time,
            currentValue,
          )
        : null

    if (staggerResult) {
      return {
        action: staggerResult.action,
        trackIds: staggerResult.trackIds,
        staggered: true,
      }
    }
  }

  // Loose keys and stagger-owned keys deliberately share one property track.
  // Capture the id before toggling so only a deletion of an owned key prunes
  // the relationship; loose adds/removals remain independent.
  const existingKeyframe = findKeyframeAt(api, nodeId, propertyId, time)
  let action: 'added' | 'removed' = 'added'
  api.doc.transact(() => {
    action = toggleKeyframe(api, nodeId, propertyId, time, currentValue)
    if (action === 'removed' && existingKeyframe) {
      pruneStaggerMembershipForRemovedKeyframe(
        api,
        nodeId,
        propertyId,
        existingKeyframe.id,
      )
    }
  }, UNDOABLE_GESTURE_ORIGIN)
  const track = findTrack(api, nodeId, propertyId)
  return {
    action,
    trackIds: track ? [track.id] : [],
    staggered: false,
  }
}
