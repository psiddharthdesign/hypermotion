// SPDX-License-Identifier: Apache-2.0

import {
  alignKeyframesToNoteMarkers,
  createNoteMarkersForBars,
  spreadKeyframesAcrossNoteMarkers,
  type AudioBeatGrid,
  type KeyframeBeatAlignment,
  type KeyframeBeatAlignmentOptions,
  type NoteMarker,
} from './beatSync'

export interface BeatSyncTrackLike {
  id: string
  keyframes: ReadonlyArray<{
    id: string
    time: number
  }>
}

export interface BeatSyncAudioClip {
  /** Scene-relative start of the trimmed clip. */
  startTime: number
  /** Source-relative in point, in seconds. */
  trimStart: number
  /** Source-relative out point. Falls back to duration when omitted or zero. */
  trimEnd?: number
  /** Source duration, in seconds. */
  duration: number
  playbackRate?: number
}

export interface BeatSyncTimeRange {
  start: number
  end: number
}

export interface BeatSyncBarRange {
  startBar: number
  endBar: number
}

export type BeatSyncRangeSource =
  | 'bars'
  | 'isolated'
  | 'work-area'
  | 'selection-span'

export type BeatSyncPlanFailure =
  | 'no-keyframes'
  | 'no-valid-keyframes'
  | 'invalid-grid'
  | 'invalid-clip'
  | 'invalid-bar-range'
  | 'invalid-time-range'
  | 'range-outside-clip'
  | 'no-grid-slots'
  | 'insufficient-grid-slots'

export interface BeatSyncMember {
  trackId: string
  keyframeId: string
  time: number
}

export interface BeatSyncTarget extends BeatSyncMember {
  targetTime: number
}

export interface BeatSyncPlanPreview {
  rangeSource: BeatSyncRangeSource | null
  /** Requested scene range before intersecting it with the audio clip. */
  requestedSceneRange: BeatSyncTimeRange | null
  /** Scene range that will actually receive synced keyframes. */
  effectiveSceneRange: BeatSyncTimeRange | null
  clipSceneRange: BeatSyncTimeRange | null
  /** Musical bars touched by the effective range. */
  barRange: BeatSyncBarRange | null
  /** Bars actually occupied after collision cascades into later grid points. */
  targetBarRange: BeatSyncBarRange | null
  selectedKeyframeCount: number
  validKeyframeCount: number
  eventCount: number
  availableSlots: number
}

export interface BeatSyncPlan {
  ok: boolean
  reason?: BeatSyncPlanFailure
  preview: BeatSyncPlanPreview
  /** Valid selected keyframes, sorted in timeline order. */
  members: BeatSyncMember[]
  /** Scene-relative note markers used to make the plan. */
  markers: NoteMarker[]
  /** One scene-relative target per member, in the same order as members. */
  targetTimes: number[]
  targets: BeatSyncTarget[]
}

export interface BeatSyncPlanOptions {
  grid: AudioBeatGrid
  audio: BeatSyncAudioClip
  tracks: readonly BeatSyncTrackLike[]
  /**
   * Timeline compound ids (`trackId:keyframeId`). Stale ids are deliberately
   * ignored, then reported through `no-valid-keyframes` when none resolve.
   */
  selectedKeyframeKeys: ReadonlySet<string> | readonly string[]
  /** Highest-priority range when present. */
  selectedBars?: BeatSyncBarRange | null
  /** Used when no explicit bar range is selected. */
  isolatedRange?: BeatSyncTimeRange | null
  /** Used when neither bars nor an isolated range are active. */
  workAreaRange?: BeatSyncTimeRange | null
  /** Optional composition boundary. Overflow never writes beyond it. */
  sceneEndTime?: number
  coincidentTolerance?: number
  /** Internal placement intent. Ordinary Snap uses nearest. */
  placement?: 'nearest' | 'spread'
}

export type BeatSyncRespaceChange = 'increase' | 'decrease' | 'redistribute'

export interface BeatSyncRespaceProposal {
  change: BeatSyncRespaceChange
  currentSpan: number
  targetSpan: number
  currentSpacing: number
  targetSpacing: number
  signature: string
  plan: BeatSyncPlan
}

