// SPDX-License-Identifier: Apache-2.0

import {
  resolveMasterTime,
  type SequenceTimeMap,
} from '@/sequence'
import type { PreviewScope } from '@/state/ui'
import { resolveMasterAudioGain } from './masterAudio'

const TIME_EPSILON = 1e-9

export interface SceneAudioOwnership {
  audioNodeId: string
  sceneId: string
}

export interface PreviewAudioContribution {
  /** Stable for the lifetime of this independently playing contribution. */
  key: string
  audioNodeId: string
  /** Time in the audio node's owning clock (Master or composition-local). */
  timelineTime: number
  /** Sequence/crossfade contribution in the inclusive range 0..1. */
  gain: number
  source: 'master' | 'scene-overlay'
  sequenceItemId: string | null
}

export interface ResolvePreviewAudioContributionsInput {
  previewScope: PreviewScope
  playhead: number
  timeMap: SequenceTimeMap
  selectedSequenceItemId: string | null
  activeCompositionId: string | null
  masterAudioNodeIds: readonly string[]
  sceneAudio: readonly SceneAudioOwnership[]
}

/**
 * Resolve every independently audible preview contribution.
 *
 * Master audio owns the Master clock. Scene preview borrows the selected
 * occurrence's Master window, while scene overlays remain composition-local.
 * During Master crossfades, overlays are instantiated once per occurrence so
 * repeated compositions and same-scene transitions retain independent clocks.
 */
export function resolvePreviewAudioContributions(
  input: ResolvePreviewAudioContributionsInput,
): PreviewAudioContribution[] {
  const playhead = Number.isFinite(input.playhead) ? input.playhead : 0

  if (input.previewScope === 'scene') {
    return resolveScenePreviewContributions(input, playhead)
  }

  const masterGain = resolveMasterAudioGain(input.timeMap, playhead)
  const contributions: PreviewAudioContribution[] =
    masterGain > TIME_EPSILON
      ? input.masterAudioNodeIds.map((audioNodeId) => ({
          key: `master:${audioNodeId}:sequence`,
          audioNodeId,
          timelineTime: playhead,
          gain: masterGain,
          source: 'master',
          sequenceItemId: null,
        }))
      : []

  const resolution = resolveMasterTime(input.timeMap, playhead, {
    clamp: true,
    quantize: 'none',
  })
  for (const layer of resolution.layers) {
    if (layer.weight <= TIME_EPSILON) continue
    for (const audio of input.sceneAudio) {
      if (audio.sceneId !== layer.item.scene.id) continue
      contributions.push({
        key: `scene:${audio.audioNodeId}:${layer.item.item.id}`,
        audioNodeId: audio.audioNodeId,
        timelineTime: layer.localTime,
        gain: clamp01(layer.weight),
        source: 'scene-overlay',
        sequenceItemId: layer.item.item.id,
      })
    }
  }
  return contributions
}

function resolveScenePreviewContributions(
  input: ResolvePreviewAudioContributionsInput,
  playhead: number,
): PreviewAudioContribution[] {
  const contributions: PreviewAudioContribution[] = []

  const activeSceneId = input.activeCompositionId
  if (activeSceneId) {
    for (const audio of input.sceneAudio) {
      if (audio.sceneId !== activeSceneId) continue
      contributions.push({
        key: `scene:${audio.audioNodeId}:editor`,
        audioNodeId: audio.audioNodeId,
        timelineTime: playhead,
        gain: 1,
        source: 'scene-overlay',
        sequenceItemId: input.selectedSequenceItemId,
      })
    }
  }

  if (!input.selectedSequenceItemId) return contributions
  const occurrence = input.timeMap.items.find(
    (candidate) => candidate.item.id === input.selectedSequenceItemId,
  )
  if (!occurrence) return contributions
  if (activeSceneId && occurrence.scene.id !== activeSceneId) {
    return contributions
  }
  if (
    playhead < occurrence.sourceStart - TIME_EPSILON ||
    playhead >= occurrence.sourceEnd - TIME_EPSILON ||
    occurrence.item.masterAudioMuted === true
  ) {
    return contributions
  }

  const masterTime =
    occurrence.masterStart + playhead - occurrence.sourceStart
  for (const audioNodeId of input.masterAudioNodeIds) {
    contributions.push({
      key: `master:${audioNodeId}:scene:${occurrence.item.id}`,
      audioNodeId,
      timelineTime: masterTime,
      gain: 1,
      source: 'master',
      sequenceItemId: occurrence.item.id,
    })
  }
  return contributions
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
