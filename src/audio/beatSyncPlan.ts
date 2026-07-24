// SPDX-License-Identifier: Apache-2.0

import {
  alignKeyframesToNoteMarkers,
  createNoteMarkersForBars,
  type AudioBeatGrid,
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
  coincidentTolerance?: number
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
  const basePreview: BeatSyncPlanPreview = {
    rangeSource: null,
    requestedSceneRange: null,
    effectiveSceneRange: null,
    clipSceneRange: null,
    barRange: null,
    selectedKeyframeCount,
    validKeyframeCount: members.length,
    eventCount: countCoincidentEvents(
      members.map((member) => member.time),
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

  const clipSceneRange = sceneClipRange(options.audio)
  if (!clipSceneRange) {
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

  const markers = createNoteMarkersForBars(
    options.grid,
    markerBarRange.startBar,
    markerBarRange.endBar,
  )
    .map((marker) => ({
      ...marker,
      time: sourceTimeToSceneTime(options.audio, marker.time),
    }))
    .filter(
      (marker) =>
        marker.time >= effectiveSceneRange.start - EPSILON &&
        marker.time <= effectiveSceneRange.end + EPSILON,
    )

  const alignment = alignKeyframesToNoteMarkers(
    members.map((member) => member.time),
    markers,
    { coincidentTolerance: options.coincidentTolerance },
  )
  const preview = {
    ...previewWithoutSlots,
    barRange: markerBarRange,
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
  return {
    ok: true,
    preview,
    members,
    markers,
    targetTimes: alignment.times,
    targets,
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

function countCoincidentEvents(
  times: readonly number[],
  toleranceValue: number | undefined,
): number {
  const tolerance =
    Number.isFinite(toleranceValue) && toleranceValue! >= 0
      ? toleranceValue!
      : 1e-6
  let count = 0
  let anchor: number | null = null
  for (const time of [...times].sort((a, b) => a - b)) {
    if (anchor === null || Math.abs(time - anchor) > tolerance) {
      count++
      anchor = time
    }
  }
  return count
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
