// SPDX-License-Identifier: Apache-2.0

import type { EasingKind, NodeId, PropertyId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { addKeyframe, clearPresetKeyframes } from './tracks'

/**
 * Jitter-style preset animations.
 *
 * A preset is a tiny recipe that, given a node and a time, generates
 * one-to-three tracks' worth of keyframes. The intent is the same as
 * Jitter: click "Fade In" → your layer fades up over some default
 * duration starting at the current playhead.
 *
 * Design principles:
 *   - Generate keyframes directly onto the scene tracks. No hidden
 *     "preset layer" — once applied, the keyframes are ordinary and
 *     editable just like hand-authored ones.
 *   - Presets distinguish IN (start offscreen/invisible, end normal)
 *     from OUT (start normal, end offscreen/invisible). That's the
 *     canonical Jitter model.
 *   - All presets target transform + opacity. Layout-property
 *     keyframing is reserved for hand-authoring until the FLIP pass
 *     is polished.
 */

export type AnimPresetId =
  | 'fade-in'
  | 'fade-out'
  | 'slide-in-up'
  | 'slide-in-down'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'slide-out-up'
  | 'slide-out-down'
  | 'slide-out-left'
  | 'slide-out-right'
  | 'scale-in'
  | 'scale-out'
  | 'pop'

export interface AnimPreset {
  id: AnimPresetId
  label: string
  direction: 'in' | 'out'
  /** Default duration in seconds. */
  duration: number
  easing: EasingKind
}

export const PRESETS: AnimPreset[] = [
  { id: 'fade-in', label: 'Fade In', direction: 'in', duration: 0.4, easing: 'ease-out' },
  { id: 'fade-out', label: 'Fade Out', direction: 'out', duration: 0.4, easing: 'ease-in' },
  { id: 'slide-in-up', label: 'Slide Up', direction: 'in', duration: 0.5, easing: 'ease-out' },
  { id: 'slide-in-down', label: 'Slide Down', direction: 'in', duration: 0.5, easing: 'ease-out' },
  { id: 'slide-in-left', label: 'Slide Left', direction: 'in', duration: 0.5, easing: 'ease-out' },
  { id: 'slide-in-right', label: 'Slide Right', direction: 'in', duration: 0.5, easing: 'ease-out' },
  { id: 'slide-out-up', label: 'Slide Up (out)', direction: 'out', duration: 0.5, easing: 'ease-in' },
  { id: 'slide-out-down', label: 'Slide Down (out)', direction: 'out', duration: 0.5, easing: 'ease-in' },
  { id: 'slide-out-left', label: 'Slide Left (out)', direction: 'out', duration: 0.5, easing: 'ease-in' },
  { id: 'slide-out-right', label: 'Slide Right (out)', direction: 'out', duration: 0.5, easing: 'ease-in' },
  { id: 'scale-in', label: 'Scale In', direction: 'in', duration: 0.4, easing: 'ease-out' },
  { id: 'scale-out', label: 'Scale Out', direction: 'out', duration: 0.4, easing: 'ease-in' },
  { id: 'pop', label: 'Pop', direction: 'in', duration: 0.5, easing: { bezier: [0.34, 1.56, 0.64, 1] } },
]

/**
 * Apply a preset to a node at a given start time.
 *
 * "Slide In Up" means "enter from below, land in place" — the starting
 * keyframe has `transform.y = +distance`, the ending keyframe has
 * `transform.y = 0`. That matches the direction arrow in Jitter's UI.
 *
 * The slide distance defaults to 80px. Scale presets go from 0.8 → 1.0
 * on both axes. The values will be tweakable in-Inspector later.
 */
export function applyPreset(
  api: SceneAPI,
  nodeId: NodeId,
  preset: AnimPresetId,
  startTime: number,
): void {
  const p = PRESETS.find((x) => x.id === preset)
  if (!p) return
  // Replacement semantics: a fresh IN preset clears any earlier IN
  // stamp (and likewise for OUT), so users can audition preset choices
  // without building up a pile of dead keyframes. Hand-authored
  // keyframes (no `presetOrigin`) survive the prune — see
  // `clearPresetKeyframes`.
  clearPresetKeyframes(api, nodeId, p.direction)

  // Under REPLACE semantics the engine's track values are absolute —
  // so "slide-in-left on a node at x=500" needs keyframes that go from
  // x=580 to x=500, not 80 to 0. Read the node's static pose once and
  // offset every keyframe from it.
  const node = api.getNode(nodeId)
  if (!node) return
  const baseX = node.transform.x
  const baseY = node.transform.y
  const baseSX = node.transform.scaleX
  const baseSY = node.transform.scaleY
  const baseOp = node.appearance.opacity

  const end = startTime + p.duration
  const SLIDE = 80
  const SCALE_LO = 0.8

  const kf = (
    propertyId: PropertyId,
    t: number,
    value: number,
    easing?: EasingKind,
  ) => addKeyframe(api, nodeId, propertyId, t, value, easing, p.direction)

  switch (preset) {
    case 'fade-in':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      break
    case 'fade-out':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      break
    case 'slide-in-up':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.y', startTime, baseY + SLIDE, p.easing)
      kf('transform.y', end, baseY)
      break
    case 'slide-in-down':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.y', startTime, baseY - SLIDE, p.easing)
      kf('transform.y', end, baseY)
      break
    case 'slide-in-left':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.x', startTime, baseX + SLIDE, p.easing)
      kf('transform.x', end, baseX)
      break
    case 'slide-in-right':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.x', startTime, baseX - SLIDE, p.easing)
      kf('transform.x', end, baseX)
      break
    case 'slide-out-up':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.y', startTime, baseY, p.easing)
      kf('transform.y', end, baseY - SLIDE)
      break
    case 'slide-out-down':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.y', startTime, baseY, p.easing)
      kf('transform.y', end, baseY + SLIDE)
      break
    case 'slide-out-left':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.x', startTime, baseX, p.easing)
      kf('transform.x', end, baseX - SLIDE)
      break
    case 'slide-out-right':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.x', startTime, baseX, p.easing)
      kf('transform.x', end, baseX + SLIDE)
      break
    case 'scale-in':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.scaleX', startTime, baseSX * SCALE_LO, p.easing)
      kf('transform.scaleX', end, baseSX)
      kf('transform.scaleY', startTime, baseSY * SCALE_LO, p.easing)
      kf('transform.scaleY', end, baseSY)
      break
    case 'scale-out':
      kf('appearance.opacity', startTime, baseOp, p.easing)
      kf('appearance.opacity', end, 0)
      kf('transform.scaleX', startTime, baseSX, p.easing)
      kf('transform.scaleX', end, baseSX * SCALE_LO)
      kf('transform.scaleY', startTime, baseSY, p.easing)
      kf('transform.scaleY', end, baseSY * SCALE_LO)
      break
    case 'pop':
      kf('appearance.opacity', startTime, 0, p.easing)
      kf('appearance.opacity', end, baseOp)
      kf('transform.scaleX', startTime, baseSX * 0.6, p.easing)
      kf('transform.scaleX', end, baseSX)
      kf('transform.scaleY', startTime, baseSY * 0.6, p.easing)
      kf('transform.scaleY', end, baseSY)
      break
  }
}