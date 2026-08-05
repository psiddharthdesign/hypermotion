// SPDX-License-Identifier: Apache-2.0

import type { MasterAudioNode } from '@/audio/masterAudio'
import {
  createNoteMarkersForBars,
  type NoteMarker,
} from '@/audio/beatSync'
import type { ResolvedSequenceItem } from '@/sequence'

export interface SceneMasterAudioGuideSegment {
  audioId: string
  audioName: string
  sourceStart: number
  sourceEnd: number
  sceneStart: number
  sceneEnd: number
  masterStart: number
  masterEnd: number
}

export interface SceneMasterBeatSource {
  /** Virtual, read-only audio clock translated into Scene-local time. */
  node: MasterAudioNode
  /** Id of the real Master-owned audio node. */
  sourceAudioId: string
  /** Audible overlap, clipped to the selected occurrence. */
  visibleSceneRange: {
    start: number
    end: number
  }
}

export interface ProjectedMasterBeatMarker extends NoteMarker {
  beatSourceId: string
  sourceAudioId: string
}

/**
 * Translate Master-owned soundtrack clips into the selected occurrence's
 * scene-local clock. The result is display-only: Scene Timeline can explain
 * what is audible without exposing Master clip move/trim handles.
 */
export function sceneMasterAudioGuideSegments(
  occurrence: Pick<
    ResolvedSequenceItem,
    'masterStart' | 'masterEnd' | 'sourceStart' | 'sourceEnd'
  >,
  soundtracks: readonly MasterAudioNode[],
): SceneMasterAudioGuideSegment[] {
  const result: SceneMasterAudioGuideSegment[] = []
  for (const soundtrack of soundtracks) {
    const sourceDuration = finiteNonNegative(soundtrack.duration)
    const trimStart = clamp(
      finiteNonNegative(soundtrack.trimStart),
      0,
      sourceDuration,
    )
    const trimEnd = clamp(
      Number.isFinite(soundtrack.trimEnd)
        ? soundtrack.trimEnd
        : sourceDuration,
      trimStart,
      sourceDuration,
    )
    const playbackRate =
      Number.isFinite(soundtrack.playbackRate) &&
      soundtrack.playbackRate > 0
        ? soundtrack.playbackRate
        : 1
    const cycleDuration = (trimEnd - trimStart) / playbackRate
    if (cycleDuration <= 0) continue

    const audioMasterStart = finiteNonNegative(soundtrack.startTime)
    const firstCycle = soundtrack.loop
      ? Math.max(
          0,
          Math.floor(
            (occurrence.masterStart - audioMasterStart) / cycleDuration,
          ),
        )
      : 0
    const lastCycle = soundtrack.loop
      ? Math.max(
          firstCycle,
          Math.ceil(
            (occurrence.masterEnd - audioMasterStart) / cycleDuration,
          ) - 1,
        )
      : 0

    for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
      const cycleMasterStart =
        audioMasterStart + cycle * cycleDuration
      const cycleMasterEnd = cycleMasterStart + cycleDuration
      const masterStart = Math.max(
        occurrence.masterStart,
        cycleMasterStart,
      )
      const masterEnd = Math.min(occurrence.masterEnd, cycleMasterEnd)
      if (masterEnd <= masterStart) continue

      const sceneStart = clamp(
        occurrence.sourceStart +
          (masterStart - occurrence.masterStart),
        occurrence.sourceStart,
        occurrence.sourceEnd,
      )
      const sceneEnd = clamp(
        occurrence.sourceStart + (masterEnd - occurrence.masterStart),
        sceneStart,
        occurrence.sourceEnd,
      )
      result.push({
        audioId: soundtrack.id,
        audioName: soundtrack.name,
        sourceStart:
          trimStart + (masterStart - cycleMasterStart) * playbackRate,
        sourceEnd:
          trimStart + (masterEnd - cycleMasterStart) * playbackRate,
        sceneStart,
        sceneEnd,
        masterStart,
        masterEnd,
      })
    }
  }
  return result.sort(
    (left, right) =>
      left.sceneStart - right.sceneStart ||
      left.masterStart - right.masterStart ||
      left.audioId.localeCompare(right.audioId),
  )
}

