// SPDX-License-Identifier: Apache-2.0

import { getAnimEngine } from '@/anim'
import { useUI } from '@/state/ui'

export interface AnimationClockState {
  playing: boolean
  playhead: number
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
 * The UI store is authoritative while paused. During playback it is only a
 * sampled mirror, so edits must read the rAF-owned engine clock instead.
 * Dependencies are injectable to keep this timing contract easy to test.
 */
export function currentAnimationAuthorTime(
  state: AnimationClockState = useUI.getState(),
  readEnginePlayhead: () => number = () => getAnimEngine().getPlayhead(),
): number {
  return state.playing ? readEnginePlayhead() : state.playhead
}
