// SPDX-License-Identifier: Apache-2.0

import type { SequenceTimeMap } from '@/sequence'

export interface ScenePlaybackRange {
  start: number
  end: number
}

/**
 * The selected occurrence is the Scene transport's program window.
 *
 * A composition may appear repeatedly with different trims, so composition id
 * alone is not enough. Requiring both ids also prevents a stale selection from
 * constraining the newly activated composition during collaborative updates.
 */
export function selectedOccurrencePlaybackRange(
  timeMap: SequenceTimeMap,
  selectedSequenceItemId: string | null,
  activeCompositionId: string | null,
): ScenePlaybackRange | null {
  if (!selectedSequenceItemId || !activeCompositionId) return null
  const occurrence = timeMap.items.find(
    (candidate) => candidate.item.id === selectedSequenceItemId,
  )
  if (
    !occurrence ||
    occurrence.scene.id !== activeCompositionId ||
    occurrence.sourceEnd <= occurrence.sourceStart
  ) {
    return null
  }
  return {
    start: occurrence.sourceStart,
    end: occurrence.sourceEnd,
  }
}
