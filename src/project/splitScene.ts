// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { CompositionScene, SequenceItem } from '@/sequence'
import { resolveProgramCamera } from '@/sequence'

/** Resolve a cut on a source frame, leaving at least one frame on each side. */
export function sceneSplitTime(duration: number, time: number, frameRate: number): number | null {
  if (!Number.isFinite(time) || !Number.isFinite(duration)) return null
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 60
  const frame = Math.round(time * fps)
  if (frame < 1 || frame >= Math.round(duration * fps)) return null
  return frame / fps
}

export interface SplitSceneResult {
  before: CompositionScene
  after: CompositionScene
  sequenceItemId: string
  time: number
}

/**
 * Retain off-canvas keyframes so a split through a bezier or spring keeps the
 * exact original curve. Shifting both endpoints preserves interpolation;
 * sampling a new endpoint would change the shape of the remaining motion.
 */
export function rebaseSceneNodes(api: SceneAPI, nodeIds: Set<string>, offset: number): void {
  for (const id of nodeIds) {
    const node = api.getNode(id)
    if (!node) continue
    if (node.kind === 'video' || node.kind === 'audio') {
      // A signed start preserves source trims, looping phase, endpoint holds,
      // beat grids and playback rate without rewriting the source media.
      api.setNodeProperty(id, 'startTime', node.startTime - offset)
    }
    if (node.kind === 'shader' || node.kind === 'camera' || node.appearance.effects.some(e => e.kind === 'border-beam')) {
      api.setNodeProperty(id, 'proceduralTimeOffset', (node.proceduralTimeOffset ?? 0) + offset)
    }
    if (node.kind === 'text' && node.textShimmer) {
      api.setNodeProperty(id, 'textShimmer', { ...node.textShimmer, startTime: node.textShimmer.startTime - offset })
    }
    if (node.kind === 'text' && node.textAnimation) {
      api.setNodeProperty(id, 'textAnimation', {
        ...node.textAnimation, startTime: node.textAnimation.startTime - offset,
      })
    }
    for (const track of api.getTracksForNode(id)) {
      api.setTrack({
        ...track,
        ...(track.textAnimation ? { textAnimation: {
          ...track.textAnimation, startTime: track.textAnimation.startTime - offset,
        } } : {}),
        keyframes: track.keyframes.map((key) => ({ ...key, time: key.time - offset })),
      })
    }
  }
}

export function sliceComposition(api: SceneAPI, source: CompositionScene, start: number, end: number): CompositionScene {
  const next: CompositionScene = {
    ...source,
    duration: end - start,
    defaultCameraId: resolveProgramCamera({
      scene: source,
      localTime: start,
      cameras: source.cameraIds.map((id) => ({ id, enabled: api.getNode(id)?.visible !== false })),
      frameRate: api.getMeta().frameRate,
    }).cameraId,
    cameraCuts: Object.fromEntries(Object.values(source.cameraCuts)
      .filter((cut) => cut.time >= start && cut.time < end)
      .map((cut) => [cut.id, { ...cut, time: cut.time - start }])),
  }
  delete next.workArea
  if (source.workArea) {
    const from = Math.max(start, source.workArea.start)
    const to = Math.min(end, source.workArea.end)
    if (to > from && (from > start || to < end)) {
      next.workArea = { start: from - start, end: to - start }
    }
  }
  return next
}

/** Split each occurrence's authored source window, preserving its settings. */
export function splitOccurrence(item: SequenceItem, source: CompositionScene, rightSceneId: string, time: number): SequenceItem[] {
  const start = Math.max(source.workArea?.start ?? 0, item.trimStart ?? 0)
  const end = Math.min(source.workArea?.end ?? source.duration,
    (item.trimStart ?? 0) + (item.duration ?? source.duration))
  if (end <= time) return [{ ...item, trimStart: start, duration: Math.max(0, end - start) }]
  if (start >= time) return [{ ...item, sceneId: rightSceneId, trimStart: start - time, duration: Math.max(0, end - start) }]
  return [
    { ...item, trimStart: start, duration: time - start, holdDuration: 0, transitionOut: { kind: 'cut', duration: 0 } },
    { ...item, id: `item_${crypto.randomUUID()}`, sceneId: rightSceneId, trimStart: 0, duration: end - time },
  ]
}
