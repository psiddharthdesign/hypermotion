// SPDX-License-Identifier: Apache-2.0

import type {
  EasingKind,
  Keyframe,
  KeyframeEasingPreset,
  NodeId,
  Track,
  TrackId,
} from '@/scene/types'
import { PROPERTIES } from '@/scene/props'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { resolveStaggerKeyframeBundle } from './staggerSets'

export type EasingSelectionScope = 'keyframes' | 'tracks' | 'layers'

export interface EasingSelection {
  /** Exact timeline references in `${trackId}:${keyframeId}` form. */
  keyframeKeys?: readonly string[]
  /** Whole timeline-track selection. Used only when no keyframes are selected. */
  trackIds?: readonly TrackId[]
  /** Canvas/layer fallback. Used only when no timeline selection exists. */
  nodeIds?: readonly NodeId[]
}

export interface EasingSelectionSummary {
  scope: EasingSelectionScope
  requestedKeyframeCount: number
  selectedTrackCount: number
  selectedLayerCount: number
  /** Eligible outgoing segments in the user's visible selection. */
  eligibleSegmentCount: number
  /** Eligible segments after linked stagger followers are included. */
  affectedSegmentCount: number
  affectedTrackCount: number
  skippedEndpointCount: number
  skippedDiscreteCount: number
  staleReferenceCount: number
  /** Effective curve shared by the visible selection, or null when mixed/empty. */
  commonEasing: EasingKind | null
  /** Saved picker state shared by the visible selection. */
  commonPreset: KeyframeEasingPreset | null
  mixed: boolean
}

export interface ApplyEasingResult extends EasingSelectionSummary {
  updatedSegmentCount: number
  updatedTrackCount: number
}

interface EasingPlan {
  summary: EasingSelectionSummary
  keyframeIdsByTrack: Map<TrackId, Set<string>>
  defaultEasingTrackIds: Set<TrackId>
}

type SegmentEligibility =
  | { eligible: true; start: Keyframe }
  | { eligible: false; reason: 'endpoint' | 'discrete' }

/**
 * Read the exact scope that a timing edit would affect.
 *
 * Scope precedence is intentionally strict:
 * selected keyframes > selected track headers > selected layers.
 * A stale exact selection therefore becomes a safe no-op instead of
 * unexpectedly widening into a whole-layer edit.
 */
export function inspectEasingSelection(
  api: SceneAPI,
  selection: EasingSelection,
): EasingSelectionSummary {
  return buildEasingPlan(api, selection).summary
}

/**
 * Apply one timing curve to the selected outgoing animation segments.
 *
 * Exact-keyframe mode writes only `easingOut`; it never changes track
 * defaults, keyframe time/value/order, or unselected segments. Whole-track
 * and layer fallback modes intentionally normalize both the track fallback
 * and every eligible outgoing override so baked preset curves cannot win.
 */
export function applyEasingToSelection(
  api: SceneAPI,
  selection: EasingSelection,
  easing: EasingKind,
  preset?: KeyframeEasingPreset,
): ApplyEasingResult {
  const plan = buildEasingPlan(api, selection)
  let updatedSegmentCount = 0
  let updatedTrackCount = 0

  if (
    plan.keyframeIdsByTrack.size === 0 &&
    plan.defaultEasingTrackIds.size === 0
  ) {
    return { ...plan.summary, updatedSegmentCount, updatedTrackCount }
  }

  api.doc.transact(() => {
    const trackIds = new Set<TrackId>([
      ...plan.keyframeIdsByTrack.keys(),
      ...plan.defaultEasingTrackIds,
    ])
    for (const trackId of trackIds) {
      const track = api.getTrack(trackId)
      if (!track) continue
      const selectedIds = plan.keyframeIdsByTrack.get(trackId) ?? new Set()
      let changed = false
      const keyframes = track.keyframes.map((keyframe) => {
        if (!selectedIds.has(keyframe.id)) return keyframe
        if (
          easingKindsEqual(keyframe.easingOut, easing) &&
          easingPresetsEqual(keyframe.easingPreset, preset)
        ) {
          return keyframe
        }
        changed = true
        updatedSegmentCount++
        const next: Keyframe = {
          ...keyframe,
          easingOut: easing,
        }
        if (preset) next.easingPreset = preset
        else delete next.easingPreset
        return next
      })
      const shouldSetDefault = plan.defaultEasingTrackIds.has(trackId)
      const defaultChanged =
        shouldSetDefault && !easingKindsEqual(track.defaultEasing, easing)
      if (!changed && !defaultChanged) continue
      api.setTrack({
        ...track,
        keyframes,
        ...(shouldSetDefault ? { defaultEasing: easing } : {}),
      })
      updatedTrackCount++
    }
  }, UNDOABLE_GESTURE_ORIGIN)

  return {
    ...plan.summary,
    updatedSegmentCount,
    updatedTrackCount,
  }
}

