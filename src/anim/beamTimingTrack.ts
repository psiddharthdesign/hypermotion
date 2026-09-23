// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI } from '@/scene/doc'
import type { Effect } from '@/scene/types'
import { effectStableId } from '@/scene/effects'
import { effectBeamRangePropertyId } from '@/scene/props'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { ensureTrack, findTrack } from './tracks'

export type BeamRanges = Readonly<Record<string, { start: number; end: number }>>

/** Convert composition-local keys to the procedural clock used by Beam. */
export function resolveBeamRanges(effects: readonly Effect[], ranges: BeamRanges | undefined, offset = 0): Effect[] {
  return effects.map((effect, index) => {
    const range = ranges?.[effectStableId(effect, index)]
    return effect.kind === 'border-beam' && range
      ? { ...effect, startTime: range.start + offset, endTime: range.end + offset, duration: Math.max(.01, range.end - range.start) }
      : effect
  })
}

export function readBeamRange(api: SceneAPI, nodeId: string, effectId: string) {
  const keys = findTrack(api, nodeId, effectBeamRangePropertyId(effectId))?.keyframes
  if (keys?.length) return { start: Math.min(...keys.map(k => k.time)), end: Math.max(...keys.map(k => k.time)) }
  const node = api.getNode(nodeId)
  const effect = node?.appearance.effects.find((effect, i) => effectStableId(effect, i) === effectId)
  if (effect?.kind !== 'border-beam') return null
  const offset = node?.proceduralTimeOffset ?? 0
  const start = (effect.startTime ?? 0) - offset
  return { start, end: effect.endTime === undefined ? api.getMeta().duration : effect.endTime - offset }
}

export function setBeamRange(api: SceneAPI, nodeId: string, effectId: string, start: number, end: number): void {
  const node = api.getNode(nodeId)
  if (!node || node.locked || !Number.isFinite(start) || !Number.isFinite(end)) return
  const index = node.appearance.effects.findIndex((effect, i) => effectStableId(effect, i) === effectId && effect.kind === 'border-beam')
  if (index < 0) return
  const meta = api.getMeta(), frame = 1 / Math.max(1, meta.frameRate)
  start = Math.max(0, Math.min(meta.duration - frame, start))
  end = Math.max(start + frame, Math.min(meta.duration, end))
  api.doc.transact(() => {
    const offset = node.proceduralTimeOffset ?? 0
    api.setNodeProperty(nodeId, 'appearance', { ...node.appearance, effects: node.appearance.effects.map((effect, i) =>
      i === index ? { ...effect, startTime: start + offset, endTime: end + offset, duration: end - start } : effect) })
    const track = ensureTrack(api, nodeId, effectBeamRangePropertyId(effectId), 'linear')
    const keys = [...track.keyframes].sort((a, b) => a.time - b.time)
    api.setTrack({ ...track, keyframes: [
      { id: keys[0]?.id ?? crypto.randomUUID(), time: start, value: 0 },
      { id: keys.length > 1 ? keys[keys.length - 1]!.id : crypto.randomUUID(), time: end, value: 1 },
    ] })
  }, UNDOABLE_GESTURE_ORIGIN)
}

export function stampBeamEndpoint(api: SceneAPI, nodeId: string, effectId: string, endpoint: 'start' | 'end', time: number): void {
  const range = readBeamRange(api, nodeId, effectId)
  if (!range || !Number.isFinite(time)) return
  const meta = api.getMeta(), frame = 1 / Math.max(1, meta.frameRate)
  if (endpoint === 'start') {
    const start = Math.max(0, Math.min(meta.duration - frame, time))
    setBeamRange(api, nodeId, effectId, start, Math.max(range.end, start + frame))
  } else {
    const end = Math.max(frame, Math.min(meta.duration, time))
    setBeamRange(api, nodeId, effectId, Math.min(range.start, end - frame), end)
  }
}
