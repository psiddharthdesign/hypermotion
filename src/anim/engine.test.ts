// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { Track } from '@/scene'
import { getAnimEngine } from '@/anim/engine'

describe('animation engine track preview', () => {
  it('publishes intermediate opacity for a 0 to 1 fade track', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    api.setTrack({
      id: 'opacity-track',
      nodeId,
      propertyId: 'appearance.opacity',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 1, value: 1 },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)

    engine.seek(0)
    expect(engine.getSnapshot()[nodeId]?.opacity).toBe(0)
    engine.seek(0.25)
    expect(engine.getSnapshot()[nodeId]?.opacity).toBeCloseTo(0.25)
    engine.seek(0.5)
    expect(engine.getSnapshot()[nodeId]?.opacity).toBeCloseTo(0.5)
    engine.seek(1)
    expect(engine.getSnapshot()[nodeId]?.opacity).toBe(1)
  })

  it('evaluates transient keyframe timing without mutating the scene', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('rect', null)
    const authored: Track = {
      id: 'position-track',
      nodeId,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 2, value: 100 },
      ],
    }
    api.setTrack(authored)

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(50)

    const preview: Track = {
      ...authored,
      keyframes: authored.keyframes.map((keyframe) =>
        keyframe.id === 'end' ? { ...keyframe, time: 4 } : keyframe,
      ),
    }
    const versionBeforePreview = api.getVersion()
    engine.setTrackPreview(new Map([[preview.id, preview]]))

    expect(api.getVersion()).toBe(versionBeforePreview)
    expect(api.getTrack(authored.id)?.keyframes[1]?.time).toBe(2)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(25)

    // A durable write made while the preview is active stays hidden until the
    // gesture clears its overlay, then becomes the new evaluated source.
    api.setTrack({
      ...authored,
      keyframes: authored.keyframes.map((keyframe) =>
        keyframe.id === 'end' ? { ...keyframe, time: 8 } : keyframe,
      ),
    })
    expect(engine.getSnapshot()[nodeId]?.x).toBe(25)

    engine.setTrackPreview(null)
    expect(engine.getSnapshot()[nodeId]?.x).toBe(12.5)
  })
})