const EPSILON = 1e-7

/**
 * Resolve a complete, non-mutating keyframe-to-beat operation.
 *
 * Range precedence is explicit bars → isolated range → work area → selected
 * keyframe span. There is intentionally no implicit "bar 1" fallback.
 */
export function planKeyframeBeatSync(
  options: BeatSyncPlanOptions,
): BeatSyncPlan {
  const selectedKeys = options.selectedKeyframeKeys instanceof Set
    ? options.selectedKeyframeKeys
    : new Set(options.selectedKeyframeKeys)
  const selectedKeyframeCount = selectedKeys.size
  const members = resolveSelectedMembers(options.tracks, selectedKeys)
  const alignmentOptions = createAlignmentOptions(
    options.tracks,
    selectedKeys,
    members,
    options.coincidentTolerance,
  )
  const basePreview: BeatSyncPlanPreview = {
    rangeSource: null,
    requestedSceneRange: null,
    effectiveSceneRange: null,
    clipSceneRange: null,
    barRange: null,
    targetBarRange: null,
    selectedKeyframeCount,
    validKeyframeCount: members.length,
    eventCount: countCoincidentMemberEvents(
      members,
      options.coincidentTolerance,
    ),
    availableSlots: 0,
  }

  if (selectedKeyframeCount === 0) {
    return failure('no-keyframes', basePreview, members)
  }
  if (members.length === 0) {
    return failure('no-valid-keyframes', basePreview, members)
  }
  if (!validGrid(options.grid)) {
    return failure('invalid-grid', basePreview, members)
  }

  const rawClipSceneRange = sceneClipRange(options.audio)
  if (!rawClipSceneRange) {
    return failure('invalid-clip', basePreview, members)
  }
  const sceneEnd = Number.isFinite(options.sceneEndTime)
    ? Math.max(0, options.sceneEndTime!)
    : rawClipSceneRange.end
  const clipSceneRange = {
    start: rawClipSceneRange.start,
    end: Math.min(rawClipSceneRange.end, sceneEnd),
  }
  if (clipSceneRange.end < clipSceneRange.start - EPSILON) {
    return failure('invalid-clip', basePreview, members)
  }

  const rangeResolution = resolveRange(
    options,
    members,
    clipSceneRange,
  )
  if (!rangeResolution.ok) {
    return failure(rangeResolution.reason, {
      ...basePreview,
      rangeSource: rangeResolution.rangeSource,
      requestedSceneRange: rangeResolution.requestedSceneRange,
      clipSceneRange,
    }, members)
  }

  const effectiveSceneRange = intersectRanges(
    rangeResolution.requestedSceneRange,
    clipSceneRange,
  )
  const previewWithoutSlots: BeatSyncPlanPreview = {
    ...basePreview,
    rangeSource: rangeResolution.rangeSource,
    requestedSceneRange: rangeResolution.requestedSceneRange,
    effectiveSceneRange,
    clipSceneRange,
    barRange: rangeResolution.barRange,
  }
  if (!effectiveSceneRange) {
    return failure('range-outside-clip', previewWithoutSlots, members)
  }

  const markerBarRange = rangeResolution.barRange ??
    barsForSceneRange(options.grid, options.audio, effectiveSceneRange)
  if (!markerBarRange) {
    return failure('no-grid-slots', previewWithoutSlots, members)
  }

  const initialMarkers = sceneNoteMarkersForBars(
    options.grid,
    options.audio,
    markerBarRange.startBar,
    markerBarRange.endBar,
  )
    .filter(
      (marker) =>
        marker.time >= effectiveSceneRange.start - EPSILON &&
        marker.time <= effectiveSceneRange.end + EPSILON,
    )

  const clipBarRange = barsForSceneRange(
    options.grid,
    options.audio,
    clipSceneRange,
  )
  const memberTimes = members.map((member) => member.time)
  let markers: NoteMarker[]
  let alignment: KeyframeBeatAlignment
  if (options.placement === 'spread') {
    markers = clipBarRange
      ? sceneNoteMarkersForBars(
          options.grid,
          options.audio,
          markerBarRange.startBar,
          clipBarRange.endBar,
        ).filter(
          (marker) =>
            marker.time >= effectiveSceneRange.start - EPSILON &&
            marker.time <= clipSceneRange.end + EPSILON,
        )
      : initialMarkers
    alignment = spreadKeyframesAcrossNoteMarkers(
      memberTimes,
      markers,
      {
        ...alignmentOptions,
        preferredEndTime: effectiveSceneRange.end,
      },
    )
  } else {
    markers = initialMarkers
    alignment = alignKeyframesToNoteMarkers(
      memberTimes,
      markers,
      alignmentOptions,
    )
    if (
      !alignment.ok &&
      clipBarRange &&
      clipBarRange.endBar >= markerBarRange.endBar
    ) {
      const overflowMarkers = sceneNoteMarkersForBars(
        options.grid,
        options.audio,
        markerBarRange.startBar,
        clipBarRange.endBar,
      )
        .filter(
          (marker) =>
            marker.time >= effectiveSceneRange.start - EPSILON &&
            marker.time <= clipSceneRange.end + EPSILON,
        )
      const overflowAlignment = alignKeyframesToNoteMarkers(
        memberTimes,
        overflowMarkers,
        alignmentOptions,
      )
      markers = overflowMarkers
      alignment = overflowAlignment
    }
  }
  const preview = {
    ...previewWithoutSlots,
    barRange: markerBarRange,
    targetBarRange: null,
    availableSlots: alignment.availableSlots,
  }
  if (!alignment.ok) {
    return failure(
      alignment.reason === 'insufficient-grid-slots'
        ? 'insufficient-grid-slots'
        : 'no-grid-slots',
      preview,
      members,
      markers,
    )
  }

  const targets = members.map((member, index) => ({
    ...member,
    targetTime: alignment.times[index]!,
  }))
  const lastTargetTime = Math.max(...alignment.times)
  const overflowed = lastTargetTime > effectiveSceneRange.end + EPSILON
  const targetBarRange = overflowed
    ? barsForSceneRange(options.grid, options.audio, {
        start: effectiveSceneRange.start,
        end: lastTargetTime + EPSILON * 10,
      })
    : markerBarRange
  const visibleMarkerEnd = Math.max(
    effectiveSceneRange.end,
    lastTargetTime,
  )
  const usedMarkers = markers.filter(
    (marker) => marker.time <= visibleMarkerEnd + EPSILON,
  )
  return {
    ok: true,
    preview: { ...preview, targetBarRange },
    members,
    markers: usedMarkers,
    targetTimes: alignment.times,
    targets,
  }
}

