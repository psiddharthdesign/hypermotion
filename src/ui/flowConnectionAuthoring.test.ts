// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { applyBytesToScene, sceneToBytes } from '@/scene/file'
import { DEFAULT_FLOW_CONNECTION } from '@/scene/flowConnection'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { createIsometricAsset } from './isometricAssetAuthoring'
import { commitFlowConnectionPatch, createFlowConnection, swapFlowConnectionEndpoints, validateFlowConnectionSelection } from './flowConnectionAuthoring'

function scene() {
  const api = createSceneAPI()
  api.createNode('frame', null, { name: 'Scene', size: { width: 960, height: 540 } })
  const source = createIsometricAsset(api, 'server', { center: { x: 240, y: 270 } })
  const target = createIsometricAsset(api, 'platform', { center: { x: 720, y: 270 } })
  return { api, source, target }
}

describe('flow connection authoring', () => {
  it('creates an attached vector above the scene layout without changing either asset or its camera', () => {
    const { api, source, target } = scene()
    const sourceBefore = api.getNode(source)
    const targetBefore = api.getNode(target)
    const cameraBefore = api.getActiveCamera()
    const id = createFlowConnection(api, [source, target])
    expect(api.getNode(id)).toMatchObject({
      kind: 'vector', name: 'Server stack → Platform', parent: api.getRoot(), position: 'absolute',
      size: { width: 1, height: 1 }, appearance: { fill: null, stroke: null },
      transform: { x: 0, y: 0, z: 0, renderMode: 'plane' },
      connection: { ...DEFAULT_FLOW_CONNECTION, sourceId: source, targetId: target },
    })
    expect(api.getChildren(api.getRoot()).map(node => node.id)).toContain(id)
    expect(api.getNode(source)).toEqual(sourceBefore)
    expect(api.getNode(target)).toEqual(targetBefore)
    expect(api.getActiveCamera()).toEqual(cameraBefore)
    api.doc.destroy()
  })

  it('preserves first-selected flow direction and ignores duplicate selection IDs', () => {
    const { api, source, target } = scene()
    expect(validateFlowConnectionSelection(api, [target, source, target])).toEqual({ valid: true, sourceId: target, targetId: source, parentId: api.getRoot() })
    const id = createFlowConnection(api, [target, source])
    expect(api.getNode(id)?.connection).toMatchObject({ sourceId: target, targetId: source })
    api.doc.destroy()
  })

  it('rejects invalid selection counts without a partial write', () => {
    const { api, source, target } = scene()
    const third = api.createNode('rect', api.getRoot())
    const before = sceneToBytes(api.doc)
    for (const selected of [[], [source], [source, source], [source, target, third]]) {
      expect(() => createFlowConnection(api, selected)).toThrow('Select two assets')
      expect(sceneToBytes(api.doc)).toEqual(before)
    }
    api.doc.destroy()
  })

  it('rejects scene, camera, audio, controllers, missing and existing-connection endpoints', () => {
    const { api, source, target } = scene()
    const audio = api.createNode('audio', api.getRoot())
    const camera = api.getActiveCameraId() ?? api.createNode('camera', null)
    const connection = createFlowConnection(api, [source, target])
    const nullController = api.createNode('null', api.getRoot())
    const arrangement = api.createNode('arrangement', api.getRoot())
    const before = api.getAllNodeIds()
    for (const rejected of [api.getRoot(), camera, audio, nullController, arrangement, 'missing', connection]) {
      expect(validateFlowConnectionSelection(api, [source, rejected])).toMatchObject({ valid: false })
      expect(() => createFlowConnection(api, [source, rejected])).toThrow('Choose two visual assets')
    }
    expect(api.getAllNodeIds()).toEqual(before)
    api.doc.destroy()
  })

  it('rejects ancestor/descendant pairs instead of silently connecting an asset to itself', () => {
    const { api, source } = scene()
    const descendant = api.getChildren(api.getChildren(source)[0]!.id)[0]!.id
    for (const selection of [[source, descendant], [descendant, source]]) {
      expect(() => createFlowConnection(api, selection)).toThrow('two separate assets')
    }
    api.doc.destroy()
  })

  it('respects asset and containing-group visibility and locks', () => {
    const { api, source, target } = scene()
    const part = api.getChildren(api.getChildren(source)[0]!.id)[0]!.id
    for (const id of [part, source]) {
      api.setNodeProperty(id, 'locked', true)
      expect(() => createFlowConnection(api, [part, target])).toThrow('visible, unlocked assets')
      api.setNodeProperty(id, 'locked', false)
      api.setNodeProperty(id, 'visible', false)
      expect(() => createFlowConnection(api, [part, target])).toThrow('visible, unlocked assets')
      api.setNodeProperty(id, 'visible', true)
    }
    expect(validateFlowConnectionSelection(api, [part, target])).toMatchObject({ valid: true })
    api.doc.destroy()
  })

  it('rejects pasteboard assets and nodes outside the active scene', () => {
    const { api, source, target } = scene()
    const elsewhere = api.createNode('rect', null)
    expect(() => createFlowConnection(api, [source, elsewhere])).toThrow('inside the current scene')
    api.setNodeProperty(target, 'workspaceOnly', true)
    expect(() => createFlowConnection(api, [source, target])).toThrow('inside the current scene')
    api.doc.destroy()
  })

  it('undoes and redoes creation as one gesture with no asset loss', () => {
    const { api, source, target } = scene()
    const before = api.getAllNodeIds()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    const id = createFlowConnection(api, [source, target])
    expect(undo.undoStack).toHaveLength(1)
    undo.undo()
    expect(api.getAllNodeIds()).toEqual(before)
    undo.redo()
    expect(api.getNode(id)?.connection).toMatchObject({ sourceId: source, targetId: target })
    undo.destroy()
    api.doc.destroy()
  })

  it('records normalized field edits and the base value in the same undo step', () => {
    const { api, source, target } = scene()
    const id = createFlowConnection(api, [source, target])
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    commitFlowConnectionPatch(api, id, { width: 300, flowSpeed: -360, flowPhase: 0.5, color: '#abcdef' }, 1, true)
    expect(api.getNode(id)?.connection).toMatchObject({ width: 128, flowSpeed: -360, flowPhase: 0.5, color: '#abcdef' })
    expect(api.getTracksForNode(id).map(track => [track.propertyId, track.keyframes.map(key => [key.time, key.value])])).toEqual([
      ['connection.width', [[1, 128]]], ['connection.flowSpeed', [[1, -360]]], ['connection.flowPhase', [[1, 0.5]]],
    ])
    expect(undo.undoStack).toHaveLength(1)
    undo.undo()
    expect(api.getNode(id)?.connection).toMatchObject(DEFAULT_FLOW_CONNECTION)
    expect(api.getTracksForNode(id)).toEqual([])
    undo.redo()
    expect(api.getNode(id)?.connection?.flowPhase).toBe(0.5)
    expect(api.getTracksForNode(id)).toHaveLength(3)
    undo.destroy()
    api.doc.destroy()
  })

  it('updates an existing animated property at the playhead but does not key unanimated settings', () => {
    const { api, source, target } = scene()
    const id = createFlowConnection(api, [source, target])
    commitFlowConnectionPatch(api, id, { width: 8 }, 0, true)
    commitFlowConnectionPatch(api, id, { width: 12, flowSpeed: 240, flowEnabled: false }, 2, false)
    const tracks = api.getTracksForNode(id)
    expect(tracks).toHaveLength(1)
    expect(tracks[0]!.keyframes.map(key => [key.time, key.value])).toEqual([[0, 8], [2, 12]])
    expect(api.getNode(id)?.connection).toMatchObject({ flowSpeed: 240, flowEnabled: false })
    api.doc.destroy()
  })

  it('swaps only the endpoints and preserves style, timing and authored keys', () => {
    const { api, source, target } = scene()
    const id = createFlowConnection(api, [source, target])
    commitFlowConnectionPatch(api, id, { routing: 'straight', flowPhase: 0.7, flowSpeed: -80 }, 1, true)
    const before = api.getNode(id)!.connection!
    const tracks = api.getTracksForNode(id)
    swapFlowConnectionEndpoints(api, id)
    expect(api.getNode(id)?.connection).toEqual({ ...before, sourceId: target, targetId: source })
    expect(api.getTracksForNode(id)).toEqual(tracks)
    api.doc.destroy()
  })

  it('does not edit locked or non-connection layers', () => {
    const { api, source, target } = scene()
    const id = createFlowConnection(api, [source, target])
    api.setNodeProperty(id, 'locked', true)
    const before = sceneToBytes(api.doc)
    for (const selected of [id, source, 'missing']) {
      commitFlowConnectionPatch(api, selected, { width: 24, flowPhase: 0.2 }, 1, true)
      swapFlowConnectionEndpoints(api, selected)
    }
    expect(sceneToBytes(api.doc)).toEqual(before)
    api.doc.destroy()
  })

  it('preserves the attached connection and its keys when reopened', () => {
    const { api, source, target } = scene()
    const id = createFlowConnection(api, [source, target])
    commitFlowConnectionPatch(api, id, { flowPhase: 0.75, flowSpacing: 200, flowSize: 20 }, 2, true)
    const reopened = new Y.Doc()
    applyBytesToScene(reopened, sceneToBytes(api.doc))
    const restored = createSceneAPI(reopened)
    expect(restored.getNode(id)?.connection).toEqual(api.getNode(id)?.connection)
    expect(restored.getTracksForNode(id)).toEqual(api.getTracksForNode(id))
    reopened.destroy()
    api.doc.destroy()
  })
})
