// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { solveLayout, yogaReady } from '@/layout/engine'
import { createIsometricAsset } from './isometricAssetAuthoring'

function scene() {
  const api = createSceneAPI()
  api.createNode('frame', null, { size: { width: 960, height: 540 } })
  return api
}

describe('isometric starter assets', () => {
  it('inserts an editable extruded block without touching the camera or other layers', () => {
    const api = scene()
    const rootId = api.getRoot()
    const previous = api.getAllNodeIds()
    const camera = api.getActiveCamera()
    const id = createIsometricAsset(api, 'block')
    const group = api.getNode(id)!
    expect(group.parent).toBe(rootId)
    expect(group.transform.renderMode).toBe('group3d')
    expect(group.position).toBe('absolute')
    expect(api.getChildren(id)).toEqual([
      expect.objectContaining({ kind: 'rect', name: 'Block body', extrusion: { depth: 96, sideColor: '#3787EF' } }),
    ])
    expect(api.getAllNodeIds()).toEqual(expect.arrayContaining(previous))
    expect(api.getActiveCamera()).toEqual(camera)
    const canvas = api.getMeta().canvas
    expect(group.transform.x).toBe(canvas.width / 2 - 80)
    expect(group.transform.y).toBe(canvas.height / 2 - 80)
  })

  it('creates a circular platform whose depth remains editable', () => {
    const api = scene()
    const id = createIsometricAsset(api, 'platform', { center: { x: 200, y: 240 } })
    const body = api.getChildren(id)[0]!
    expect(body.kind).toBe('ellipse')
    expect(body.extrusion?.depth).toBe(24)
    expect(body.transform.z + body.extrusion!.depth).toBe(0)
    api.setNodeProperty(body.id, 'extrusion', { depth: 56, sideColor: '#112233' })
    expect(api.getNode(body.id)?.extrusion).toEqual({ depth: 56, sideColor: '#112233' })
    expect(api.getNode(id)?.transform).toMatchObject({ x: 120, y: 160 })
  })

  it('builds a server from four auto-layout modules with separate editable face details', async () => {
    const api = scene()
    const id = createIsometricAsset(api, 'server')
    const group = api.getNode(id)!
    expect(group.kind === 'frame' && group.layout).toMatchObject({ mode: 'flex', direction: 'column', gap: 8 })
    expect(group.transform).toMatchObject({ rotationX: -90, z: -100 })
    const modules = api.getChildren(id)
    expect(modules).toHaveLength(4)
    for (const module of modules) {
      expect(module.transform.renderMode).toBe('group3d')
      const parts = api.getChildren(module.id)
      expect(parts.map((part) => part.name)).toEqual(['Housing', 'Drive bay', 'Status light'])
      expect(parts[0]?.extrusion?.depth).toBe(96)
      expect(parts.slice(1).every((part) => part.transform.z < 0 && part.extrusion?.depth === 0)).toBe(true)
    }
    const solved = solveLayout(await yogaReady, api, api.getRoot(), api.getMeta().canvas)
    expect(modules.map((module) => solved[module.id]!.width)).toEqual([160, 160, 160, 160])
    expect(modules.map((module) => solved[module.id]!.y - solved[id]!.y)).toEqual([0, 52, 104, 156])
  })

  it('undoes and redoes the complete server in one gesture', () => {
    const api = scene()
    const before = api.getAllNodeIds()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    const id = createIsometricAsset(api, 'server')
    const authored = api.getAllNodeIds()
    undo.undo()
    expect(api.getAllNodeIds()).toEqual(before)
    undo.redo()
    expect(api.getAllNodeIds()).toEqual(authored)
    expect(api.getChildren(id)).toHaveLength(4)
    undo.destroy()
  })

  it('rejects invalid parents without partially writing the asset', () => {
    const api = scene()
    const parentId = api.createNode('rect', api.getRoot())
    const before = api.getAllNodeIds()
    expect(() => createIsometricAsset(api, 'block', { parentId })).toThrow('unlocked frame')
    expect(api.getAllNodeIds()).toEqual(before)
  })
})
