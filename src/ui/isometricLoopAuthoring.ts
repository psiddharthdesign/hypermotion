// SPDX-License-Identifier: Apache-2.0

import type { NodeId, PropertyId, Track, Transform } from '@/scene/types'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { pruneStaggerMembershipForRemovedKeyframe } from '@/anim/staggerSets'

export interface IsometricLoopOptions {
  kind: 'float' | 'spin'
  startTime: number
  /** One complete cycle, in seconds. The endpoint is the next cycle's boundary. */
  duration: number
  /** Canvas units for Float. Spin always makes one complete turn. */
  amplitude?: number
  axis?: 'x' | 'y' | 'z'
  /** Explicitly replace the affected property track, preserving all others. */
  replaceExisting?: boolean
}

export type IsometricLoopResult =
  | { status: 'applied'; trackIds: string[]; start: number; end: number }
  | { status: 'conflict'; nodeIds: NodeId[]; message: string }
  | { status: 'invalid'; message: string }

/**
 * Stamp normal, editable keys. No private clock or procedural animation is
 * introduced: the same tracks drive preview, seeking, staggering, and export.
 * The final matching pose belongs at the exclusive cycle boundary, not one
 * frame before it, so a loop export never repeats its first pose twice.
 */
export function applyIsometricLoop(api: SceneAPI, nodeIds: readonly NodeId[], options: IsometricLoopOptions): IsometricLoopResult {
  const meta = api.getMeta()
  const fps = Math.max(1, Number.isFinite(meta.frameRate) ? meta.frameRate : 60)
  const start = Math.round(options.startTime * fps) / fps
  const end = Math.round((options.startTime + options.duration) * fps) / fps
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > meta.duration + 1e-8 || end - start < 4 / fps - 1e-8) {
    return { status: 'invalid', message: 'Choose a loop of at least four frames that fits inside the scene.' }
  }
  const amplitude = options.amplitude ?? 40
  if (!Number.isFinite(amplitude) || amplitude < 0) return { status: 'invalid', message: 'Float distance must be a positive number or zero.' }
  const axis = options.axis ?? 'z'
  const field: keyof Transform = options.kind === 'float' ? axis : axis === 'z' ? 'rotation' : axis === 'x' ? 'rotationX' : 'rotationY'
  const propertyId = `transform.${field}` as PropertyId
  const ids = [...new Set(nodeIds)]
  if (ids.length === 0) return { status: 'invalid', message: 'Select an asset to animate.' }
  const nodes = ids.map((id) => api.getNode(id))
  if (nodes.some((node) => !node || node.locked || node.id === api.getRoot() || node.kind === 'camera' || node.kind === 'audio')) {
    return { status: 'invalid', message: 'Choose unlocked visual layers or asset groups.' }
  }
  // Selecting a group and one of its descendants would apply the same motion
  // twice. Animate only the highest selected ancestor, as transform tools do.
  const selected = new Set(ids)
  const targets = nodes.filter((node) => {
    let parentId = node!.parent
    const visited = new Set<NodeId>()
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false
      visited.add(parentId)
      parentId = api.getNode(parentId)?.parent ?? null
    }
    return true
  })
  const conflicts = targets.filter((node) => api.getTracksForNode(node!.id).some((track) => track.propertyId === propertyId && track.keyframes.length > 0))
  if (conflicts.length > 0 && !options.replaceExisting) {
    return { status: 'conflict', nodeIds: conflicts.map((node) => node!.id), message: `Existing ${options.kind === 'float' ? axis.toUpperCase() : `Rotate ${axis.toUpperCase()}`} keyframes would be replaced. Choose another axis or explicitly replace this property's animation.` }
  }

  const trackIds: string[] = []
  api.doc.transact(() => {
    for (const target of targets) {
      const node = target!
      const previous = api.getTracksForNode(node.id).filter((track) => track.propertyId === propertyId)
      for (const track of previous) {
        for (const keyframe of track.keyframes) pruneStaggerMembershipForRemovedKeyframe(api, node.id, propertyId, keyframe.id)
        api.deleteTrack(track.id)
      }
      if (previous.some((track) => track.keyframes.length > 0)) {
        const removedKeys = new Set(previous.flatMap((track) => track.keyframes.map((keyframe) => `${track.id}:${keyframe.id}`)))
        const ui = api.getUiState()
        const kfGroups: typeof ui.kfGroups = {}
        const kfGroupCollapsed: typeof ui.kfGroupCollapsed = {}
        for (const [id, keys] of Object.entries(ui.kfGroups)) {
          const kept = keys.filter((key) => !removedKeys.has(key))
          if (kept.length < 2) continue
          kfGroups[id] = kept
          if (ui.kfGroupCollapsed[id]) kfGroupCollapsed[id] = true
        }
        api.setUiState({ kfGroups, kfGroupCollapsed })
      }
      const base = Number(node.transform[field]) || 0
      const values = options.kind === 'float'
        ? [{ time: start, value: base }, { time: (start + end) / 2, value: base - amplitude }, { time: end, value: base }]
        : [{ time: start, value: base }, { time: end, value: base + 360 }]
      const easing = options.kind === 'float' ? 'ease-in-out' : 'linear'
      const track: Track = {
        id: previous[0]?.id ?? crypto.randomUUID(),
        nodeId: node.id,
        propertyId,
        defaultEasing: easing,
        keyframes: values.map((keyframe) => ({ ...keyframe, id: crypto.randomUUID(), easingOut: easing })),
      }
      api.setTrack(track)
      trackIds.push(track.id)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
  return { status: 'applied', trackIds, start, end }
}
