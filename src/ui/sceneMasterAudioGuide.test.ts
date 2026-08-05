// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { MasterAudioNode } from '@/audio/masterAudio'
import { musicalBarSegmentsForRange } from '@/audio/beatSync'
import {
  planKeyframeBeatSync,
  sourceTimeToSceneTime,
} from '@/audio/beatSyncPlan'
import {
  projectMasterBeatSourceToScene,
  projectMasterBeatSourcesToScene,
  projectedMasterBeatMarkers,
  sceneMasterAudioGuideSegments,
} from './sceneMasterAudioGuide'

function soundtrack(
  patch: Partial<MasterAudioNode> = {},
): MasterAudioNode {
  return {
    id: 'soundtrack',
    name: 'Score',
    kind: 'audio',
    parent: null,
    duration: 12,
    trimStart: 2,
    trimEnd: 10,
    playbackRate: 2,
    startTime: 2,
    loop: false,
    ...patch,
  } as MasterAudioNode
}

describe('Scene Master soundtrack guide', () => {
  it('translates a selected occurrence into Scene, Master, and source ranges', () => {
    expect(
      sceneMasterAudioGuideSegments(
        {
          masterStart: 4,
          masterEnd: 7,
          sourceStart: 1,
          sourceEnd: 4,
        },
        [soundtrack()],
      ),
    ).toEqual([
      {
        audioId: 'soundtrack',
        audioName: 'Score',
        sourceStart: 6,
        sourceEnd: 10,
        sceneStart: 1,
        sceneEnd: 3,
        masterStart: 4,
        masterEnd: 6,
      },
    ])
  })

  it('shows repeated source segments for a looping Master soundtrack', () => {
    expect(
      sceneMasterAudioGuideSegments(
        {
          masterStart: 1,
          masterEnd: 4,
          sourceStart: 0,
          sourceEnd: 3,
        },
        [
          soundtrack({
            duration: 1,
            trimStart: 0,
            trimEnd: 1,
            playbackRate: 1,
            startTime: 0,
            loop: true,
          }),
        ],
      ).map((segment) => ({
        source: [segment.sourceStart, segment.sourceEnd],
        scene: [segment.sceneStart, segment.sceneEnd],
        master: [segment.masterStart, segment.masterEnd],
      })),
    ).toEqual([
      { source: [0, 1], scene: [0, 1], master: [1, 2] },
      { source: [0, 1], scene: [1, 2], master: [2, 3] },
      { source: [0, 1], scene: [2, 3], master: [3, 4] },
    ])
  })
})

