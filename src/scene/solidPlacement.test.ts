// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from './doc'
import { applyBytesToScene, applyJsonToScene, sceneToBytes, sceneToJson } from './file'
import { UNDOABLE_GESTURE_ORIGIN } from './undo'
import { createProjectAPI } from '@/project/doc'

function fixture() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { name: 'Scene' })
  const group = api.createNode('frame', root, { name: 'Protected asset', preventOverlap: true })
  const part = api.createNode('rect', group, { name: 'Body', extrusion: { depth: 60, sideColor: '#00f' } })
  return { api, root, group, part }
}

describe('optional solid placement protection', () => {
  it('keeps existing nodes opt-out and persists only an explicitly enabled flag', () => {
    const { api, root, group, part } = fixture()
    expect(api.getNode(root)?.preventOverlap).toBeUndefined()
    expect(api.getNode(part)?.preventOverlap).toBeUndefined()
    expect(api.getNode(group)?.preventOverlap).toBe(true)
    const disabled = api.createNode('ellipse', root, { preventOverlap: false })
    const rawNodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    expect(rawNodes.get(disabled)?.has('preventOverlap')).toBe(false)
    api.doc.destroy()
  })

  it('normalizes malformed saved values without accidentally enabling protection', () => {
    const { api, part } = fixture()
    const rawNodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    for (const value of [false, 1, 'true', {}, null]) {
      rawNodes.get(part)!.set('preventOverlap', value)
      expect(api.getNode(part)?.preventOverlap).toBeUndefined()
    }
    api.doc.destroy()
  })

  it('can undo and redo the flag without writing animation tracks or changing a parent flag', () => {
    const { api, group, part } = fixture()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    api.doc.transact(() => api.setNodeProperty(part, 'preventOverlap', true), UNDOABLE_GESTURE_ORIGIN)
    expect(api.getNode(part)?.preventOverlap).toBe(true)
    expect(undo.undoStack).toHaveLength(1)
    undo.undo()
    expect(api.getNode(part)?.preventOverlap).toBeUndefined()
    undo.redo()
    expect(api.getNode(part)?.preventOverlap).toBe(true)
    api.setNodeProperty(part, 'preventOverlap', false)
    expect(api.getNode(part)?.preventOverlap).toBeUndefined()
    expect(api.getNode(group)?.preventOverlap).toBe(true)
    expect(api.getTracksForNode(part)).toEqual([])
    undo.destroy()
    api.doc.destroy()
  })

  it('preserves group and individual flags through binary saves and JSON import', () => {
    const { api, group, part } = fixture()
    api.setNodeProperty(part, 'preventOverlap', true)
    const binary = new Y.Doc()
    applyBytesToScene(binary, sceneToBytes(api.doc))
    const binaryApi = createSceneAPI(binary)
    expect(binaryApi.getNode(group)?.preventOverlap).toBe(true)
    expect(binaryApi.getNode(part)?.preventOverlap).toBe(true)
    const jsonApi = applyJsonToScene(new Y.Doc(), sceneToJson(api))
    const restoredGroup = jsonApi.getChildren(jsonApi.getRoot())[0]!
    expect(restoredGroup.preventOverlap).toBe(true)
    expect(jsonApi.getChildren(restoredGroup.id)[0]?.preventOverlap).toBe(true)
    api.doc.destroy()
    binary.destroy()
    jsonApi.doc.destroy()
  })

  it('copies asset protection with a duplicated composition while leaving the source independent', () => {
    const { api, group } = fixture()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const copy = project.duplicateScene(project.getScenes()[0]!.id)!
    const copiedGroup = api.getChildren(copy.rootNodeId)[0]!
    expect(copiedGroup.id).not.toBe(group)
    expect(copiedGroup.preventOverlap).toBe(true)
    api.setNodeProperty(copiedGroup.id, 'preventOverlap', false)
    expect(api.getNode(group)?.preventOverlap).toBe(true)
    api.doc.destroy()
  })
})
