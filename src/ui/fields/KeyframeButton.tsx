// SPDX-License-Identifier: Apache-2.0

import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import type { KeyframeValue, NodeId, PropertyId } from '@/scene'
import { findKeyframeAt, findTrack, toggleKeyframe } from '@/anim'

/**
 * Per-property keyframe toggle — the small diamond that sits next to an
 * animatable field in the Inspector. Three states:
 *
 *   - **no track**       — faint hollow diamond. Click stamps the first
 *                          keyframe for this property (creates the track).
 *   - **track, no kf**   — outlined diamond in accent color. Click stamps
 *                          a keyframe at the playhead with the current
 *                          static value.
 *   - **kf at playhead** — filled diamond in accent color. Click removes
 *                          that keyframe. If it was the only one, the
 *                          track is cleaned up too.
 *
 * Tolerance for "at the playhead" is 20ms — slightly over one 60fps
 * frame, so the button stays in sync with its keyframe even as the
 * playhead drifts between exact ticks.
 *
 * The `currentValue` is whatever the Inspector is showing right now —
 * i.e. the static scene value, not the engine-evaluated animated one.
 * That matches what the user sees in the field, so "record this value"
 * does what it looks like. A future "record evaluated value" mode
 * (the engine overlays on top of the static) could arrive alongside an
 * auto-key / record toggle.
 *
 * Props deliberately stay narrow:
 *   - `nodeId`       which node to write to
 *   - `propertyId`   which property track to touch
 *   - `currentValue` the value to stamp (or null to disable — some
 *                    fields aren't keyframeable every time, e.g. size
 *                    when the user has it set to 'hug')
 */
export function KeyframeButton({
  nodeId,
  propertyId,
  currentValue,
}: {
  nodeId: NodeId
  propertyId: PropertyId
  currentValue: KeyframeValue | null | undefined
}) {
  const api = useSceneAPI()
  const playhead = useUI((s) => s.playhead)

  const track = findTrack(api, nodeId, propertyId)
  const hasTrack = !!track && track.keyframes.length > 0
  const atPlayhead = findKeyframeAt(api, nodeId, propertyId, playhead)

  const state: 'at' | 'track' | 'none' = atPlayhead
    ? 'at'
    : hasTrack
      ? 'track'
      : 'none'

  const disabled = currentValue === null || currentValue === undefined

  const onClick = () => {
    if (disabled) return
    toggleKeyframe(api, nodeId, propertyId, playhead, currentValue)
  }

  const title = disabled
    ? 'Set a numeric value to keyframe'
    : state === 'at'
      ? `Remove keyframe at ${playhead.toFixed(2)}s`
      : state === 'track'
        ? `Add keyframe at ${playhead.toFixed(2)}s`
        : `Add first keyframe (creates track)`

  // Diamond = 45deg rotated square. `border` on all four sides renders
  // the outlined state uniformly; solid state swaps to `bg-*`. We keep
  // the hit area a touch larger than the visible diamond so these are
  // comfortably clickable inside a dense inspector.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="group flex h-4 w-4 shrink-0 items-center justify-center disabled:cursor-not-allowed"
    >
      <span
        className={[
          'block h-[9px] w-[9px] rotate-45 border transition-colors',
          state === 'at'
            ? 'border-keyframe bg-keyframe group-hover:brightness-125'
            : state === 'track'
              ? 'border-keyframe bg-transparent group-hover:bg-keyframe/40'
              : 'border-text-dim/50 bg-transparent group-hover:border-keyframe group-hover:bg-keyframe/20',
          disabled ? 'opacity-40' : '',
        ].join(' ')}
      />
    </button>
  )
}