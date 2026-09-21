// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI } from '@/scene/doc'
import type { TextNode } from '@/scene/types'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { deriveTextAnimationTiming, normalizeTextAnimation, textAnimationDefaults, type TextAnimationConfig } from './textAnimations'

export function normalizeTextShimmer(value: unknown): TextAnimationConfig | null {
  const config = normalizeTextAnimation(value)
  return config?.id === 'shimmer' ? config : null
}

/** Explicit null disables Shimmer; absent fields preserve older project files. */
export function resolveTextShimmer(node: TextNode, animation?: TextAnimationConfig | null): TextAnimationConfig | null {
  if (node.textShimmer !== undefined) return node.textShimmer
  return normalizeTextShimmer(animation) ?? normalizeTextShimmer(node.textAnimation)
}

export function readTextShimmer(api: SceneAPI, node: TextNode): TextAnimationConfig | null {
  if (node.textShimmer !== undefined) return node.textShimmer
  const track = api.getTracksForNode(node.id).find(track => track.propertyId === 'text.progress' && track.textAnimation?.id === 'shimmer')
  return track
    ? deriveTextAnimationTiming(track.textAnimation ?? null, track, node.text)
    : resolveTextShimmer(node)
}

/** Detach legacy Shimmer tracks while preserving their authored sweep timing. */
export function migrateTextShimmer(api: SceneAPI, id: string): void {
  const node = api.getNode(id)
  if (node?.kind !== 'text') return
  const legacyTracks = api.getTracksForNode(id).filter(track => track.propertyId === 'text.progress' && track.textAnimation?.id === 'shimmer')
  if (node.textAnimation?.id !== 'shimmer' && !legacyTracks.length) return
  const config = readTextShimmer(api, node)
  api.doc.transact(() => {
    api.setNodeProperty(id, 'textShimmer', config)
    if (node.textAnimation?.id === 'shimmer') api.setNodeProperty(id, 'textAnimation', null)
    for (const track of legacyTracks) api.deleteTrack(track.id)
  }, UNDOABLE_GESTURE_ORIGIN)
}

export function setTextShimmer(api: SceneAPI, id: string, patch: Partial<TextAnimationConfig> | null, startTime = 0): void {
  const node = api.getNode(id)
  if (node?.kind !== 'text' || node.locked) return
  const previous = readTextShimmer(api, node)
  api.doc.transact(() => {
    migrateTextShimmer(api, id)
    api.setNodeProperty(id, 'textShimmer', patch === null ? null : normalizeTextShimmer({
      ...textAnimationDefaults('shimmer'), startTime, ...previous, ...patch, id: 'shimmer',
    }))
  }, UNDOABLE_GESTURE_ORIGIN)
}
