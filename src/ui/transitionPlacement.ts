// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI } from '@/scene'
import { getProjectAPI } from '@/project/doc'
import { mediaClipRange } from '@/scene/mediaClip'
import { applyLayerFade } from './layerFade'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
export type TransitionKind = 'dissolve' | 'in' | 'out'
export const TRANSITION_MIME = 'application/x-hypermotion-transition'
export interface TransitionTarget { type: 'camera' | 'scene' | 'master' | 'layer'; id: string; side: 'in' | 'out' }
export function placeTransition(api: SceneAPI, target: TransitionTarget, kind: TransitionKind, duration: number): string {
  const project = getProjectAPI(api)
  const scene = project.getActiveScene()
  if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('Choose a positive duration.')
  if (target.type === 'camera') {
    const cut = scene?.cameraCuts[target.id]
    if (!scene || !cut) throw new Error('This camera cut no longer exists.')
    if (kind !== 'dissolve') throw new Error('Use Cross dissolve between cameras.')
    api.doc.transact(() => project.upsertCameraCut(scene.id, { ...cut, dissolveDuration: duration }), UNDOABLE_GESTURE_ORIGIN)
    return 'Camera dissolve added'
  }
  if (target.type === 'master') {
    const items = project.getSequenceTimeMap().items
    const hit = items.findIndex(i => i.item.id === target.id)
    const index = target.side === 'in' ? hit - 1 : hit
    if (hit < 0 || index < 0 || index >= items.length - 1) throw new Error('Drop between two scenes in Master.')
    if (kind !== 'dissolve') throw new Error('Use Cross dissolve between scenes.')
    api.doc.transact(() => project.setTransition(items[index]!.item.id, {kind:'crossfade',duration}), UNDOABLE_GESTURE_ORIGIN)
    return 'Master scene dissolve added'
  }
  if (target.type === 'scene') {
    const items = project.getSequenceItems()
    const index = items.findIndex(i => i.sceneId === target.id)
    if (index < 0 || index >= items.length - 1) throw new Error('Drop on a scene that has a following scene.')
    if (kind !== 'dissolve') throw new Error('Use Cross dissolve between scenes.')
    api.doc.transact(() => project.setTransition(items[index]!.id, { kind: 'crossfade', duration }), UNDOABLE_GESTURE_ORIGIN)
    return 'Scene dissolve added'
  }
  const node = api.getNode(target.id)
  if (!node || node.locked) throw new Error('Select an unlocked layer.')
  if (kind !== 'dissolve') {
    if (!applyLayerFade(api, node.id, kind, duration, 'ease-in-out')) throw new Error('This layer cannot receive a visual fade.')
    return kind === 'in' ? 'Fade in added' : 'Fade out added'
  }
  if (node.kind !== 'video') throw new Error('Drop Cross dissolve at the join between two video clips. Use Fade in or Fade out for individual layers.')
  const range = mediaClipRange(node)
  const tolerance = 1 / Math.max(1, api.getMeta().frameRate)
  const candidates = api.getAllNodeIds().map(id => api.getNode(id)).filter(n => n?.kind === 'video' && n.id !== node.id && n.parent === node.parent && !n.locked)
  const neighbor = candidates.find(n => n?.kind === 'video' && Math.abs(target.side === 'in' ? mediaClipRange(n).end - range.start : mediaClipRange(n).start - range.end) <= tolerance)
  if (!neighbor || neighbor.kind !== 'video') throw new Error('Drop at a join where two video clips meet.')
  const left = target.side === 'in' ? neighbor : node
  const right = target.side === 'in' ? node : neighbor
  const leftRange = mediaClipRange(left)
  const rightRange = mediaClipRange(right)
  const length = Math.min(duration, rightRange.duration, (left.duration - leftRange.trimEnd) / leftRange.rate)
  if (length < tolerance) throw new Error('The outgoing clip needs unused source video after its trim end for a dissolve.')
  api.doc.transact(() => {
    api.setNodeProperty(left.id, 'trimEnd', leftRange.trimEnd + length * leftRange.rate)
    api.setNodeProperty(left.id, 'clipToRange', true)
    // Ensure the incoming clip paints above the retained outgoing image.
    api.setNodeProperty(right.id, 'zIndex', Math.max(left.zIndex ?? 0, right.zIndex ?? 0) + 1)
    applyLayerFade(api, right.id, 'in', length, 'linear')
  }, UNDOABLE_GESTURE_ORIGIN)
  return 'Cross dissolve added between clips'
}
