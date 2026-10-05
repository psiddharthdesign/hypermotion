// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { EasingKind, Keyframe, Track } from '@/scene/types'
import { propertyDescriptor } from '@/scene/props'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { patchStaggerKeyframeBundle, resolveStaggerKeyframeBundle, type StaggerKeyframePatch } from '@/anim/staggerSets'
import { deriveTextAnimationTiming } from '@/anim/textAnimations'
import { graphBezierCoords } from './graphEditorMath'
import { commitKeyframeTimes } from './keyframeDragPreviewStore'

export type GraphBezier = [number, number, number, number]
export interface GraphSegment {
  start: Keyframe & { value: number }
  end: Keyframe & { value: number }
  startSelected: boolean
  endSelected: boolean
}
export interface GraphKeyframeTarget { time: number; value: number }
export interface GraphDragOptions { frameRate?: number; duration?: number }

/** Numeric toggles and selectors have no continuous value curve to edit. */
export function isGraphEditableTrack(track: Track): boolean {
  const interpolation = propertyDescriptor(track.propertyId)?.interpolation
  return (interpolation === 'numeric' || interpolation === 'angle') &&
    track.keyframes.length > 0 && track.keyframes.every(key =>
      Number.isFinite(key.time) && typeof key.value === 'number' && Number.isFinite(key.value))
}

/** Timeline selection uses stable track:key IDs, never rendered array indices. */
export function graphSelectedKeyframeIds(track: Track, selectedKeys: readonly string[]): Set<string> {
  const keys = new Set(selectedKeys)
  return new Set(track.keyframes.filter(key => keys.has(`${track.id}:${key.id}`)).map(key => key.id))
}

function sortedKeys(track: Track): Keyframe[] {
  return track.keyframes.map((key, index) => ({ key, index }))
    .sort((a, b) => a.key.time - b.key.time || a.index - b.index).map(item => item.key)
}

/** Only the incoming/outgoing segments touching an exact selected key. */
export function selectedGraphSegments(track: Track, selectedKeys: readonly string[]): GraphSegment[] {
  if (!isGraphEditableTrack(track)) return []
  const selected = graphSelectedKeyframeIds(track, selectedKeys)
  const keys = sortedKeys(track)
  const result: GraphSegment[] = []
  for (let i = 0; i < keys.length - 1; i++) {
    const start = keys[i]! as GraphSegment['start'], end = keys[i + 1]! as GraphSegment['end']
    if (end.time <= start.time) continue
    const startSelected = selected.has(start.id), endSelected = selected.has(end.id)
    if (startSelected || endSelected) result.push({ start, end, startSelected, endSelected })
  }
  return result
}

