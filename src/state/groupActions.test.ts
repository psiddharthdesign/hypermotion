// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { addKeyframe, findTrack } from '@/anim'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import {
  deleteAnimationTracks,
  groupKeyframes,
  groupTracks,
  ungroupKeyframes,
} from './groupActions'

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

describe('keyframe grouping', () => {
  function setup() {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const first = api.createNode('frame', root, { name: 'First' })
    const second = api.createNode('frame', root, { name: 'Second' })
    const firstKeyframe = addKeyframe(api, first, 'transform.x', 0, 0)
    const secondKeyframe = addKeyframe(api, second, 'transform.y', 1, 100)
    const firstTrack = findTrack(api, first, 'transform.x')!
    const secondTrack = findTrack(api, second, 'transform.y')!
    return {
      api,
      firstTrack,
      secondTrack,
      keys: [
        `${firstTrack.id}:${firstKeyframe.id}`,
        `${secondTrack.id}:${secondKeyframe.id}`,
      ],
    }
  }

  it('persists the exact cross-track selection as one visible collapsed group', () => {
    const { api, keys } = setup()

    groupKeyframes(api, keys)

    const ui = api.getUiState()
    const entries = Object.entries(ui.kfGroups)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.[1]).toEqual(keys)
    expect(ui.kfGroupCollapsed[entries[0]![0]]).toBe(true)
  })

  it('does not create a collapsed phantom group from stale selection keys', () => {
    const { api, keys } = setup()

    groupKeyframes(api, [keys[0]!, 'deleted-track:deleted-keyframe'])

    expect(api.getUiState().kfGroups).toEqual({})
    expect(api.getUiState().kfGroupCollapsed).toEqual({})
  })

  it('cleans superseded collapse records when regrouping membership', () => {
    const { api, firstTrack, keys } = setup()
    const thirdKeyframe = addKeyframe(
      api,
      firstTrack.nodeId,
      'transform.x',
      2,
      200,
    )
    const thirdKey = `${firstTrack.id}:${thirdKeyframe.id}`
    groupKeyframes(api, keys)
    const oldGroupId = Object.keys(api.getUiState().kfGroups)[0]!

    groupKeyframes(api, [keys[0]!, thirdKey])

    const ui = api.getUiState()
    expect(ui.kfGroups[oldGroupId]).toBeUndefined()
    expect(ui.kfGroupCollapsed[oldGroupId]).toBeUndefined()
    expect(Object.values(ui.kfGroups)).toContainEqual([keys[0], thirdKey])
  })

  it('groups and ungroups as separate undoable gesture boundaries', () => {
    const { api, keys } = setup()
    const scene = api.doc.getMap('scene')
    const undo = new Y.UndoManager(
      [scene, scene.get('uiState') as Y.Map<unknown>],
      {
        captureTimeout: 500,
        trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]),
      },
    )
    const closeGestureCapture = (transaction: Y.Transaction) => {
      if (transaction.origin === UNDOABLE_GESTURE_ORIGIN) {
        undo.stopCapturing()
      }
    }
    api.doc.on('afterTransaction', closeGestureCapture)

    groupKeyframes(api, keys)
    ungroupKeyframes(api, keys)
    expect(api.getUiState().kfGroups).toEqual({})

    undo.undo()
    expect(Object.values(api.getUiState().kfGroups)).toContainEqual(keys)
    undo.undo()
    expect(api.getUiState().kfGroups).toEqual({})
    api.doc.off('afterTransaction', closeGestureCapture)
    undo.destroy()
  })
})