export function easingKindsEqual(
  left: EasingKind | undefined,
  right: EasingKind | undefined,
  epsilon = 1e-6,
): boolean {
  if (left === right) return true
  if (left == null || right == null) return false
  if (typeof left === 'string' || typeof right === 'string') return false
  if ('bezier' in left && 'bezier' in right) {
    return left.bezier.every(
      (value, index) => Math.abs(value - right.bezier[index]!) <= epsilon,
    )
  }
  if ('spring' in left && 'spring' in right) {
    return (
      Math.abs(left.spring.stiffness - right.spring.stiffness) <= epsilon &&
      Math.abs(left.spring.damping - right.spring.damping) <= epsilon &&
      Math.abs(left.spring.mass - right.spring.mass) <= epsilon
    )
  }
  return false
}

function buildEasingPlan(
  api: SceneAPI,
  selection: EasingSelection,
): EasingPlan {
  const keyframeKeys = unique(selection.keyframeKeys ?? [])
  const trackIds = unique(selection.trackIds ?? [])
  const nodeIds = unique(selection.nodeIds ?? [])
  const scope: EasingSelectionScope =
    keyframeKeys.length > 0
      ? 'keyframes'
      : trackIds.length > 0
        ? 'tracks'
        : 'layers'
  const keyframeIdsByTrack = new Map<TrackId, Set<string>>()
  const defaultEasingTrackIds = new Set<TrackId>()
  const visibleEasings: EasingKind[] = []
  const visiblePresets: Array<KeyframeEasingPreset | undefined> = []
  let selectedTrackCount = 0
  let selectedLayerCount = 0
  let eligibleSegmentCount = 0
  let skippedEndpointCount = 0
  let skippedDiscreteCount = 0
  let staleReferenceCount = 0

  const addAffectedSegment = (
    trackId: TrackId,
    keyframeId: string,
    setTrackDefault: boolean,
  ) => {
    const track = api.getTrack(trackId)
    if (!track) return
    const index = track.keyframes.findIndex(
      (keyframe) => keyframe.id === keyframeId,
    )
    const eligibility = segmentEligibility(track, index)
    if (!eligibility.eligible) return
    const ids = keyframeIdsByTrack.get(trackId) ?? new Set<string>()
    ids.add(keyframeId)
    keyframeIdsByTrack.set(trackId, ids)
    if (setTrackDefault) defaultEasingTrackIds.add(trackId)
  }

  const expandSegment = (
    track: Track,
    keyframe: Keyframe,
    setTrackDefault: boolean,
  ) => {
    const bundle = resolveStaggerKeyframeBundle(api, track.id, keyframe.id)
    if (!bundle) {
      addAffectedSegment(track.id, keyframe.id, setTrackDefault)
      return
    }
    for (const member of bundle.members) {
      addAffectedSegment(
        member.trackId,
        member.keyframeId,
        setTrackDefault,
      )
    }
  }

  const collectTrackSegments = (track: Track, setTrackDefault: boolean) => {
    // The final keyframe is the natural end of a whole-track scan, not a
    // skipped user target. Exact-keyframe mode reports it when explicitly
    // selected; track/layer summaries count only real segment starts.
    for (let index = 0; index < track.keyframes.length - 1; index++) {
      const eligibility = segmentEligibility(track, index)
      if (!eligibility.eligible) {
        if (eligibility.reason === 'endpoint') skippedEndpointCount++
        else skippedDiscreteCount++
        continue
      }
      eligibleSegmentCount++
      visibleEasings.push(
        eligibility.start.easingOut ?? track.defaultEasing,
      )
      visiblePresets.push(eligibility.start.easingPreset)
      expandSegment(track, eligibility.start, setTrackDefault)
    }
  }

  if (scope === 'keyframes') {
    for (const key of keyframeKeys) {
      const parsed = parseKeyframeKey(key)
      if (!parsed) {
        staleReferenceCount++
        continue
      }
      const track = api.getTrack(parsed.trackId)
      const index = track?.keyframes.findIndex(
        (keyframe) => keyframe.id === parsed.keyframeId,
      ) ?? -1
      if (!track || index < 0) {
        staleReferenceCount++
        continue
      }
      const eligibility = segmentEligibility(track, index)
      if (!eligibility.eligible) {
        if (eligibility.reason === 'endpoint') skippedEndpointCount++
        else skippedDiscreteCount++
        continue
      }
      eligibleSegmentCount++
      visibleEasings.push(
        eligibility.start.easingOut ?? track.defaultEasing,
      )
      visiblePresets.push(eligibility.start.easingPreset)
      expandSegment(track, eligibility.start, false)
    }
  } else if (scope === 'tracks') {
    for (const trackId of trackIds) {
      const track = api.getTrack(trackId)
      if (!track) {
        staleReferenceCount++
        continue
      }
      selectedTrackCount++
      collectTrackSegments(track, true)
    }
  } else {
    const visitedTracks = new Set<TrackId>()
    for (const nodeId of nodeIds) {
      if (!api.getNode(nodeId)) continue
      selectedLayerCount++
      for (const track of api.getTracksForNode(nodeId)) {
        if (visitedTracks.has(track.id)) continue
        visitedTracks.add(track.id)
        collectTrackSegments(track, true)
      }
    }
  }

  const common = commonEasing(visibleEasings)
  const commonPreset = commonEasingPreset(visiblePresets)
  return {
    keyframeIdsByTrack,
    defaultEasingTrackIds,
    summary: {
      scope,
      requestedKeyframeCount: keyframeKeys.length,
      selectedTrackCount,
      selectedLayerCount,
      eligibleSegmentCount,
      affectedSegmentCount: [...keyframeIdsByTrack.values()].reduce(
        (total, ids) => total + ids.size,
        0,
      ),
      affectedTrackCount: keyframeIdsByTrack.size,
      skippedEndpointCount,
      skippedDiscreteCount,
      staleReferenceCount,
      commonEasing: common.value,
      commonPreset: commonPreset.value,
      mixed: common.mixed || commonPreset.mixed,
    },
  }
}

