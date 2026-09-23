// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI } from '@/scene/doc'
import type { TextNode } from '@/scene/types'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { deriveTextAnimationTiming, normalizeTextAnimation, textAnimationDefaults, type TextAnimationConfig } from './textAnimations'
import { addKeyframe, findTrack, ensureTrack } from './tracks'

/** Edits update an existing track, or create one when Auto Key is enabled. */
export function setTextShimmerAnimatedValue(
  api: SceneAPI,
  id: string,
  field: 'duration' | 'shimmerWidth',
  rawValue: number,
  time: number,
  recording: boolean,
): void {
  const node = api.getNode(id)
  if (node?.kind !== 'text' || node.locked || !readTextShimmer(api, node) || !Number.isFinite(rawValue)) return
  const value = field === 'duration'
    ? Math.max(0.05, rawValue)
    : Math.max(0.02, Math.min(1, rawValue))
  const propertyId = `textShimmer.${field}` as const
  api.doc.transact(() => {
    setTextShimmer(api, id, { [field]: value }, time)
    if (recording || findTrack(api, id, propertyId)) {
      addKeyframe(api, id, propertyId, time, value)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
}

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

/** The first and last keys are the effect's visible window, in scene seconds. */
export function readTextShimmerRange(api: SceneAPI, id: string): { start: number; end: number } | null {
  const keys = findTrack(api, id, 'textShimmer.range')?.keyframes
  if (!keys?.length) return null
  return { start: Math.min(...keys.map(key => key.time)), end: Math.max(...keys.map(key => key.time)) }
}

export function setTextShimmerRange(api: SceneAPI, id: string, start: number, end: number): string | null {
  const node = api.getNode(id)
  if (node?.kind !== 'text' || node.locked || !readTextShimmer(api, node) || !Number.isFinite(start) || !Number.isFinite(end)) return null
  const meta = api.getMeta()
  const frame = 1 / Math.max(1, meta.frameRate)
  start = Math.max(0, Math.min(meta.duration - frame, start))
  end = Math.max(start + frame, Math.min(meta.duration, end))
  let idResult: string | null = null
  api.doc.transact(() => {
    setTextShimmer(api, id, { startTime: start, duration: end - start, shimmerLoop: false })
    const durationTrack = findTrack(api, id, 'textShimmer.duration')
    if (durationTrack) api.deleteTrack(durationTrack.id)
    const track = ensureTrack(api, id, 'textShimmer.range', 'linear')
    const keys = [...track.keyframes].sort((a, b) => a.time - b.time)
    api.setTrack({ ...track, keyframes: [
      { id: keys[0]?.id ?? crypto.randomUUID(), time: start, value: 0 },
      { id: keys.length > 1 ? keys[keys.length - 1]!.id : crypto.randomUUID(), time: end, value: 1 },
    ] })
    idResult = track.id
  }, UNDOABLE_GESTURE_ORIGIN)
  return idResult
}

/** Stamp one endpoint at the playhead; keep at least one frame in the window. */
export function setTextShimmerEndpoint(api: SceneAPI, id: string, endpoint: 'start' | 'end', time: number): void {
  const node = api.getNode(id)
  if (node?.kind !== 'text' || node.locked || !Number.isFinite(time)) return
  const config = readTextShimmer(api, node)
  if (!config) return
  const meta = api.getMeta()
  const frame = 1 / Math.max(1, meta.frameRate)
  const range = readTextShimmerRange(api, id) ?? { start: config.startTime, end: meta.duration }
  if (endpoint === 'start') {
    const start = Math.max(0, Math.min(meta.duration - frame, time))
    setTextShimmerRange(api, id, start, Math.max(range.end, start + frame))
  } else {
    const end = Math.max(frame, Math.min(meta.duration, time))
    setTextShimmerRange(api, id, Math.min(range.start, end - frame), end)
  }
}