/**
 * Build a confirmation-only re-spacing proposal for an already snapped
 * selection. Ordinary snapping stays nearest-point based; this path is only
 * offered when every current event is already on the active musical grid and
 * spreading it across the newly selected bars would materially move it.
 */
export function proposeKeyframeBeatRespace(
  options: BeatSyncPlanOptions,
): BeatSyncRespaceProposal | null {
  if (!options.selectedBars) return null
  const nearestPlan = planKeyframeBeatSync({
    ...options,
    placement: 'nearest',
  })
  if (
    !nearestPlan.ok ||
    nearestPlan.preview.eventCount < 2 ||
    !nearestPlan.preview.clipSceneRange
  ) {
    return null
  }

  const tolerance = beatSyncTolerance(options.coincidentTolerance)
  const clipBars = barsForSceneRange(
    options.grid,
    options.audio,
    nearestPlan.preview.clipSceneRange,
  )
  if (!clipBars) return null
  const clipMarkers = sceneNoteMarkersForBars(
    options.grid,
    options.audio,
    clipBars.startBar,
    clipBars.endBar,
  ).filter(
    (marker) =>
      marker.time >= nearestPlan.preview.clipSceneRange!.start - EPSILON &&
      marker.time <= nearestPlan.preview.clipSceneRange!.end + EPSILON,
  )
  if (
    !nearestPlan.members.every((member) =>
      clipMarkers.some(
        (marker) => Math.abs(marker.time - member.time) <= tolerance,
      ),
    )
  ) {
    return null
  }

  const spreadPlan = planKeyframeBeatSync({
    ...options,
    placement: 'spread',
  })
  if (!spreadPlan.ok) return null
  const targetByMember = new Map(
    spreadPlan.targets.map((target) => [
      beatSyncSelectionKey(target.trackId, target.keyframeId),
      target.targetTime,
    ]),
  )
  const eventGroups = clusterCoincidentMembers(
    nearestPlan.members,
    options.coincidentTolerance,
  )
  const currentEventTimes = eventGroups.map((group) => group[0]!.time)
  const targetEventTimes = eventGroups.map((group) =>
    targetByMember.get(
      beatSyncSelectionKey(group[0]!.trackId, group[0]!.keyframeId),
    ) ?? group[0]!.time,
  )
  const changed = nearestPlan.members.some((member) => {
    const target = targetByMember.get(
      beatSyncSelectionKey(member.trackId, member.keyframeId),
    )
    return target !== undefined && Math.abs(target - member.time) > tolerance
  })
  if (!changed) return null

  const currentSpan =
    currentEventTimes.at(-1)! - currentEventTimes[0]!
  const targetSpan =
    targetEventTimes.at(-1)! - targetEventTimes[0]!
  const intervalCount = Math.max(1, eventGroups.length - 1)
  const currentSpacing = currentSpan / intervalCount
  const targetSpacing = targetSpan / intervalCount
  const change: BeatSyncRespaceChange =
    targetSpacing > currentSpacing + tolerance
      ? 'increase'
      : targetSpacing < currentSpacing - tolerance
        ? 'decrease'
        : 'redistribute'
  const signature = JSON.stringify({
    bars: options.selectedBars,
    members: nearestPlan.members.map((member) => [
      member.trackId,
      member.keyframeId,
      member.time,
    ]),
    targets: spreadPlan.targets.map((target) => [
      target.trackId,
      target.keyframeId,
      target.targetTime,
    ]),
    grid: {
      bpm: options.grid.bpm,
      firstBeatTime: options.grid.firstBeatTime,
      beatsPerBar: options.grid.beatsPerBar,
      beatUnit: options.grid.beatUnit,
      subdivisions: options.grid.subdivisions,
    },
  })
  return {
    change,
    currentSpan,
    targetSpan,
    currentSpacing,
    targetSpacing,
    signature,
    plan: spreadPlan,
  }
}

