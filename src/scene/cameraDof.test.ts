// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { getAnimEngine } from '@/anim/engine'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'
import { createSceneAPI } from '@/scene/doc'
import { PROPERTIES } from '@/scene/props'
import type { CameraNode, Track } from '@/scene/types'

function activeCamera(): {
  api: ReturnType<typeof createSceneAPI>
  camera: CameraNode
} {
  const api = createSceneAPI()
  const camera = api.getActiveCamera()
  if (!camera) throw new Error('Expected the default camera')
  return { api, camera }
}

describe('camera depth-of-field model', () => {
  it('reads backward-compatible physical lens defaults from legacy camera maps', () => {
    const { api, camera } = activeCamera()
    const scene = api.doc.getMap<unknown>('scene')
    const nodes = scene.get('nodes') as Y.Map<Y.Map<unknown>>
    const storedCamera = nodes.get(camera.id)
    if (!storedCamera) throw new Error('Expected stored camera map')

    api.doc.transact(() => {
      storedCamera.delete('fStop')
      storedCamera.delete('bladeCount')
      storedCamera.delete('bladeRotation')
      storedCamera.delete('bokehRatio')
      storedCamera.delete('dofPreviewQuality')
      storedCamera.delete('blurQuality')
    })

    expect(api.getActiveCamera()).toMatchObject({
      aperture: 0,
      fStop: 2.8,
      bladeCount: 7,
      bladeRotation: 0,
      bokehRatio: 1,
      dofPreviewQuality: 'balanced',
      blurQuality: 24,
    })
  })

  it('preserves object focus while unrelated scene properties change', () => {
    const { api, camera } = activeCamera()
    const targetId = api.createNode('rect', api.getRoot(), { name: 'Focus target' })
    api.doc.transact(() => {
      api.setNodeProperty(camera.id, 'focusMode', 'target')
      api.setNodeProperty(camera.id, 'focusTargetNodeId', targetId)
    })

    api.setNodeProperty(targetId, 'name', 'Renamed focus target')

    expect(api.getActiveCamera()).toMatchObject({
      focusMode: 'target',
      focusTargetNodeId: targetId,
    })
  })

  it('registers and records every animatable aperture-shape property', () => {
    const values = keyframeValuesForPatch('camera', {
      fStop: 1.4,
      bladeCount: 9,
      bladeRotation: 30,
      bokehRatio: 1.5,
      dofPreviewQuality: 'high',
    })

    expect(values).toEqual([
      { propertyId: 'camera.fStop', value: 1.4 },
      { propertyId: 'camera.bladeCount', value: 9 },
      { propertyId: 'camera.bladeRotation', value: 30 },
      { propertyId: 'camera.bokehRatio', value: 1.5 },
    ])
    expect(PROPERTIES['camera.fStop'].defaultValue).toBe(2.8)
    expect(PROPERTIES['camera.bladeCount'].defaultValue).toBe(7)
    expect(PROPERTIES['camera.bladeRotation'].interpolation).toBe('angle')
    expect(PROPERTIES['camera.bokehRatio'].defaultValue).toBe(1)
    expect(PROPERTIES['camera.blurQuality'].defaultValue).toBe(24)
  })

  it('evaluates physical aperture tracks without mutating static camera values', () => {
    const { api, camera } = activeCamera()
    const tracks: Track[] = [
      ['f-stop', 'camera.fStop', 2.8, 1.4],
      ['blades', 'camera.bladeCount', 6, 10],
      ['blade-rotation', 'camera.bladeRotation', 0, 90],
      ['bokeh-ratio', 'camera.bokehRatio', 1, 2],
    ].map(([id, propertyId, start, end]) => ({
      id: String(id),
      nodeId: camera.id,
      propertyId: propertyId as Track['propertyId'],
      defaultEasing: 'linear',
      keyframes: [
        { id: `${id}-start`, time: 0, value: Number(start) },
        { id: `${id}-end`, time: 1, value: Number(end) },
      ],
    }))
    api.doc.transact(() => {
      for (const track of tracks) api.setTrack(track)
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.5)

    expect(engine.getSnapshot()[camera.id]).toMatchObject({
      bladeCount: 8,
      bladeRotation: 45,
      bokehRatio: 1.5,
    })
    expect(engine.getSnapshot()[camera.id]?.fStop).toBeCloseTo(2.1)
    expect(api.getActiveCamera()).toMatchObject({
      fStop: 2.8,
      bladeCount: 7,
      bladeRotation: 0,
      bokehRatio: 1,
    })
  })
})
