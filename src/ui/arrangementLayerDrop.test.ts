// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { createArrangement } from '@/scene/arrangementActions'
import { solveLayout, yogaReady } from '@/layout/engine'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { dropLayersIntoArrangement, layerDragSelection } from './arrangementLayerDrop'
import { layerPanelChildren, layerPanelParent } from './arrangementLayerTree'

async function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const arrangement = createArrangement(api, [], {})!
  const first = api.createNode('rect', root)
  const second = api.createNode('ellipse', root)
  const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
  return { api, root, arrangement, first, second, layout }
}

describe('arrangement layer drops', () => {
  it('adds a complete selection to an arrangement in one undoable action', async () => {
    const { api, root, arrangement, first, second, layout } = await setup()
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    expect(dropLayersIntoArrangement(api, arrangement, [first, second], 'into', layout)).toEqual([first, second])
    expect(api.getNode(arrangement)!.arrangement!.memberIds.slice(-2)).toEqual([first, second])
    for (const id of [first, second]) {
      expect(layerPanelParent(api, api.getNode(id)!)).toBe(arrangement)
      expect(api.getNode(id)!.parent).toBe(root)
    }
    undo.undo()
    for (const id of [first, second]) expect(api.getNode(id)!.transformParent).toBeNull()
    undo.destroy()
  })

  it('moves cards between arrangements and reorders a selected block', async () => {
    const { api, root, arrangement, first, second } = await setup()
    const other = createArrangement(api, [], {})!
    const members = api.getNode(other)!.arrangement!.memberIds
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    dropLayersIntoArrangement(api, members[1]!, [first, second], 'above', layout)
    expect(api.getNode(other)!.arrangement!.memberIds.slice(0, 4)).toEqual([members[0], first, second, members[1]])
    dropLayersIntoArrangement(api, arrangement, [first, second], 'into', layout)
    expect(api.getNode(other)!.arrangement!.memberIds).toEqual(members)
    const target = api.getNode(arrangement)!.arrangement!.memberIds[0]!
    dropLayersIntoArrangement(api, target, [first, second], 'above', layout)
    expect(api.getNode(arrangement)!.arrangement!.memberIds.slice(0, 3)).toEqual([first, second, target])
  })

  it('honors locks and filters selected descendants from the drag payload', async () => {
    const { api, arrangement, first, second, layout } = await setup()
    const child = api.createNode('text', first)
    expect(layerDragSelection(api, first, [first, child, second])).toEqual([first, second])
    expect(layerDragSelection(api, first, [second])).toEqual([first])
    api.setNodeProperty(arrangement, 'locked', true)
    expect(dropLayersIntoArrangement(api, arrangement, [first, second], 'into', layout)).toEqual([])
    expect(api.getNode(first)!.transformParent).toBeNull()
  })

  it('recognizes nested arrangement membership without showing cards outside it', async () => {
    const { api, root, arrangement, first, second, layout } = await setup()
    const container = api.createNode('frame', root)
    api.appendChild(container, arrangement)
    expect(dropLayersIntoArrangement(api, arrangement, [first, second], 'into', layout)).toEqual([first, second])
    expect(layerPanelChildren(api, api.getNode(arrangement)!).map(node => node.id)).toContain(first)
    expect(layerPanelChildren(api, api.getNode(root)!).map(node => node.id)).not.toContain(first)
    // The visual group follows the common member container, even if a legacy
    // project stores its controller under a different actual parent.
    expect(layerPanelChildren(api, api.getNode(root)!).map(node => node.id)).toContain(arrangement)
  })
})
