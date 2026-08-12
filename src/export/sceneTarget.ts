// SPDX-License-Identifier: Apache-2.0

import type { CompositionScene, SequenceTimeMap } from '@/sequence'
import { resolveSceneExportOccurrence } from './audioMix'

export interface SceneExportTarget {
  composition: CompositionScene
  selectedSequenceItemId?: string
}

/**
 * Resolve a composition export independently from the editor's current scene.
 * Occurrence identity is secondary: it only chooses the Master-audio window
 * borrowed by a repeated composition.
 */
export function resolveSceneExportTarget(input: {
  scenes: readonly CompositionScene[]
  sequenceTimeMap: SequenceTimeMap
  requestedCompositionSceneId?: string
  activeCompositionSceneId?: string | null
  selectedSequenceItemId?: string
}): SceneExportTarget | null {
  const compositionSceneId =
    input.requestedCompositionSceneId ?? input.activeCompositionSceneId
  if (!compositionSceneId) return null

  const composition = input.scenes.find(
    (candidate) => candidate.id === compositionSceneId,
  )
  if (!composition) return null

  const occurrence = resolveSceneExportOccurrence(
    input.sequenceTimeMap,
    input.selectedSequenceItemId,
    composition.id,
  )
  return {
    composition,
    ...(occurrence ? { selectedSequenceItemId: occurrence.item.id } : {}),
  }
}
