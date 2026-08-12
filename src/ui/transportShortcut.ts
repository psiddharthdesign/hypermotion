// SPDX-License-Identifier: Apache-2.0

import type { PreviewScope, TimelineScope } from '@/state/ui'

export interface TransportShortcutState {
  timelineScope: TimelineScope
  previewScope: PreviewScope
  playhead: number
  playing: boolean
}

export type TransportShortcutPatch = Pick<
  TransportShortcutState,
  'playing'
> &
  Partial<Pick<TransportShortcutState, 'previewScope' | 'playhead'>>

export interface TransportSpaceTarget {
  timelineScope: TimelineScope
  isEditableControl: boolean
  isNativeButton: boolean
  isTransportControl: boolean
}

/**
 * Decide whether the focused control should keep a Space keypress instead of
 * letting the global transport handle it.
 *
 * Editable controls always own Space. Native buttons keep their accessible
 * Space-to-click behavior in Scene scope, while Master scope reserves Space
 * for sequence playback no matter which toolbar button was clicked last.
 */
export function shouldNativeControlOwnTransportSpace({
  timelineScope,
  isEditableControl,
  isNativeButton,
  isTransportControl,
}: TransportSpaceTarget): boolean {
  if (isEditableControl) return true
  if (!isNativeButton || isTransportControl) return false
  return timelineScope !== 'sequence'
}

/**
 * Resolve a Space-bar transport command without coupling the keyboard hook to
 * either playback clock.
 *
 * Master time and scene time share the UI playhead, so Master playback must
 * explicitly claim sequence preview before it starts. Restarting at the end
 * mirrors the Master transport button instead of immediately stopping again.
 */
export function resolveTransportSpacePatch(
  state: TransportShortcutState,
  sequenceDuration: number,
): TransportShortcutPatch {
  if (state.timelineScope !== 'sequence') {
    return { playing: !state.playing }
  }

  const shouldRestart =
    !state.playing &&
    state.playhead >= Math.max(0, sequenceDuration)

  return {
    previewScope: 'sequence',
    playhead: shouldRestart ? 0 : state.playhead,
    playing: !state.playing,
  }
}

/**
 * Resolve a one-frame keyboard step against the timeline that owns the
 * transport. Master and Scene share one playhead, but have different bounds.
 */
export function resolveTransportFrameStepPatch(
  state: TransportShortcutState,
  direction: -1 | 1,
  sceneDuration: number,
  sequenceDuration: number,
  frameRate: number,
): TransportShortcutPatch {
  const isMaster = state.timelineScope === 'sequence'
  const duration = Math.max(
    0,
    isMaster ? sequenceDuration : sceneDuration,
  )
  const step = 1 / Math.max(1, frameRate)
  const playhead = Math.min(
    duration,
    Math.max(0, state.playhead + direction * step),
  )

  return {
    ...(isMaster ? { previewScope: 'sequence' as const } : {}),
    playhead,
    playing: false,
  }
}
