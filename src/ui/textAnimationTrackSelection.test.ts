// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  applyTextAnimation,
  getAnimEngine,
  normalizeTextAnimation,
} from '@/anim'
import { createSceneAPI } from '@/scene/doc'
import { selectTextAnimationTrackForAuthoring } from './textAnimationTrackSelection'

describe('text preset track authoring selection', () => {
  it('stamps a new preset clip when the sole existing clip is elsewhere', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Motion' })
    applyTextAnimation(api, nodeId, 'fade', 0)
    const existing = api.getTracksForNode(nodeId)[0]!

    const target = selectTextAnimationTrackForAuthoring(
      api.getTracksForNode(nodeId),
      undefined,
      3,
    )
    expect(target).toBeNull()

    const node = api.getNode(nodeId)
    const priorNodeConfig = normalizeTextAnimation(
      node?.kind === 'text' ? node.textAnimation : null,
    )
    applyTextAnimation(api, nodeId, 'blur-slide', 3, priorNodeConfig, {
      trackId: target?.id,
    })
    const tracks = api.getTracksForNode(nodeId)
    expect(tracks).toHaveLength(2)
    expect(api.getTrack(existing.id)?.textAnimation?.id).toBe('fade')
    expect(
      tracks.find((track) => track.id !== existing.id)?.textAnimation,
    ).toMatchObject({ id: 'blur-slide', startTime: 3 })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.25)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.id).toBe('fade')
    engine.seek(3.25)
    expect(engine.getSnapshot()[nodeId]?.textAnimation?.id).toBe(
      'blur-slide',
    )
  })

  it('preserves explicit timeline editing and exact-at-start replacement', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Selected clip' })
    applyTextAnimation(api, nodeId, 'slide-up', 1)
    const existing = api.getTracksForNode(nodeId)[0]!

    expect(
      selectTextAnimationTrackForAuthoring(
        [existing],
        new Set([existing.id]),
        8,
      )?.id,
    ).toBe(existing.id)

    const atStart = selectTextAnimationTrackForAuthoring(
      [existing],
      undefined,
      1,
    )
    expect(atStart?.id).toBe(existing.id)
    applyTextAnimation(api, nodeId, 'flip', 1, existing.textAnimation, {
      trackId: atStart?.id,
    })

    expect(api.getTracksForNode(nodeId)).toHaveLength(1)
    expect(api.getTrack(existing.id)?.textAnimation).toMatchObject({
      id: 'flip',
      startTime: 1,
    })
  })
})
