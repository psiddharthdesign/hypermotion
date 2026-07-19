// SPDX-License-Identifier: Apache-2.0

import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import type { KeyframeValue, NodeId, PropertyId } from '@/scene'
import { findKeyframeAt, findTrack, getAnimEngine, toggleKeyframe } from '@/anim'
import {
  inspectMultiKeyframes,
  toggleMultiKeyframes,
  type MultiKeyframeTarget,
} from '@/anim/multiKeyframes'
import {
  inspectStaggerSetPropertyFromMember,
  inspectStaggerSetProperty,
  toggleStaggerSetPropertyFromMember,
  toggleStaggerSetPropertyKeyframes,
} from '@/anim/staggerSets'

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
  const pausedPlayhead = useUI((state) =>
    state.playing ? null : state.playhead,
  )
  const playhead = pausedPlayhead ?? getAnimEngine().getPlayhead()

  const staggerOn = useUI((state) => state.staggerOn)
  const activeStaggerSetId = useUI((state) => state.activeStaggerSetId)
  const staggerSummary =
    staggerOn && activeStaggerSetId
      ? inspectStaggerSetPropertyFromMember(
          api,
          activeStaggerSetId,
          nodeId,
          propertyId,
          playhead,
        )
      : null

  const track = findTrack(api, nodeId, propertyId)
  const hasTrack = !!track && track.keyframes.length > 0
  const atPlayhead = findKeyframeAt(api, nodeId, propertyId, playhead)

  const state: 'at' | 'partial' | 'track' | 'none' =
    staggerSummary?.state ??
    (atPlayhead ? 'at' : hasTrack ? 'track' : 'none')

  const disabled = currentValue === null || currentValue === undefined

  const onClick = () => {
    if (disabled) return
    const currentPlayhead = useUI.getState().playing
      ? getAnimEngine().getPlayhead()
      : useUI.getState().playhead
    const ui = useUI.getState()
    if (ui.staggerOn && ui.activeStaggerSetId) {
      const result = toggleStaggerSetPropertyFromMember(
        api,
        ui.activeStaggerSetId,
        nodeId,
        propertyId,
        currentPlayhead,
        currentValue,
      )
      if (result) {
        ui.setSelectedTrackIds(result.trackIds)
        return
      }
    }
    toggleKeyframe(api, nodeId, propertyId, currentPlayhead, currentValue)
  }

  const title = disabled
    ? 'Set a numeric value to keyframe'
    : state === 'at'
      ? staggerSummary
        ? `Remove ${propertyId} from all ${staggerSummary.targetCount} stagger layers at ${playhead.toFixed(2)}s`
        : `Remove keyframe at ${playhead.toFixed(2)}s`
      : state === 'partial'
        ? `Complete ${propertyId} across all ${staggerSummary?.targetCount ?? 0} stagger layers at ${playhead.toFixed(2)}s`
        : state === 'track'
          ? staggerSummary
            ? `Add ${propertyId} across all ${staggerSummary.targetCount} stagger layers at ${playhead.toFixed(2)}s`
            : `Add keyframe at ${playhead.toFixed(2)}s`
          : staggerSummary
            ? `Add ${propertyId} to all ${staggerSummary.targetCount} stagger layers`
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
            : state === 'partial'
              ? 'border-keyframe bg-keyframe/35 group-hover:bg-keyframe/55'
              : state === 'track'
                ? 'border-keyframe bg-transparent group-hover:bg-keyframe/40'
                : 'border-text-dim/50 bg-transparent group-hover:border-keyframe group-hover:bg-keyframe/20',
          disabled ? 'opacity-40' : '',
        ].join(' ')}
      />
    </button>
  )
}

/**
 * One diamond for the same property across a multi-layer selection.
 * Clicking creates/removes the playhead keyframe on every layer and selects
 * the resulting tracks so the timeline's Stagger action is immediately ready.
 */
