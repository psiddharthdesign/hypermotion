// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI, NodeId } from '@/scene'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { mediaClipRange } from '@/scene/mediaClip'
import { getLastSolvedLayout } from './hooks/lastSolvedLayout'
import { transformForAbsolutePosition } from './positionMode'

export function canSplitMediaClip(api: SceneAPI, id: NodeId, time: number): boolean {
  const node = api.getNode(id)
  if (!node || (node.kind !== 'video' && node.kind !== 'audio') || node.locked || node.loop) return false
  const range = mediaClipRange(node)
  const frame = 1 / Math.max(1, api.getMeta().frameRate)
  return Number.isFinite(time) && time >= range.start + frame && time <= range.end - frame
}

/** Non-destructive split: both pieces retain source, effects and scene-time tracks. */
export function splitMediaClip(api: SceneAPI, id: NodeId, time: number): NodeId | null {
  if (!canSplitMediaClip(api, id, time)) return null
  const node = api.getNode(id)!
  if (node.kind !== 'video' && node.kind !== 'audio') return null
  const range = mediaClipRange(node)
  const sourceTime = range.trimStart + (time - range.start) * range.rate
  const props = { ...node }
  Reflect.deleteProperty(props, 'id')
  Reflect.deleteProperty(props, 'parent')
  Reflect.deleteProperty(props, 'children')
  const solved = getLastSolvedLayout()
  const child = solved?.[id]
  const parent = node.parent ? solved?.[node.parent] : undefined
  let dx = 0
  let dy = 0
  if (node.kind === 'video' && node.position !== 'absolute' && child && parent) {
    props.transform = transformForAbsolutePosition(node.transform, child, parent)
    dx = props.transform.x - node.transform.x
    dy = props.transform.y - node.transform.y
    props.position = 'absolute'
    props.size = { width: child.width, height: child.height }
  }
  let rightId: NodeId | null = null
  api.doc.transact(() => {
    rightId = api.createNode(node.kind, node.parent, {
      ...props, name: `${node.name} (split)`, startTime: time, trimStart: sourceTime,
      ...(node.kind === 'video' ? { clipToRange: true } : {}),
    })
    api.setNodeProperty(id, 'trimEnd', sourceTime)
    if (node.kind === 'video') api.setNodeProperty(id, 'clipToRange', true)
    for (const track of api.getTracksForNode(id)) {
      const offset = track.propertyId === 'transform.x' ? dx : track.propertyId === 'transform.y' ? dy : 0
      api.setTrack({
        ...track, id: crypto.randomUUID(), nodeId: rightId,
        keyframes: track.keyframes.map((key) => ({
          ...key, id: crypto.randomUUID(),
          value: offset && typeof key.value === 'number' ? key.value + offset : key.value,
        })),
      })
    }
  }, UNDOABLE_GESTURE_ORIGIN)
  return rightId
}

export function trimMediaClipAtPlayhead(api: SceneAPI, id: NodeId, time: number, side: 'start' | 'end') {
  if (!canSplitMediaClip(api, id, time)) return
  const node = api.getNode(id)!
  if (node.kind !== 'video' && node.kind !== 'audio') return
  const range = mediaClipRange(node)
  const sourceTime = range.trimStart + (time - range.start) * range.rate
  api.doc.transact(() => {
    if (side === 'start') {
      api.setNodeProperty(id, 'trimStart', sourceTime)
      api.setNodeProperty(id, 'startTime', time)
    } else api.setNodeProperty(id, 'trimEnd', sourceTime)
    if (node.kind === 'video') api.setNodeProperty(id, 'clipToRange', true)
  }, UNDOABLE_GESTURE_ORIGIN)
}