/**
 * Project the first overlapping Master beat grid onto the selected Scene
 * occurrence. The virtual node is deliberately detached from document writes:
 * callers can reuse the existing beat-marker and snap planners while keeping
 * Master tempo, trim, and subdivision editing on the Master timeline.
 *
 * Retaining each cycle's source beat-grid clock (instead of rebasing partial
 * occurrence edges) preserves the correct containing bar number. Loops are
 * expanded cycle-by-cycle so non-bar-aligned loop lengths, subdivision
 * overrides, and transient evidence repeat at the actual source boundary.
 */
export function projectMasterBeatSourcesToScene(
  occurrence: Pick<
    ResolvedSequenceItem,
    'masterStart' | 'masterEnd' | 'sourceStart' | 'sourceEnd'
  >,
  soundtracks: readonly MasterAudioNode[],
): SceneMasterBeatSource[] {
  const segments = sceneMasterAudioGuideSegments(occurrence, soundtracks)
  for (const soundtrack of soundtracks) {
    if (!soundtrack.beatGrid) continue
    const matchingSegments = segments.filter(
      (segment) => segment.audioId === soundtrack.id,
    )
    if (matchingSegments.length === 0) continue

    const originalDuration = finiteNonNegative(soundtrack.duration)
    return matchingSegments.map((segment, cycleIndex) => ({
      node: {
        ...soundtrack,
        id: `${soundtrack.id}::master-beat::${segment.masterStart}:${cycleIndex}`,
        name: `${soundtrack.name} · Master`,
        // Rebase the virtual clip edge and source in-point together. Beat
        // source time still maps identically, while beat planners are now
        // physically clipped to this cycle/occurrence intersection.
        startTime: segment.sceneStart,
        duration: originalDuration,
        trimStart: segment.sourceStart,
        trimEnd: segment.sourceEnd,
        loop: false,
      },
      sourceAudioId: soundtrack.id,
      visibleSceneRange: {
        start: segment.sceneStart,
        end: segment.sceneEnd,
      },
    }))
  }
  return []
}

/** Backwards-compatible first projected cycle for single-source controls. */
export function projectMasterBeatSourceToScene(
  occurrence: Pick<
    ResolvedSequenceItem,
    'masterStart' | 'masterEnd' | 'sourceStart' | 'sourceEnd'
  >,
  soundtracks: readonly MasterAudioNode[],
): SceneMasterBeatSource | null {
  return projectMasterBeatSourcesToScene(occurrence, soundtracks)[0] ?? null
}

/**
 * Flatten cycle-correct Master notes into Scene-local snap markers.
 * Per-cycle node ids retain identity even when looped bars repeat.
 */
export function projectedMasterBeatMarkers(
  sources: readonly SceneMasterBeatSource[],
): ProjectedMasterBeatMarker[] {
  return sources
    .flatMap((source, sourceIndex) => {
      const node = source.node
      const grid = node.beatGrid
      if (!grid) return []
      const nextSource = sources[sourceIndex + 1]
      const seamOwnedByNextCycle =
        nextSource?.sourceAudioId === source.sourceAudioId &&
        Math.abs(
          nextSource.visibleSceneRange.start -
            source.visibleSceneRange.end,
        ) <= 0.001
      const playbackRate =
        Number.isFinite(node.playbackRate) && node.playbackRate > 0
          ? node.playbackRate
          : 1
      const secondsPerBar =
        (60 / Math.max(1, grid.bpm)) * Math.max(1, grid.beatsPerBar)
      const barCount = Math.max(
        1,
        Math.ceil((node.trimEnd - grid.firstBeatTime) / secondsPerBar),
      )
      return createNoteMarkersForBars(grid, 1, barCount)
        .filter(
          (marker) =>
            marker.time >= node.trimStart - 0.001 &&
            marker.time <= node.trimEnd + 0.001,
        )
        .map((marker) => ({
          ...marker,
          time:
            node.startTime +
            (marker.time - node.trimStart) / playbackRate,
          beatSourceId: node.id,
          sourceAudioId: source.sourceAudioId,
        }))
        .filter(
          (marker) =>
            marker.time >= source.visibleSceneRange.start - 0.001 &&
            (seamOwnedByNextCycle
              ? marker.time < source.visibleSceneRange.end - 0.001
              : marker.time <= source.visibleSceneRange.end + 0.001),
        )
    })
    .sort(
      (left, right) =>
        left.time - right.time ||
        left.beatSourceId.localeCompare(right.beatSourceId),
    )
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
