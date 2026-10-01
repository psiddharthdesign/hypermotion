// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { addKeyframe } from '@/anim/tracks'
import { getAnimEngine } from '@/anim/engine'
import { applyIsometricLoop } from './isometricLoopAuthoring'

afterEach(() => getAnimEngine().pause())

function setup() {
  const api = createSceneAPI()
  api.setMeta({ duration: 4, frameRate: 60 })
  api.createNode('frame', null)
  const id = api.createNode('frame', api.getRoot())
  const node = api.getNode(id)!
  api.setNodeProperty(id, 'transform', { ...node.transform, z: 20, rotation: 30, renderMode: 'group3d' })
  return { api, id }
}

describe('editable isometric motion loops', () => {
  it('closes a floating cycle at the exclusive end and renders the midpoint', () => {
    const { api, id } = setup()
    const result = applyIsometricLoop(api, [id], { kind: 'float', startTime: 0, duration: 4, amplitude: 64 })
    expect(result.status).toBe('applied')
    const track = api.getTracksForNode(id)[0]!
    expect(track.propertyId).toBe('transform.z')
    expect(track.keyframes.map(({ time, value }) => [time, value])).toEqual([[0, 20], [2, -44], [4, 20]])
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(2)
    expect(engine.getSnapshot()[id]?.z).toBe(-44)
    engine.seek(4 - 1 / 60)
    expect(engine.getSnapshot()[id]?.z).toBeLessThan(20)
    engine.seek(4)
    expect(engine.getSnapshot()[id]?.z).toBe(20)
  })

  it('spins once at constant speed and preserves the original rotation offset', () => {
    const { api, id } = setup()
    applyIsometricLoop(api, [id], { kind: 'spin', startTime: 0, duration: 4 })
    const track = api.getTracksForNode(id)[0]!
    expect(track.defaultEasing).toBe('linear')
    expect(track.keyframes.map(({ value }) => value)).toEqual([30, 390])
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1)
    expect(engine.getSnapshot()[id]?.rotation).toBe(120)
  })

  it('does not overwrite an existing movement or partially apply a multi-selection', () => {
    const { api, id } = setup()
    const second = api.createNode('rect', api.getRoot())
    addKeyframe(api, id, 'transform.z', 0, 100)
    addKeyframe(api, id, 'transform.z', 1, 200)
    const before = api.getAllTracks()
    expect(applyIsometricLoop(api, [second, id], { kind: 'float', startTime: 0, duration: 4 })).toMatchObject({ status: 'conflict', nodeIds: [id] })
    expect(api.getAllTracks()).toEqual(before)
  })

  it('explicit replacement keeps unrelated keys and undoes in one step', () => {
    const { api, id } = setup()
    addKeyframe(api, id, 'transform.z', 0, 100)
    addKeyframe(api, id, 'transform.z', 1, 200)
    addKeyframe(api, id, 'appearance.opacity', 0, 0)
    addKeyframe(api, id, 'appearance.opacity', 1, 1)
    const before = api.getAllTracks()
    const opacity = before.find((track) => track.propertyId === 'appearance.opacity')
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    expect(applyIsometricLoop(api, [id], { kind: 'float', startTime: 0, duration: 4, replaceExisting: true }).status).toBe('applied')
    expect(api.getTrack(opacity!.id)).toEqual(opacity)
    undo.undo()
    expect(api.getAllTracks()).toEqual(before)
    undo.destroy()
  })

  it('animates a selected parent only once instead of doubling a selected child movement', () => {
    const { api, id } = setup()
    const child = api.createNode('rect', id)
    const result = applyIsometricLoop(api, [id, child, id], { kind: 'spin', axis: 'y', startTime: 0, duration: 4 })
    expect(result.status).toBe('applied')
    expect(api.getAllTracks()).toHaveLength(1)
    expect(api.getAllTracks()[0]).toMatchObject({ nodeId: id, propertyId: 'transform.rotationY' })
  })

  it('removes stale stagger and grouped-key references only for replaced keys', () => {
    const { api, id } = setup()
    const old = addKeyframe(api, id, 'transform.z', 0, 100)
    const other = addKeyframe(api, id, 'appearance.opacity', 0, 0.5)
    const tracks = api.getTracksForNode(id)
    const z = tracks.find((track) => track.propertyId === 'transform.z')!
    const opacity = tracks.find((track) => track.propertyId === 'appearance.opacity')!
    api.setUiState({
      kfGroups: { oldGroup: [`${z.id}:${old.id}`, `${opacity.id}:${other.id}`] },
      kfGroupCollapsed: { oldGroup: true },
      staggerSets: {
        mixed: { id: 'mixed', delay: 0.1, order: 'forward', layerIds: [id], members: { [id]: { 'transform.z': [old.id], 'appearance.opacity': [other.id] } } },
      },
    })
    applyIsometricLoop(api, [id], { kind: 'float', startTime: 0, duration: 4, replaceExisting: true })
    expect(api.getUiState().kfGroups).toEqual({})
    expect(api.getUiState().kfGroupCollapsed).toEqual({})
    expect(api.getUiState().staggerSets.mixed?.members[id]).toEqual({ 'appearance.opacity': [other.id] })
    expect(api.getTrack(opacity.id)?.keyframes[0]?.id).toBe(other.id)
  })

  it('rejects an out-of-scene cycle and locked targets without mutations', () => {
    const { api, id } = setup()
    expect(applyIsometricLoop(api, [id], { kind: 'float', startTime: 2, duration: 4 }).status).toBe('invalid')
    api.setNodeProperty(id, 'locked', true)
    expect(applyIsometricLoop(api, [id], { kind: 'spin', startTime: 0, duration: 4 }).status).toBe('invalid')
    expect(api.getAllTracks()).toEqual([])
  })
})
