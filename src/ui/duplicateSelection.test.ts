// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { createArrangement, repairArrangementMembership } from '@/scene/arrangementActions'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { solveLayout, yogaReady } from '@/layout/engine'
import { buildWorldPlanes, resolveCamera3D } from '@/render3d/scene3d'
import { duplicateSelection } from './duplicateSelection'
import { buildNodeContextMenu } from './contextMenuActions'
import { useUI } from '@/state/ui'
import { layerPanelChildren, layerPanelParent } from './arrangementLayerTree'

function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const arrangement = createArrangement(api, [], {})!
  const members = api.getNode(arrangement)!.arrangement!.memberIds
  return { api, root, arrangement, members }
}

describe('arrangement member duplication', () => {
  it('adds a shortcut copy as a new slot without nudging its transform', async () => {
    const { api, root, arrangement, members } = setup()
    const source = members[0]!
    const [copy] = duplicateSelection(api, [source])
    const ids = api.getNode(arrangement)!.arrangement!.memberIds
    expect(ids).toHaveLength(10)
    expect(ids.slice(0, 3)).toEqual([source, copy, members[1]])
    expect(api.getNode(copy!)!.transform).toEqual(api.getNode(source)!.transform)
    expect(api.getNode(copy!)!.transformParent).toEqual(api.getNode(source)!.transformParent)
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    const planes = buildWorldPlanes(api, layout, {}, resolveCamera3D(api.getActiveCamera()!, undefined, api.getMeta().canvas))
    const positions = ids.map(id => planes.find(plane => plane.nodeId === id)!.center)
    expect(new Set(positions.map(p => `${p.x},${p.y},${p.z}`)).size).toBe(10)
  })

  it('keeps duplicated cards inside a nested arrangement in the layer tree', () => {
    const { api, root, arrangement, members } = setup()
    const container = api.createNode('frame', root)
    api.setNodeProperty(arrangement, 'parent', container)
    for (const id of members) api.appendChild(container, id)
    const [copy] = duplicateSelection(api, [members[0]!])
    expect(layerPanelParent(api, api.getNode(copy!)!)).toBe(arrangement)
    expect(layerPanelChildren(api, api.getNode(arrangement)!).map(node => node.id)).toContain(copy)
    expect(layerPanelChildren(api, api.getNode(container)!).map(node => node.id)).toEqual([arrangement])
  })

  it('recovers legacy copies whose controller link was copied without a member slot', () => {
    const { api, root, arrangement, members } = setup()
    const source = api.getNode(members[0]!)!
    const legacy = api.createNode('rect', root, { transformParent: source.transformParent, transform: source.transform })
    expect(api.getNode(arrangement)!.arrangement!.memberIds).not.toContain(legacy)
    const [copy] = duplicateSelection(api, [legacy])
    expect(api.getNode(arrangement)!.arrangement!.memberIds).toContain(legacy)
    expect(api.getNode(arrangement)!.arrangement!.memberIds).toContain(copy)
    expect(layerPanelParent(api, api.getNode(copy!)!)).toBe(arrangement)
    expect(repairArrangementMembership(api)).toBe(0)
    expect(api.getNode(copy!)!.transform).toEqual(source.transform)
  })

  it('duplicates multiple selected members once, in pattern order, with tracks and one undo', () => {
    const { api, arrangement, members } = setup()
    const a = members[0]!, b = members[2]!
    api.setTrack({ id: 'fade', nodeId: a, propertyId: 'appearance.opacity', defaultEasing: 'ease-out', keyframes: [{ id: 'key', time: 1, value: 0.5 }] })
    const undo = new Y.UndoManager(api.doc.getMap('scene'), { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) })
    const [copyB, copyA] = duplicateSelection(api, [b, a, b])
    expect(api.getNode(arrangement)!.arrangement!.memberIds.slice(0, 5)).toEqual([a, copyA, members[1], b, copyB])
    const track = api.getTracksForNode(copyA!)[0]!
    expect(track.keyframes[0]).toMatchObject({ time: 1, value: 0.5 })
    expect(track.id).not.toBe('fade')
    expect(track.keyframes[0]!.id).not.toBe('key')
    undo.undo()
    expect(api.getNode(copyA!)).toBeNull()
    expect(api.getNode(copyB!)).toBeNull()
    expect(api.getNode(arrangement)!.arrangement!.memberIds).toEqual(members)
    undo.redo()
    expect(api.getNode(arrangement)!.arrangement!.memberIds).toContain(copyA)
    undo.destroy()
  })

  it('uses the same multi-select behavior from the Duplicate menu', () => {
    const { api, arrangement, members } = setup()
    buildNodeContextMenu(api, [members[0]!, members[1]!]).find(item => item.label === 'Duplicate')!.onClick!()
    const copies = useUI.getState().selection
    expect(copies).toHaveLength(2)
    expect(api.getNode(arrangement)!.arrangement!.memberIds).toHaveLength(11)
    for (const id of copies) expect(api.getNode(id)!.transformParent?.nodeId).toBe(arrangement)
    useUI.getState().clearSelection()
  })

  it('keeps copies in their respective arrangements and ordinary layers outside', () => {
    const { api, root, arrangement, members } = setup()
    const other = createArrangement(api, [], {})!
    const second = api.getNode(other)!.arrangement!.memberIds[0]!
    const ordinary = api.createNode('rect', root)
    const [firstCopy, secondCopy, ordinaryCopy] = duplicateSelection(api, [members[0]!, second, ordinary])
    expect(api.getNode(arrangement)!.arrangement!.memberIds).toContain(firstCopy)
    expect(api.getNode(other)!.arrangement!.memberIds).toContain(secondCopy)
    expect(api.getNode(ordinaryCopy!)!.transformParent).toBeNull()
  })

  it('does not duplicate a child twice or add it as a separate card', () => {
    const { api, arrangement, members } = setup()
    const member = members[0]!
    const child = api.createNode('text', member, { text: 'Hello' })
    const copies = duplicateSelection(api, [member, child])
    expect(copies).toHaveLength(1)
    expect(api.getChildren(copies[0]!)).toHaveLength(1)
    expect(api.getNode(arrangement)!.arrangement!.memberIds).toHaveLength(10)
  })

  it('duplicates an arrangement plus selected member only once, as a separate arrangement', () => {
    const { api, arrangement, members } = setup()
    const copies = duplicateSelection(api, [members[0]!, arrangement])
    expect(copies).toHaveLength(1)
    expect(api.getNode(copies[0]!)!.kind).toBe('arrangement')
    expect(api.getNode(copies[0]!)!.arrangement!.memberIds).toHaveLength(9)
    expect(api.getNode(arrangement)!.arrangement!.memberIds).toEqual(members)
  })
})