export function MultiKeyframeButton({
  targets,
  propertyId,
}: {
  targets: readonly MultiKeyframeTarget[]
  propertyId: PropertyId
}) {
  const api = useSceneAPI()
  const pausedPlayhead = useUI((state) =>
    state.playing ? null : state.playhead,
  )
  const playhead = pausedPlayhead ?? getAnimEngine().getPlayhead()
  const staggerOn = useUI((state) => state.staggerOn)
  const staggerDelay = useUI((state) => state.staggerDelay)
  const activeStaggerSetId = useUI((state) => state.activeStaggerSetId)
  const activeStaggerSet = activeStaggerSetId
    ? api.getUiState().staggerSets[activeStaggerSetId]
    : undefined
  const staggerActive =
    staggerOn && activeStaggerSetId !== null && targets.length > 1
  const staggerOptions = activeStaggerSetId
    ? {
        setId: activeStaggerSetId,
        layerIds:
          activeStaggerSet?.layerIds ?? targets.map((target) => target.nodeId),
        delay: activeStaggerSet?.delay ?? staggerDelay,
        order: activeStaggerSet?.order ?? ('forward' as const),
      }
    : null
  const normalSummary = inspectMultiKeyframes(
    api,
    targets,
    propertyId,
    playhead,
  )
  const staggerSummary =
    staggerActive && staggerOptions
      ? inspectStaggerSetProperty(
          api,
          targets,
          propertyId,
          playhead,
          staggerOptions,
        )
      : null
  const state = staggerSummary?.state ?? normalSummary.state
  const targetCount = staggerSummary?.targetCount ?? normalSummary.targetCount
  const disabled = targets.length === 0

  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    const ui = useUI.getState()
    const currentPlayhead = ui.playing
      ? getAnimEngine().getPlayhead()
      : ui.playhead
    const previousPropertyTrackIds = targets.flatMap((target) => {
      const track = findTrack(api, target.nodeId, propertyId)
      return track ? [track.id] : []
    })
    const result =
      staggerActive && staggerOptions
        ? toggleStaggerSetPropertyKeyframes(
            api,
            targets,
            propertyId,
            currentPlayhead,
            staggerOptions,
          )
        : toggleMultiKeyframes(
            api,
            targets,
            propertyId,
            currentPlayhead,
          )
    const additive = event.metaKey || event.ctrlKey || event.shiftKey
    if (result.action === 'added') {
      ui.setSelectedTrackIds(
        uniqueTrackIds(
          additive
            ? [...ui.selectedTrackIds, ...result.trackIds]
            : result.trackIds,
        ),
      )
      return
    }

    const affected = new Set(previousPropertyTrackIds)
    const unaffected = additive
      ? ui.selectedTrackIds.filter((trackId) => !affected.has(trackId))
      : []
    ui.setSelectedTrackIds(uniqueTrackIds([...unaffected, ...result.trackIds]))
  }

  const title = disabled
    ? 'No keyframeable layers selected'
    : state === 'at'
      ? `Remove ${propertyId} keyframes from ${targetCount} layers at ${playhead.toFixed(2)}s`
      : state === 'partial'
        ? `Complete ${propertyId} keyframes across ${targetCount} layers at ${playhead.toFixed(2)}s`
        : staggerActive
          ? `Add ${propertyId} to the active stagger set across ${targetCount} layers`
          : `Add ${propertyId} keyframes to ${targetCount} layers at ${playhead.toFixed(2)}s`
  const help = staggerActive
    ? 'Later properties and keyframes will join this same stagger set.'
    : 'The resulting tracks will be selected. Press S to begin a stagger set.'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${title}. ${help}`}
      aria-label={title}
      aria-pressed={state === 'at'}
      className="group flex h-4 w-4 shrink-0 items-center justify-center disabled:cursor-not-allowed"
    >
      <span
        className={[
          'block h-[9px] w-[9px] rotate-45 border transition-colors',
          state === 'at'
            ? 'border-keyframe bg-keyframe group-hover:brightness-125'
            : state === 'partial'
              ? 'border-keyframe bg-keyframe/35 group-hover:bg-keyframe/55'
              : state === 'track'
                ? 'border-keyframe bg-transparent group-hover:bg-keyframe/40'
                : 'border-text-dim/50 bg-transparent group-hover:border-keyframe group-hover:bg-keyframe/20',
          disabled ? 'opacity-40' : '',
        ].join(' ')}
      />
    </button>
  )
}

function uniqueTrackIds(trackIds: readonly string[]): string[] {
  return [...new Set(trackIds)]
}
