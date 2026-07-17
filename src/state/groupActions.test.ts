// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { addKeyframe, findTrack } from '@/anim'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { deleteAnimationTracks, groupTracks } from './groupActions'

describe('track group deletion', () => {
  it('deletes the grouped animation, preserves layers, and undoes once', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const first = api.createNode('frame', root, { name: 'First' })
    const second = api.createNode('frame', root, { name: 'Second' })
    addKeyframe(api, first, 'transform.x', 0, 0)
    addKeyframe(api, first, 'transform.x', 1, 100)
    addKeyframe(api, second, 'transform.z', 0.2, 0)
    addKeyframe(api, second, 'transform.z', 1.2, 200)
    addKeyframe(api, first, 'appearance.opacity', 2, 0.5)
    const firstTrack = findTrack(api, first, 'transform.x')!
    const secondTrack = findTrack(api, second, 'transform.z')!
    const unrelatedTrack = findTrack(api, first, 'appearance.opacity')!
    groupTracks(api, [firstTrack.id, secondTrack.id])

    const scene = api.doc.getMap('scene')
    const undo = new Y.UndoManager(
      [
        scene,
        scene.get('tracks') as Y.Map<unknown>,
        scene.get('uiState') as Y.Map<unknown>,
      ],
      { trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]) },
    )

    expect(deleteAnimationTracks(api, [firstTrack.id, secondTrack.id])).toBe(2)
    expect(api.getTrack(firstTrack.id)).toBeNull()
    expect(api.getTrack(secondTrack.id)).toBeNull()
    expect(api.getTrack(unrelatedTrack.id)).not.toBeNull()
    expect(api.getUiState().trackGroups).toEqual({})
    expect(api.getNode(first)).not.toBeNull()
    expect(api.getNode(second)).not.toBeNull()

    undo.undo()
    expect(api.getTrack(firstTrack.id)).not.toBeNull()
    expect(api.getTrack(secondTrack.id)).not.toBeNull()
    expect(Object.values(api.getUiState().trackGroups)[0]?.trackIds).toEqual([
      firstTrack.id,
      secondTrack.id,
    ])
    undo.destroy()
  })
})
