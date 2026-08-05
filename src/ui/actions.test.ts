// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { setLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import { ungroupFrame, wrapInGroup } from './actions'

const transform = (x: number, y: number) => ({
  x,
  y,
  z: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
})

function fixture() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, {
    name: 'Root',
    size: { width: 800, height: 600 },
    layout: {
      mode: 'none',
      direction: 'row',
      justify: 'start',
      align: 'start',
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      wrap: false,
      columns: 1,
      rowGap: 0,
      columnGap: 0,
    },
  })
  const first = api.createNode('rect', root, {
    name: 'First',
    size: { width: 10, height: 10 },
    transform: transform(2, 4),
  })
  const second = api.createNode('rect', root, {
    name: 'Second',
    size: { width: 40, height: 20 },
    transform: transform(20, 30),
  })
  const third = api.createNode('rect', root, {
    name: 'Third',
    size: { width: 30, height: 50 },
    transform: transform(80, 10),
  })
  setLastSolvedLayout({
    [root]: { x: 0, y: 0, width: 800, height: 600 },
    [first]: { x: 0, y: 0, width: 10, height: 10 },
    [second]: { x: 0, y: 0, width: 40, height: 20 },
    [third]: { x: 0, y: 0, width: 30, height: 50 },
  })
  return { api, root, first, second, third }
}

afterEach(() => setLastSolvedLayout(null))

describe('wrapInGroup', () => {
  it('preserves geometry, sibling order, and animated transform values', () => {
    const { api, root, first, second, third } = fixture()
    api.setTrack({
      id: 'second-x',
      nodeId: second,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'x0', time: 0, value: 20 },
        { id: 'x1', time: 1, value: 100 },
      ],
    })

    const groupId = wrapInGroup(api, [third, second])
    expect(groupId).not.toBeNull()
    const group = api.getNode(groupId!)

    expect(api.getChildren(root).map((node) => node.id)).toEqual([
      first,
      groupId,
    ])
    expect(group).toMatchObject({
      kind: 'frame',
      name: 'Group',
      size: { width: 90, height: 50 },
      transform: { x: 20, y: 10 },
      appearance: { fill: null, stroke: null },
      clipsContent: false,
      layout: { mode: 'none' },
    })
    expect(api.getChildren(groupId!).map((node) => node.id)).toEqual([
      second,
      third,
    ])
    expect(api.getNode(second)?.transform).toMatchObject({ x: 0, y: 20 })
    expect(api.getNode(third)?.transform).toMatchObject({ x: 60, y: 0 })
    expect(api.getTrack('second-x')?.keyframes.map((keyframe) => keyframe.value)).toEqual([
      0,
      80,
    ])
    api.doc.destroy()
  })

  it('rejects mixed, missing, root, and camera selections without partial edits', () => {
    const { api, root, first, second } = fixture()
    const otherParent = api.createNode('frame', root, { name: 'Other' })
    const otherChild = api.createNode('rect', otherParent, { name: 'Other child' })
    const camera = api.createNode('camera', null, { name: 'Camera' })
    const before = api.getAllNodeIds()

    expect(wrapInGroup(api, [first, otherChild])).toBeNull()
    expect(wrapInGroup(api, [first, 'missing'])).toBeNull()
    expect(wrapInGroup(api, [root])).toBeNull()
    expect(wrapInGroup(api, [camera])).toBeNull()
    expect(api.getAllNodeIds()).toEqual(before)
    expect(api.getChildren(root).map((node) => node.id)).toContain(second)
    api.doc.destroy()
  })

  it('ungroups without moving layers and restores shifted animation values', () => {
    const { api, root, first, second, third } = fixture()
    api.setTrack({
      id: 'second-x',
      nodeId: second,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [{ id: 'x0', time: 0, value: 75 }],
    })
    const groupId = wrapInGroup(api, [second, third])!
    setLastSolvedLayout({
      [root]: { x: 0, y: 0, width: 800, height: 600 },
      [groupId]: { x: 0, y: 0, width: 90, height: 50 },
      [second]: { x: 0, y: 0, width: 40, height: 20 },
      [third]: { x: 0, y: 0, width: 30, height: 50 },
    })

    expect(ungroupFrame(api, groupId)).toEqual([second, third])
    expect(api.getChildren(root).map((node) => node.id)).toEqual([
      first,
      second,
      third,
    ])
    expect(api.getNode(second)?.transform).toMatchObject({ x: 20, y: 30 })
    expect(api.getNode(third)?.transform).toMatchObject({ x: 80, y: 10 })
    expect(api.getTrack('second-x')?.keyframes[0]?.value).toBe(75)
    api.doc.destroy()
  })

  it('wraps as one undoable scene-graph edit', () => {
    const { api, root, first, second, third } = fixture()
    const scene = api.doc.getMap('scene')
    const undo = new Y.UndoManager(
      [
        scene,
        scene.get('nodes') as Y.Map<unknown>,
        scene.get('tracks') as Y.Map<unknown>,
      ],
      { trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]) },
    )

    const groupId = wrapInGroup(api, [second, third])!
    expect(api.getNode(groupId)).not.toBeNull()

    undo.undo()
    expect(api.getNode(groupId)).toBeNull()
    expect(api.getChildren(root).map((node) => node.id)).toEqual([
      first,
      second,
      third,
    ])
    expect(api.getNode(second)?.transform).toMatchObject({ x: 20, y: 30 })

    undo.redo()
    expect(api.getNode(groupId)).not.toBeNull()
    expect(api.getChildren(groupId).map((node) => node.id)).toEqual([
      second,
      third,
    ])
    undo.destroy()
    api.doc.destroy()
  })
})