export function beatSyncSelectionKey(
  trackId: string,
  keyframeId: string,
): string {
  return `${trackId}:${keyframeId}`
}

export function sourceTimeToSceneTime(
  audio: BeatSyncAudioClip,
  sourceTime: number,
): number {
  const playbackRate = positiveFinite(audio.playbackRate, 1)
  return audio.startTime + (sourceTime - audio.trimStart) / playbackRate
}

function resolveSelectedMembers(
  tracks: readonly BeatSyncTrackLike[],
  selectedKeys: ReadonlySet<string>,
): BeatSyncMember[] {
  return tracks
    .flatMap((track) =>
      track.keyframes
        .filter((keyframe) =>
          selectedKeys.has(beatSyncSelectionKey(track.id, keyframe.id)),
        )
        .filter((keyframe) => Number.isFinite(keyframe.time))
        .map((keyframe) => ({
          trackId: track.id,
          keyframeId: keyframe.id,
          time: keyframe.time,
        })),
    )
    .sort(
      (a, b) =>
        a.time - b.time ||
        a.trackId.localeCompare(b.trackId) ||
        a.keyframeId.localeCompare(b.keyframeId),
    )
}

type RangeResolution =
  | {
      ok: true
      rangeSource: BeatSyncRangeSource
      requestedSceneRange: BeatSyncTimeRange
      barRange: BeatSyncBarRange | null
    }
  | {
      ok: false
      reason: 'invalid-bar-range' | 'invalid-time-range'
      rangeSource: BeatSyncRangeSource
      requestedSceneRange: BeatSyncTimeRange | null
    }

