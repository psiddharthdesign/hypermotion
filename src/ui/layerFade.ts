// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI, NodeId } from '@/scene'
import { mediaClipRange } from '@/scene/mediaClip'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export function applyLayerFade(api: SceneAPI, id: NodeId, kind: 'in' | 'out' | 'both', seconds: number, easing: 'linear' | 'ease-in-out') {
  const node = api.getNode(id)
  if (!node || node.locked || node.kind === 'camera' || node.kind === 'audio' || id === api.getRoot() || !Number.isFinite(seconds) || seconds <= 0) return false
  const range = node.kind === 'video' ? mediaClipRange(node) : { start: 0, end: api.getMeta().duration }
  const start = Math.max(0, range.start)
  const end = Math.min(api.getMeta().duration, range.end)
  if (end <= start) return false
  const duration = Math.min(seconds, (end - start) / (kind === 'both' ? 2 : 1))
  const track = api.getTracksForNode(id).find(t => t.propertyId === 'appearance.opacity')
  const opacity = node.appearance.opacity
  const intervals: [number, number, number, number][] = []
  if (kind !== 'out') intervals.push([start, start + duration, 0, opacity])
  if (kind !== 'in') intervals.push([end - duration, end, opacity, 0])
  const keys = (track?.keyframes ?? []).filter(k => !intervals.some(([a, b]) => k.time >= a && k.time <= b))
  for (const [a, b, from, to] of intervals) {
    for (const [time, value] of [[a, from], [b, to]]) {
      const existing = keys.find(k => k.time === time)
      if (existing) existing.value = value
      else keys.push({ id: crypto.randomUUID(), time, value, easingOut: easing })
    }
  }
  api.doc.transact(() => api.setTrack({
    ...track, id: track?.id ?? crypto.randomUUID(), nodeId: id,
    propertyId: 'appearance.opacity', defaultEasing: track?.defaultEasing ?? easing,
    keyframes: keys.sort((a, b) => a.time - b.time),
  }), UNDOABLE_GESTURE_ORIGIN)
  return true
}
