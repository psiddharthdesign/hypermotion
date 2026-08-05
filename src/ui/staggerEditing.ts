// SPDX-License-Identifier: Apache-2.0

import { resolveStaggerSetSourceNodeId } from '@/anim/staggerSets'
import type { SceneAPI } from '@/scene/doc'
import type { NodeId } from '@/scene'
import { useUI } from '@/state/ui'

/** Enter relationship-safe edit mode and reveal its first-starting member. */
export function activateStaggerSetForEditing(
  api: SceneAPI,
  setId: string,
): NodeId | null {
  const set = api.getUiState().staggerSets[setId]
  const sourceNodeId = resolveStaggerSetSourceNodeId(api, set)
  if (!set || !sourceNodeId) return null

  const ui = useUI.getState()
  ui.activateStaggerSet(setId, set.delay)
  ui.setSelection([sourceNodeId])
  ui.setSelectedTrackIds([])
  ui.setSelectedTrackId(null)
  ui.setSelectedKeyframes([])
  return sourceNodeId
}

/**
 * Toggle S editing without trapping an active relationship in an empty layer
 * selection. An exact source selection means "exit"; any other active state
 * restores the source controls instead.
 */
export function toggleStaggerSetEditing(
  api: SceneAPI,
  setId: string,
): 'activated' | 'deactivated' | 'unavailable' {
  const set = api.getUiState().staggerSets[setId]
  const sourceNodeId = resolveStaggerSetSourceNodeId(api, set)
  if (!set || !sourceNodeId) return 'unavailable'

  const ui = useUI.getState()
  const sourceIsSelected =
    ui.selection.length === 1 && ui.selection[0] === sourceNodeId
  if (
    ui.staggerOn &&
    ui.activeStaggerSetId === setId &&
    sourceIsSelected
  ) {
    ui.setStaggerOn(false)
    return 'deactivated'
  }

  activateStaggerSetForEditing(api, setId)
  return 'activated'
}