describe('Scene Master beat source projection', () => {
  const beatGrid = {
    version: 1 as const,
    bpm: 120,
    firstBeatTime: 0,
    beatsPerBar: 4,
    beatUnit: 4 as const,
    swingPercent: 50,
    subdivisions: [],
  }

  it('maps Master beats into Scene-local time without resetting bar numbers', () => {
    const projected = projectMasterBeatSourceToScene(
      {
        masterStart: 8,
        masterEnd: 12,
        sourceStart: 2,
        sourceEnd: 6,
      },
      [
        soundtrack({
          duration: 20,
          trimStart: 0,
          trimEnd: 20,
          playbackRate: 1,
          startTime: 0,
          beatGrid,
        }),
      ],
    )

    expect(projected).not.toBeNull()
    expect(projected!.node.startTime).toBe(2)
    expect(projected!.node.trimStart).toBe(8)
    expect(projected!.node.trimEnd).toBe(12)
    expect(sourceTimeToSceneTime(projected!.node, 8)).toBe(2)
    expect(projected!.visibleSceneRange).toEqual({ start: 2, end: 6 })

    const visibleSourceStart =
      projected!.node.trimStart +
      (projected!.visibleSceneRange.start - projected!.node.startTime)
    const visibleSourceEnd =
      projected!.node.trimStart +
      (projected!.visibleSceneRange.end - projected!.node.startTime)
    expect(
      musicalBarSegmentsForRange(
        projected!.node.beatGrid!,
        visibleSourceStart,
        visibleSourceEnd,
      ).map((segment) => segment.bar),
    ).toEqual([5, 6])
  })

  it('clips the projected source to the audio/occurrence overlap', () => {
    const projected = projectMasterBeatSourceToScene(
      {
        masterStart: 8,
        masterEnd: 12,
        sourceStart: 2,
        sourceEnd: 6,
      },
      [
        soundtrack({
          duration: 10,
          trimStart: 0,
          trimEnd: 10,
          playbackRate: 1,
          startTime: 10,
          beatGrid,
        }),
      ],
    )

    expect(projected?.node.startTime).toBe(4)
    expect(projected?.node.trimStart).toBe(0)
    expect(projected?.node.trimEnd).toBe(2)
    expect(projected?.visibleSceneRange).toEqual({ start: 4, end: 6 })
    expect(
      projectMasterBeatSourceToScene(
        {
          masterStart: 0,
          masterEnd: 4,
          sourceStart: 0,
          sourceEnd: 4,
        },
        [
          soundtrack({
            duration: 2,
            trimStart: 0,
            trimEnd: 2,
            startTime: 8,
            beatGrid,
          }),
        ],
      ),
    ).toBeNull()
  })

  it('keeps selected partial-bar snap targets inside the occurrence clip', () => {
    const projected = projectMasterBeatSourceToScene(
      {
        masterStart: 1,
        masterEnd: 3,
        sourceStart: 4,
        sourceEnd: 6,
      },
      [
        soundtrack({
          duration: 10,
          trimStart: 0,
          trimEnd: 10,
          playbackRate: 1,
          startTime: 0,
          beatGrid,
        }),
      ],
    )!
    const plan = planKeyframeBeatSync({
      grid: projected.node.beatGrid!,
      audio: projected.node,
      tracks: [
        {
          id: 'position-x',
          keyframes: [{ id: 'selected', time: 5.8 }],
        },
      ],
      selectedKeyframeKeys: new Set(['position-x:selected']),
      selectedBars: { startBar: 2, endBar: 2 },
      workAreaRange: projected.visibleSceneRange,
      sceneEndTime: 10,
    })

    expect(plan.ok).toBe(true)
    expect(plan.preview.clipSceneRange).toEqual({ start: 4, end: 6 })
    expect(plan.targets.every((target) => target.targetTime >= 4)).toBe(true)
    expect(plan.targets.every((target) => target.targetTime <= 6)).toBe(true)
  })

  it('projects non-bar-aligned loops cycle-by-cycle with repeating subdivisions', () => {
    const loopingBeatGrid = {
      ...beatGrid,
      subdivisions: [
        {
          id: 'dense-first-bar',
          startBar: 1,
          endBar: 1,
          division: 16 as const,
        },
      ],
    }
    const projected = projectMasterBeatSourcesToScene(
      {
        masterStart: 0,
        masterEnd: 6,
        sourceStart: 0,
        sourceEnd: 6,
      },
      [
        soundtrack({
          duration: 3,
          trimStart: 0,
          trimEnd: 3,
          playbackRate: 1,
          startTime: 0,
          loop: true,
          beatGrid: loopingBeatGrid,
        }),
      ],
    )

    expect(
      projected.map((source) => ({
        range: source.visibleSceneRange,
        startTime: source.node.startTime,
        trim: [source.node.trimStart, source.node.trimEnd],
      })),
    ).toEqual([
      { range: { start: 0, end: 3 }, startTime: 0, trim: [0, 3] },
      { range: { start: 3, end: 6 }, startTime: 3, trim: [0, 3] },
    ])
    expect(
      projected.map((source) =>
        musicalBarSegmentsForRange(
          source.node.beatGrid!,
          source.node.trimStart,
          source.node.trimEnd,
        ).map((segment) => segment.bar),
      ),
    ).toEqual([
      [1, 2],
      [1, 2],
    ])
    expect(sourceTimeToSceneTime(projected[1]!.node, 0)).toBe(3)

    const markers = projectedMasterBeatMarkers(projected)
    const firstCycleTimes = markers
      .filter((marker) => marker.beatSourceId === projected[0]!.node.id)
      .map((marker) => marker.time)
    const secondCycleTimes = markers
      .filter(
        (marker) =>
          marker.beatSourceId === projected[1]!.node.id &&
          marker.time < 6 - 0.001,
      )
      .map((marker) => marker.time - 3)
    expect(secondCycleTimes).toEqual(firstCycleTimes)
    expect(markers.filter((marker) => marker.time === 3)).toEqual([
      expect.objectContaining({
        beatSourceId: projected[1]!.node.id,
        bar: 1,
      }),
    ])
  })
})
