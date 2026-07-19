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

describe('camera lens and post-effects model', () => {
  it('reads backward-compatible camera defaults from legacy camera maps', () => {
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
      storedCamera.delete('chromaticAberrationEnabled')
      storedCamera.delete('chromaticAberrationAmount')
      storedCamera.delete('chromaticAberrationAngle')
      storedCamera.delete('bloomEnabled')
      storedCamera.delete('bloomStrength')
      storedCamera.delete('bloomRadius')
      storedCamera.delete('bloomThreshold')
    })

    expect(api.getActiveCamera()).toMatchObject({
      aperture: 0,
      fStop: 2.8,
      bladeCount: 7,
      bladeRotation: 0,
      bokehRatio: 1,
      dofPreviewQuality: 'balanced',
      blurQuality: 24,
      chromaticAberrationEnabled: false,
      chromaticAberrationAmount: 4,
      chromaticAberrationAngle: 0,
      bloomEnabled: false,
      bloomStrength: 0.8,
      bloomRadius: 0.35,
      bloomThreshold: 0.75,
    })
  })

  it('persists independent post-effect settings on the camera', () => {
    const { api, camera } = activeCamera()

    api.doc.transact(() => {
      api.setNodeProperty(camera.id, 'chromaticAberrationEnabled', true)
      api.setNodeProperty(camera.id, 'chromaticAberrationAmount', 12)
      api.setNodeProperty(camera.id, 'chromaticAberrationAngle', -35)
      api.setNodeProperty(camera.id, 'bloomEnabled', true)
      api.setNodeProperty(camera.id, 'bloomStrength', 1.4)
      api.setNodeProperty(camera.id, 'bloomRadius', 0.6)
      api.setNodeProperty(camera.id, 'bloomThreshold', 0.42)
    })

    expect(api.getActiveCamera()).toMatchObject({
      chromaticAberrationEnabled: true,
      chromaticAberrationAmount: 12,
      chromaticAberrationAngle: -35,
      bloomEnabled: true,
      bloomStrength: 1.4,
      bloomRadius: 0.6,
      bloomThreshold: 0.42,
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

  it('registers and records numeric post-effect properties without keyframing toggles', () => {
    const values = keyframeValuesForPatch('camera', {
      chromaticAberrationEnabled: true,
      chromaticAberrationAmount: 10,
      chromaticAberrationAngle: 45,
      bloomEnabled: true,
      bloomStrength: 1.25,
      bloomRadius: 0.55,
      bloomThreshold: 0.6,
    })

    expect(values).toEqual([
      { propertyId: 'camera.chromaticAberrationAmount', value: 10 },
      { propertyId: 'camera.chromaticAberrationAngle', value: 45 },
      { propertyId: 'camera.bloomStrength', value: 1.25 },
      { propertyId: 'camera.bloomRadius', value: 0.55 },
      { propertyId: 'camera.bloomThreshold', value: 0.6 },
    ])
    expect(PROPERTIES['camera.chromaticAberrationAmount'].defaultValue).toBe(4)
    expect(PROPERTIES['camera.chromaticAberrationAngle'].interpolation).toBe(
      'angle',
    )
    expect(PROPERTIES['camera.bloomStrength'].defaultValue).toBe(0.8)
    expect(PROPERTIES['camera.bloomRadius'].defaultValue).toBe(0.35)
    expect(PROPERTIES['camera.bloomThreshold'].defaultValue).toBe(0.75)
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

  it('evaluates post-effect tracks without mutating static camera values', () => {
    const { api, camera } = activeCamera()
    const tracks: Track[] = [
      ['chromatic-amount', 'camera.chromaticAberrationAmount', 0, 12],
      ['chromatic-angle', 'camera.chromaticAberrationAngle', 0, 90],
      ['bloom-strength', 'camera.bloomStrength', 0.4, 1.6],
      ['bloom-radius', 'camera.bloomRadius', 0.1, 0.7],
      ['bloom-threshold', 'camera.bloomThreshold', 0.2, 0.8],
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
      chromaticAberrationAmount: 6,
      chromaticAberrationAngle: 45,
      bloomStrength: 1,
      bloomRadius: 0.4,
      bloomThreshold: 0.5,
    })
    expect(api.getActiveCamera()).toMatchObject({
      chromaticAberrationAmount: 4,
      chromaticAberrationAngle: 0,
      bloomStrength: 0.8,
      bloomRadius: 0.35,
      bloomThreshold: 0.75,
    })
  })

  it('evaluates every intermediate point-focus position', () => {
    const { api, camera } = activeCamera()
    api.doc.transact(() => {
      api.setTrack({
        id: 'focus-x',
        nodeId: camera.id,
        propertyId: 'camera.focusX',
        defaultEasing: 'linear',
        keyframes: [
          { id: 'focus-x-start', time: 0, value: 100 },
          { id: 'focus-x-end', time: 2, value: 500 },
        ],
      })
      api.setTrack({
        id: 'focus-y',
        nodeId: camera.id,
        propertyId: 'camera.focusY',
        defaultEasing: 'linear',
        keyframes: [
          { id: 'focus-y-start', time: 0, value: 80 },
          { id: 'focus-y-end', time: 2, value: 280 },
        ],
      })
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1)

    expect(engine.getSnapshot()[camera.id]).toMatchObject({
      focusX: 300,
      focusY: 180,
    })
  })
})
