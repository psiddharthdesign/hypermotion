// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { SceneNode } from '@/scene'
import { buildSequenceTimeMap, type CompositionScene } from '@/sequence'
import {
  editMasterAudioClip,
  isMasterAudioNode,
  isSceneTimelineMediaNode,
  masterAudioClipDuration,
  resolveMasterAudioGain,
} from './masterAudio'

function node(
  kind: SceneNode['kind'],
  parent: string | null,
  id = `${kind}-node`,
): SceneNode {
  return { id, kind, parent } as SceneNode
}

describe('Master audio ownership', () => {
  it('recognizes only parentless audio as Master-owned', () => {
    expect(isMasterAudioNode(node('audio', null))).toBe(true)
    expect(isMasterAudioNode(node('audio', 'scene-root'))).toBe(false)
    expect(isMasterAudioNode(node('video', null))).toBe(false)
    expect(isMasterAudioNode(null)).toBe(false)
  })

  it('keeps Master audio out while including scene-owned audio overlays', () => {
    const tree = new Set(['scene-video', 'scene-audio'])
    expect(
      isSceneTimelineMediaNode(node('video', 'scene-root', 'scene-video'), tree),
    ).toBe(true)
    expect(
      isSceneTimelineMediaNode(node('audio', null, 'master-audio'), tree),
    ).toBe(false)
    expect(
      isSceneTimelineMediaNode(node('audio', 'scene-root', 'scene-audio'), tree),
    ).toBe(true)
    expect(
      isSceneTimelineMediaNode(node('video', 'other-root', 'other-video'), tree),
    ).toBe(false)
  })
})

describe('Master audio timeline editing', () => {
  const clip = {
    duration: 12,
    playbackRate: 2,
    startTime: 1,
    trimStart: 2,
    trimEnd: 10,
  }

  it('reports trimmed duration in Master time', () => {
    expect(masterAudioClipDuration(clip)).toBe(4)
  })

  it('moves a clip on frame boundaries without changing source trims', () => {
    expect(editMasterAudioClip(clip, 'move', 1.26, 10, 10)).toEqual({
      startTime: 2.3,
      trimStart: 2,
      trimEnd: 10,
    })
  })

  it('leading-edge trims preserve source alignment at non-unit speed', () => {
    expect(editMasterAudioClip(clip, 'trim-start', 0.5, 10, 10)).toEqual({
      startTime: 1.5,
      trimStart: 3,
      trimEnd: 10,
    })
  })

  it('trailing-edge trims stay inside the source and Master duration', () => {
    expect(editMasterAudioClip(clip, 'trim-end', 4, 6, 10)).toEqual({
      startTime: 1,
      trimStart: 2,
      trimEnd: 12,
    })
    expect(editMasterAudioClip(clip, 'trim-end', -99, 10, 10)).toEqual({
      startTime: 1,
      trimStart: 2,
      trimEnd: 2.2,
    })
  })
})

describe('Master soundtrack occurrence envelope', () => {
  const composition = (id: string): CompositionScene => ({
    id,
    name: id,
    rootNodeId: `${id}-root`,
    duration: 3,
    cameraIds: [],
    defaultCameraId: null,
    cameraCuts: {},
  })

  it('ramps through visual crossfades between unmuted and muted occurrences', () => {
    const map = buildSequenceTimeMap({
      scenes: [composition('audible'), composition('muted')],
      items: [
        {
          id: 'audible-use',
          sceneId: 'audible',
          transitionOut: { kind: 'crossfade', duration: 1 },
        },
        {
          id: 'muted-use',
          sceneId: 'muted',
          masterAudioMuted: true,
        },
      ],
      frameRate: 30,
    })

    expect(resolveMasterAudioGain(map, 1)).toBe(1)
    expect(resolveMasterAudioGain(map, 2.25)).toBeCloseTo(0.75)
    expect(resolveMasterAudioGain(map, 2.5)).toBeCloseTo(0.5)
    expect(resolveMasterAudioGain(map, 2.75)).toBeCloseTo(0.25)
    expect(resolveMasterAudioGain(map, 3.25)).toBe(0)
  })

  it('never doubles two enabled occurrences during a crossfade', () => {
    const map = buildSequenceTimeMap({
      scenes: [composition('one'), composition('two')],
      items: [
        {
          id: 'one-use',
          sceneId: 'one',
          transitionOut: { kind: 'crossfade', duration: 1 },
        },
        { id: 'two-use', sceneId: 'two' },
      ],
      frameRate: 30,
    })

    expect(resolveMasterAudioGain(map, 2.5)).toBe(1)
    expect(resolveMasterAudioGain(map, -0.1)).toBe(0)
    expect(resolveMasterAudioGain(map, map.duration + 0.1)).toBe(0)
  })
})