function resolveRange(
  options: BeatSyncPlanOptions,
  members: readonly BeatSyncMember[],
  clipSceneRange: BeatSyncTimeRange,
): RangeResolution {
  if (options.selectedBars) {
    const bars = options.selectedBars
    if (
      !Number.isInteger(bars.startBar) ||
      !Number.isInteger(bars.endBar) ||
      bars.startBar < 1 ||
      bars.endBar < bars.startBar
    ) {
      return {
        ok: false,
        reason: 'invalid-bar-range',
        rangeSource: 'bars',
        requestedSceneRange: null,
      }
    }
    const sourceStart = barSourceStart(options.grid, bars.startBar)
    const sourceEnd = barSourceStart(options.grid, bars.endBar + 1)
    return {
      ok: true,
      rangeSource: 'bars',
      requestedSceneRange: normalizeRange({
        start: sourceTimeToSceneTime(options.audio, sourceStart),
        end: sourceTimeToSceneTime(options.audio, sourceEnd),
      })!,
      barRange: bars,
    }
  }

  if (options.isolatedRange) {
    return validatedTimeRange('isolated', options.isolatedRange)
  }
  if (options.workAreaRange) {
    return validatedTimeRange('work-area', options.workAreaRange)
  }

  const first = members[0]!.time
  const last = members.at(-1)!.time
  // A single keyframe has no span. Use the visible clip as the search domain
  // so the existing nearest-note behavior remains useful and deterministic.
  const range = Math.abs(last - first) <= EPSILON
    ? clipSceneRange
    : { start: first, end: last }
  return {
    ok: true,
    rangeSource: 'selection-span',
    requestedSceneRange: range,
    barRange: null,
  }
}

function validatedTimeRange(
  rangeSource: 'isolated' | 'work-area',
  range: BeatSyncTimeRange,
): RangeResolution {
  const normalized = normalizeRange(range)
  if (!normalized || normalized.end - normalized.start <= EPSILON) {
    return {
      ok: false,
      reason: 'invalid-time-range',
      rangeSource,
      requestedSceneRange: null,
    }
  }
  return {
    ok: true,
    rangeSource,
    requestedSceneRange: normalized,
    barRange: null,
  }
}

function sceneClipRange(audio: BeatSyncAudioClip): BeatSyncTimeRange | null {
  if (
    !Number.isFinite(audio.startTime) ||
    !Number.isFinite(audio.trimStart) ||
    !Number.isFinite(audio.duration) ||
    audio.trimStart < 0 ||
    audio.duration <= 0
  ) {
    return null
  }
  const sourceEnd =
    Number.isFinite(audio.trimEnd) && audio.trimEnd! > audio.trimStart
      ? Math.min(audio.duration, audio.trimEnd!)
      : audio.duration
  if (sourceEnd <= audio.trimStart) return null
  const end = sourceTimeToSceneTime(audio, sourceEnd)
  if (!Number.isFinite(end) || end <= audio.startTime) return null
  return { start: audio.startTime, end }
}

function barsForSceneRange(
  grid: AudioBeatGrid,
  audio: BeatSyncAudioClip,
  sceneRange: BeatSyncTimeRange,
): BeatSyncBarRange | null {
  const playbackRate = positiveFinite(audio.playbackRate, 1)
  const sourceStart =
    audio.trimStart + (sceneRange.start - audio.startTime) * playbackRate
  const sourceEnd =
    audio.trimStart + (sceneRange.end - audio.startTime) * playbackRate
  const secondsPerBar = 60 / grid.bpm * grid.beatsPerBar
  const startBar = Math.max(
    1,
    Math.floor((sourceStart - grid.firstBeatTime) / secondsPerBar) + 1,
  )
  const endBar = Math.max(
    startBar,
    Math.floor(
      (sourceEnd - grid.firstBeatTime - EPSILON) / secondsPerBar,
    ) + 1,
  )
  if (!Number.isFinite(startBar) || !Number.isFinite(endBar)) return null
  return { startBar, endBar }
}

