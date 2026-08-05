// SPDX-License-Identifier: Apache-2.0

import { getAnimEngine } from '@/anim'
import { useUI } from '@/state/ui'

export interface AnimationClockState {
  playing: boolean
  playhead: number
  previewScope?: 'scene' | 'sequence'
}

/**
 * Keep large inspector trees off the sampled playback clock.
 *
 * Zustand compares selector results with Object.is. Returning the same null
 * sentinel for every playback sample means the 66 ms UI mirror can keep media
 * and small readouts synchronized without reconciling an entire inspector.
 */
export function pausedInspectorPlayhead(
  state: AnimationClockState,
): number | null {
  return state.playing ? null : state.playhead
}

/**
 * Resolve the authoritative time at the instant an authoring action commits.
 *
 * The UI store is authoritative while a Scene preview is paused. During
 * playback it is only a sampled mirror, so edits must read the rAF-owned
 * engine clock instead. Master/sequence preview is different: the UI clock is
 * in Master time while animation tracks are authored in composition-local
 * time, and useAnim keeps that local time on the engine even while paused.
 * Dependencies are injectable to keep this timing contract easy to test.
 */
export function currentAnimationAuthorTime(
  state: AnimationClockState = useUI.getState(),
  readEnginePlayhead: () => number = () => getAnimEngine().getPlayhead(),
): number {
  return state.playing || state.previewScope === 'sequence'
    ? readEnginePlayhead()
    : state.playhead
}