function segmentEligibility(
  track: Track,
  index: number,
): SegmentEligibility {
  const start = track.keyframes[index]
  const end = track.keyframes[index + 1]
  if (!start || !end || end.time <= start.time) {
    return { eligible: false, reason: 'endpoint' }
  }
  const interpolation = PROPERTIES[track.propertyId]?.interpolation
  const compatible =
    (interpolation === 'numeric' || interpolation === 'angle') &&
    typeof start.value === 'number' &&
    typeof end.value === 'number'
      ? true
      : interpolation === 'color' &&
          typeof start.value === 'string' &&
          typeof end.value === 'string'
  return compatible
    ? { eligible: true, start }
    : { eligible: false, reason: 'discrete' }
}

function parseKeyframeKey(
  key: string,
): { trackId: TrackId; keyframeId: string } | null {
  const separator = key.indexOf(':')
  if (separator <= 0 || separator >= key.length - 1) return null
  return {
    trackId: key.slice(0, separator),
    keyframeId: key.slice(separator + 1),
  }
}

function commonEasing(easings: readonly EasingKind[]): {
  value: EasingKind | null
  mixed: boolean
} {
  const first = easings[0]
  if (!first) return { value: null, mixed: false }
  for (let index = 1; index < easings.length; index++) {
    if (!easingKindsEqual(first, easings[index])) {
      return { value: null, mixed: true }
    }
  }
  return { value: first, mixed: false }
}

function commonEasingPreset(
  presets: readonly (KeyframeEasingPreset | undefined)[],
): { value: KeyframeEasingPreset | null; mixed: boolean } {
  if (presets.length === 0) return { value: null, mixed: false }
  const first = presets[0]
  for (let index = 1; index < presets.length; index++) {
    if (!easingPresetsEqual(first, presets[index])) {
      return { value: null, mixed: true }
    }
  }
  return { value: first ?? null, mixed: false }
}

function easingPresetsEqual(
  left: KeyframeEasingPreset | undefined,
  right: KeyframeEasingPreset | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.presetId === right.presetId &&
    Math.abs(left.strength - right.strength) <= 1e-6
  )
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}