function barSourceStart(grid: AudioBeatGrid, bar: number): number {
  const secondsPerBar = 60 / grid.bpm * grid.beatsPerBar
  return grid.firstBeatTime + (bar - 1) * secondsPerBar
}

function sceneNoteMarkersForBars(
  grid: AudioBeatGrid,
  audio: BeatSyncAudioClip,
  startBar: number,
  endBar: number,
): NoteMarker[] {
  return createNoteMarkersForBars(grid, startBar, endBar).map((marker) => ({
    ...marker,
    time: sourceTimeToSceneTime(audio, marker.time),
  }))
}

function intersectRanges(
  a: BeatSyncTimeRange,
  b: BeatSyncTimeRange,
): BeatSyncTimeRange | null {
  const start = Math.max(a.start, b.start)
  const end = Math.min(a.end, b.end)
  return end >= start - EPSILON ? { start, end } : null
}

function normalizeRange(
  range: BeatSyncTimeRange,
): BeatSyncTimeRange | null {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) return null
  return range.start <= range.end
    ? { start: range.start, end: range.end }
    : { start: range.end, end: range.start }
}

function validGrid(grid: AudioBeatGrid): boolean {
  return (
    Number.isFinite(grid.bpm) &&
    grid.bpm > 0 &&
    Number.isFinite(grid.firstBeatTime) &&
    Number.isFinite(grid.beatsPerBar) &&
    grid.beatsPerBar > 0
  )
}

function countCoincidentMemberEvents(
  members: readonly BeatSyncMember[],
  toleranceValue: number | undefined,
): number {
  return clusterCoincidentMembers(members, toleranceValue).length
}

function clusterCoincidentMembers(
  members: readonly BeatSyncMember[],
  toleranceValue: number | undefined,
): BeatSyncMember[][] {
  const tolerance = beatSyncTolerance(toleranceValue)
  const groups: BeatSyncMember[][] = []
  for (const member of [...members].sort((a, b) => a.time - b.time)) {
    const group = groups.at(-1)
    const anchor = group?.[0]?.time
    if (
      !group ||
      anchor === undefined ||
      Math.abs(member.time - anchor) > tolerance ||
      group.some((candidate) => candidate.trackId === member.trackId)
    ) {
      groups.push([member])
    } else {
      group.push(member)
    }
  }
  return groups
}

function beatSyncTolerance(toleranceValue: number | undefined): number {
  return Number.isFinite(toleranceValue) && toleranceValue! >= 0
    ? toleranceValue!
    : 1e-6
}

function createAlignmentOptions(
  tracks: readonly BeatSyncTrackLike[],
  selectedKeys: ReadonlySet<string>,
  members: readonly BeatSyncMember[],
  toleranceValue: number | undefined,
): KeyframeBeatAlignmentOptions {
  const tolerance = beatSyncTolerance(toleranceValue)
  const reservedByTrack = new Map<string, number[]>()
  for (const track of tracks) {
    const reserved = track.keyframes
      .filter(
        (keyframe) =>
          Number.isFinite(keyframe.time) &&
          !selectedKeys.has(beatSyncSelectionKey(track.id, keyframe.id)),
      )
      .map((keyframe) => keyframe.time)
    if (reserved.length > 0) reservedByTrack.set(track.id, reserved)
  }
  return {
    coincidentTolerance: toleranceValue,
    coincidenceKeys: members.map((member) => member.trackId),
    isSlotAvailable: (memberIndices, slotTime) =>
      memberIndices.every((memberIndex) => {
        const member = members[memberIndex]
        if (!member) return false
        return !(reservedByTrack.get(member.trackId) ?? []).some(
          (time) => Math.abs(time - slotTime) <= tolerance,
        )
      }),
  }
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback
}

function failure(
  reason: BeatSyncPlanFailure,
  preview: BeatSyncPlanPreview,
  members: BeatSyncMember[],
  markers: NoteMarker[] = [],
): BeatSyncPlan {
  return {
    ok: false,
    reason,
    preview,
    members,
    markers,
    targetTimes: [],
    targets: [],
  }
}