/** The same straight easing, with handles clear of its endpoint diamonds. */
export function graphEditableBezierCoords(easing: EasingKind | undefined): GraphBezier {
  return !easing || easing === 'linear' ? [1 / 3, 1 / 3, 2 / 3, 2 / 3] : [...graphBezierCoords(easing)]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Pure drag planning. Preserve the selected stagger bundle's exact delays,
 * constraining its common time delta against every member's neighbors. Only
 * the dragged key snaps to the frame grid; fractional stagger delays survive.
 * Existing subframe/colliding keys remain value-editable when no legal frame
 * slot exists, but a drag never creates a collision or crosses a neighbor.
 */
export function graphKeyframeDragTarget(
  api: SceneAPI,
  trackId: string,
  keyframeId: string,
  request: GraphKeyframeTarget & GraphDragOptions,
): GraphKeyframeTarget | null {
  if (!Number.isFinite(request.time) || !Number.isFinite(request.value)) return null
  const track = api.getTrack(trackId)
  if (!track || !isGraphEditableTrack(track) || api.getNode(track.nodeId)?.locked) return null
  const edited = track.keyframes.find(key => key.id === keyframeId)
  if (!edited) return null
  const configuredFps = request.frameRate ?? api.getMeta().frameRate
  const fps = Number.isFinite(configuredFps) && configuredFps > 0 ? configuredFps : 60
  const frame = 1 / fps
  const configuredDuration = request.duration ?? api.getMeta().duration
  const duration = Number.isFinite(configuredDuration) && configuredDuration >= 0 ? configuredDuration : Infinity
  const bundle = resolveStaggerKeyframeBundle(api, trackId, keyframeId)
  const members = bundle?.members ?? [{ trackId, keyframeId, time: edited.time }]
  let minDelta = -Infinity, maxDelta = Infinity
  for (const member of members) {
    const memberTrack = api.getTrack(member.trackId)
    if (!memberTrack || !isGraphEditableTrack(memberTrack) || api.getNode(memberTrack.nodeId)?.locked) return null
    const keys = sortedKeys(memberTrack), index = keys.findIndex(key => key.id === member.keyframeId)
    if (index < 0) return null
    const key = keys[index]!, before = keys[index - 1], after = keys[index + 1]
    minDelta = Math.max(minDelta, -key.time, before ? before.time + frame - key.time : -Infinity)
    maxDelta = Math.min(maxDelta, duration - key.time, after ? after.time - frame - key.time : Infinity)
  }
  const lowFrame = Math.ceil((edited.time + minDelta) * fps - 1e-9)
  const highFrame = Math.floor((edited.time + maxDelta) * fps + 1e-9)
  // Preserve an off-grid authored time for purely vertical editing.
  const time = Math.abs(request.time - edited.time) < 1e-10 || lowFrame > highFrame
    ? edited.time
    : clamp(Math.round(request.time * fps), lowFrame, highFrame) / fps
  return { time: time === 0 ? 0 : time, value: request.value }
}

/** Commit one completed drag, preserving values/metadata outside this bundle. */
export function commitGraphKeyframeDrag(
  api: SceneAPI,
  trackId: string,
  keyframeId: string,
  target: GraphKeyframeTarget,
  options: GraphDragOptions = {},
): boolean {
  const previews = previewGraphKeyframeDrag(api, trackId, keyframeId, target, options)
  const next = previews.get(trackId)?.keyframes.find(item => item.id === keyframeId)
  const track = api.getTrack(trackId), key = track?.keyframes.find(item => item.id === keyframeId)
  if (!next || !track || !key) return false
  api.doc.transact(() => {
    if (patchStaggerKeyframeBundle(api, trackId, keyframeId, { time: next.time, value: next.value })) return
    // Reuse the timeline's text-timing maintenance when retiming a text track.
    if (next.time !== key.time) commitKeyframeTimes(api, [{ trackId, kfId: keyframeId, time: next.time }])
    const live = api.getTrack(trackId)
    if (live) api.setTrack({ ...live, keyframes: live.keyframes.map(item => item.id === keyframeId ? { ...item, value: next.value } : item) })
  }, UNDOABLE_GESTURE_ORIGIN)
  return true
}

function adjacentKeys(track: Track, startId: string, endId: string): GraphSegment | null {
  if (!isGraphEditableTrack(track)) return null
  const keys = sortedKeys(track), index = keys.findIndex(key => key.id === startId)
  const start = keys[index], end = keys[index + 1]
  if (!start || !end || end.id !== endId || end.time <= start.time) return null
  return { start: start as GraphSegment['start'], end: end as GraphSegment['end'], startSelected: false, endSelected: false }
}

/**
 * Map a pointer in time/value space onto one segment handle. Pass the frozen
 * drag-start track so its other handle cannot drift between pointer packets.
 * Equal endpoint values always stay flat; only their handle timing can change.
 */
export function graphEasingHandle(
  track: Track,
  startId: string,
  endId: string,
  which: 1 | 2,
  time: number,
  value: number,
): GraphBezier | null {
  if (!Number.isFinite(time) || !Number.isFinite(value)) return null
  const segment = adjacentKeys(track, startId, endId)
  if (!segment) return null
  const { start, end } = segment
  const bezier = graphEditableBezierCoords(start.easingOut ?? track.defaultEasing)
  const offset = which === 1 ? 0 : 2
  bezier[offset] = clamp((time - start.time) / (end.time - start.time), 0, 1)
  if (end.value !== start.value) bezier[offset + 1] = (value - start.value) / (end.value - start.value)
  return bezier.every(Number.isFinite) ? bezier : null
}

/** Commit to the captured segment IDs; concurrent reordering cannot redirect it. */
export function commitGraphEasing(
  api: SceneAPI,
  trackId: string,
  startId: string,
  endId: string,
  bezier: GraphBezier,
): boolean {
  const preview = previewGraphEasing(api, trackId, startId, endId, bezier)
  const next = preview.get(trackId)?.keyframes.find(key => key.id === startId)
  if (!next) return false
  const patch = { easingOut: next.easingOut, easingPreset: next.easingPreset }
  api.doc.transact(() => {
    if (patchStaggerKeyframeBundle(api, trackId, startId, patch)) return
    const live = api.getTrack(trackId)
    if (live) api.setTrack({ ...live, keyframes: live.keyframes.map(key => key.id === startId ? { ...key, ...patch } : key) })
  }, UNDOABLE_GESTURE_ORIGIN)
  return true
}

/** Apply an exact bundle patch to detached tracks for the engine's preview API. */
function previewPatch(
  api: SceneAPI, trackId: string, keyframeId: string, patch: StaggerKeyframePatch,
): Map<string, Track> {
  const result = new Map<string, Track>()
  const source = api.getTrack(trackId)?.keyframes.find(key => key.id === keyframeId)
  if (!source) return result
  const bundle = resolveStaggerKeyframeBundle(api, trackId, keyframeId)
  const members = bundle?.members ?? [{ trackId, keyframeId, time: source.time }]
  const delta = patch.time === undefined ? 0 : patch.time - source.time
  for (const member of members) {
    const track = result.get(member.trackId) ?? api.getTrack(member.trackId)
    if (!track) continue
    const keyframes = sortedKeys({ ...track, keyframes: track.keyframes.map(key => {
      if (key.id !== member.keyframeId) return key
      return {
        ...key,
        ...(patch.time !== undefined ? { time: Math.max(0, key.time + delta) } : {}),
        ...(patch.value !== undefined ? { value: patch.value } : {}),
        ...(patch.easingOut ? { easingOut: patch.easingOut } : {}),
        ...(patch.easingPreset ? { easingPreset: patch.easingPreset } : {}),
      }
    }) })
    let textAnimation = track.textAnimation
    if (patch.time !== undefined && track.propertyId === 'text.progress' && textAnimation) {
      const node = api.getNode(track.nodeId)
      textAnimation = !bundle && node?.kind === 'text'
        ? deriveTextAnimationTiming(textAnimation, { ...track, keyframes }, node.text) ?? textAnimation
        : { ...textAnimation, startTime: keyframes[0]?.time ?? textAnimation.startTime }
    }
    result.set(track.id, { ...track, keyframes, ...(textAnimation ? { textAnimation } : {}) })
  }
  return result
}

/** Live time/value preview with exact stagger delays and no scene mutation. */
export function previewGraphKeyframeDrag(
  api: SceneAPI,
  trackId: string,
  keyframeId: string,
  target: GraphKeyframeTarget,
  options: GraphDragOptions = {},
): Map<string, Track> {
  const next = graphKeyframeDragTarget(api, trackId, keyframeId, { ...target, ...options })
  const key = api.getTrack(trackId)?.keyframes.find(item => item.id === keyframeId)
  if (!next || !key || (next.time === key.time && next.value === key.value)) return new Map()
  return previewPatch(api, trackId, keyframeId, next)
}

/** Live easing preview; validates the captured endpoints against current IDs. */
export function previewGraphEasing(
  api: SceneAPI,
  trackId: string,
  startId: string,
  endId: string,
  bezier: GraphBezier,
): Map<string, Track> {
  const track = api.getTrack(trackId)
  if (!track || api.getNode(track.nodeId)?.locked || !adjacentKeys(track, startId, endId) || !bezier.every(Number.isFinite)) return new Map()
  const bundle = resolveStaggerKeyframeBundle(api, trackId, startId)
  if (bundle?.members.some(member => {
    const memberTrack = api.getTrack(member.trackId)
    return !memberTrack || api.getNode(memberTrack.nodeId)?.locked
  })) return new Map()
  const coords: GraphBezier = [clamp(bezier[0], 0, 1), bezier[1], clamp(bezier[2], 0, 1), bezier[3]]
  return previewPatch(api, trackId, startId, {
    easingOut: { bezier: coords }, easingPreset: { presetId: 'custom', strength: 100 },
  })
}
