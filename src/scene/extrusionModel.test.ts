// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { getAnimEngine } from '@/anim/engine'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'
import { createProjectAPI } from '@/project/doc'
import { commitExtrusionDepth, setExtrusionEnabled, supportsExtrusion } from '@/ui/extrusionAuthoring'
import { createSceneAPI } from './doc'
import { applyBytesToScene, applyJsonToScene, sceneToBytes, sceneToJson } from './file'
import { PROPERTIES } from './props'
import type { EllipseNode, Track } from './types'
import { UNDOABLE_GESTURE_ORIGIN } from './undo'

function depthTrack(nodeId: string): Track {
  return {
    id: `depth-${nodeId}`, nodeId, propertyId: 'extrusion.depth', defaultEasing: 'linear', textAnimation: null,
    keyframes: [{ id: 'start', time: 0, value: 0 }, { id: 'end', time: 2, value: 160 }],
  }
}

function scene() {
  const api = createSceneAPI()
  const rootId = api.createNode('frame', null, { name: 'Root', size: { width: 960, height: 540 } })
  return { api, rootId }
}

describe('extrusion model and authoring', () => {
  it('leaves legacy shapes flat and limits settings to supported node kinds', () => {
    const { api, rootId } = scene()
    for (const kind of ['rect', 'ellipse'] as const) {
      const id = api.createNode(kind, rootId, { size: { width: 100, height: 100 } })
      expect(api.getNode(id)?.extrusion).toBeUndefined()
    }
    api.setNodeProperty(rootId, 'extrusion', { depth: 60, sideColor: '#2563eb' })
    expect(api.getNode(rootId)?.extrusion).toBeUndefined()
    api.doc.destroy()
  })
  it('saves geometry settings and animation through JSON and binary reopen', () => {
    const { api, rootId } = scene()
    const id = api.createNode('rect', rootId, {
      size: { width: 120, height: 80 }, extrusion: { depth: 64, sideColor: '#456789' },
    })
    api.setTrack(depthTrack(id))
    const binary = new Y.Doc()
    applyBytesToScene(binary, sceneToBytes(api.doc))
    for (const restored of [createSceneAPI(binary), applyJsonToScene(new Y.Doc(), sceneToJson(api))]) {
      const restoredId = restored.getNode(restored.getRoot())!.children[0]!
      expect(restored.getNode(restoredId)?.extrusion).toEqual({ depth: 64, sideColor: '#456789' })
      expect(restored.getTracksForNode(restoredId)).toEqual([{ ...depthTrack(id), nodeId: restoredId }])
      restored.doc.destroy()
    }
    api.doc.destroy()
  })
  it('copies editable solids and depth tracks with a duplicated composition', () => {
    const { api, rootId } = scene()
    const id = api.createNode('ellipse', rootId, {
      size: { width: 120, height: 80 }, extrusion: { depth: 32, sideColor: '#abcdef' },
    })
    api.setTrack(depthTrack(id))
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const copied = project.duplicateScene(project.getScenes()[0]!.id)!
    const copyId = api.getNode(copied.rootNodeId)!.children[0]!
    expect(copyId).not.toBe(id)
    expect(api.getNode(copyId)?.extrusion).toEqual({ depth: 32, sideColor: '#abcdef' })
    expect(api.getTracksForNode(copyId)).toEqual([
      expect.objectContaining({ nodeId: copyId, propertyId: 'extrusion.depth', keyframes: expect.any(Array) }),
    ])
    api.doc.destroy()
  })
  it('interpolates depth while preserving the stored body settings', () => {
    const { api, rootId } = scene()
    const id = api.createNode('rect', rootId, { extrusion: { depth: 64, sideColor: '#456789' } })
    api.setTrack(depthTrack(id))
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.5)
    expect(engine.getSnapshot()[id]?.extrusionDepth).toBeCloseTo(40)
    expect(api.getNode(id)?.extrusion?.depth).toBe(64)
    expect(PROPERTIES['extrusion.depth']).toMatchObject({ interpolation: 'numeric', layoutAffecting: false })
    expect(keyframeValuesForPatch('extrusion', { depth: 80, sideColor: '#fff' })).toEqual([{ propertyId: 'extrusion.depth', value: 80 }])
    api.doc.destroy()
  })
  it('records depth edits and active tracks with one undoable transaction', () => {
    const { api, rootId } = scene()
    const id = api.createNode('rect', rootId, { extrusion: { depth: 64, sideColor: '#456789' } })
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    commitExtrusionDepth(api, id, 120, 1, true)
    expect(api.getNode(id)?.extrusion?.depth).toBe(120)
    expect(api.getTracksForNode(id)[0]?.keyframes).toEqual([expect.objectContaining({ time: 1, value: 120 })])
    expect(undo.undoStack).toHaveLength(1)
    undo.undo()
    expect(api.getNode(id)?.extrusion?.depth).toBe(64)
    expect(api.getTracksForNode(id)).toEqual([])
    undo.redo()
    commitExtrusionDepth(api, id, 180, 2, false)
    expect(api.getTracksForNode(id)[0]?.keyframes.map(key => [key.time, key.value])).toEqual([[1, 120], [2, 180]])
    undo.destroy()
    api.doc.destroy()
  })
  it('toggles the static body without removing animation or changing the camera', () => {
    const { api, rootId } = scene()
    const id = api.createNode('rect', rootId, {})
    const before = api.getActiveCamera()
    setExtrusionEnabled(api, id, true)
    expect(api.getNode(id)?.extrusion?.depth).toBe(80)
    commitExtrusionDepth(api, id, 90, 1, false)
    expect(api.getTracksForNode(id)).toEqual([])
    api.setTrack(depthTrack(id))
    setExtrusionEnabled(api, id, false)
    expect(api.getNode(id)?.extrusion).toBeUndefined()
    expect(api.getTracksForNode(id)).toEqual([depthTrack(id)])
    setExtrusionEnabled(api, id, true)
    expect(api.getNode(id)?.extrusion).toBeDefined()
    expect(api.getActiveCamera()).toEqual(before)
    api.doc.destroy()
  })
  it('leaves locked layers and their tracks unchanged', () => {
    const { api, rootId } = scene()
    const id = api.createNode('rect', rootId, { extrusion: { depth: 64, sideColor: '#456789' } })
    api.setNodeProperty(id, 'locked', true)
    setExtrusionEnabled(api, id, false)
    commitExtrusionDepth(api, id, 120, 1, true)
    expect(api.getNode(id)?.extrusion).toEqual({ depth: 64, sideColor: '#456789' })
    expect(api.getTracksForNode(id)).toEqual([])
    api.doc.destroy()
  })
  it('does not enable unsupported arcs and preserves saved settings when an ellipse becomes a ring', () => {
    const { api, rootId } = scene()
    const id = api.createNode('ellipse', rootId, { arc: { startAngle: 0, sweep: 0.5, innerRadius: 0 } })
    setExtrusionEnabled(api, id, true)
    expect(api.getNode(id)?.extrusion).toBeUndefined()
    api.setNodeProperty(id, 'arc', { startAngle: 0, sweep: 1, innerRadius: 0 })
    setExtrusionEnabled(api, id, true)
    api.setNodeProperty(id, 'arc', { startAngle: 0, sweep: 1, innerRadius: 0.5 })
    const node = api.getNode(id) as EllipseNode
    expect(supportsExtrusion(node)).toBe(false)
    expect(node.extrusion).toBeDefined()
    expect(supportsExtrusion(node, { arcInnerRadius: 0 })).toBe(true)
    api.doc.destroy()
  })
})
