// SPDX-License-Identifier: Apache-2.0

import type { CompositionScene, SequenceItem } from '@/sequence'

type HeadlessSequenceScene = Pick<CompositionScene, 'id' | 'workArea'>
type HeadlessSequenceItem = Pick<
  SequenceItem,
  | 'sceneId'
  | 'masterAudioMuted'
  | 'trimStart'
  | 'duration'
  | 'holdDuration'
>

/**
 * Decide whether a headless export needs the Master timeline renderer.
 *
 * A one-occurrence project can normally use the simpler Scene renderer, but
 * only when the occurrence is semantically identical to its authored scene.
 * Work areas and occurrence-level Master-audio muting are resolved exclusively
 * by the sequence pipeline, just like trims, explicit durations, and holds.
 */
export function shouldRenderHeadlessSequence(
  sequenceItems: readonly HeadlessSequenceItem[],
  scenes: readonly HeadlessSequenceScene[],
): boolean {
  if (sequenceItems.length > 1) return true

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]))
  return sequenceItems.some((item) => {
    const scene = sceneById.get(item.sceneId)
    return (
      scene?.workArea !== undefined ||
      item.masterAudioMuted === true ||
      (item.trimStart ?? 0) > 0 ||
      item.duration !== undefined ||
      (item.holdDuration ?? 0) > 0
    )
  })
}
