// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createProjectAPI } from '@/project/doc'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { createCameraCutDeleteKeyGuard } from '@/ui/cameraCutKeyboard'

describe('camera cut delete-key ownership', () => {
  it('reserves Delete and Backspace only after a camera-cut marker claims them', () => {
    const guard = createCameraCutDeleteKeyGuard()

    expect(guard.shouldReserve('Delete', false)).toBe(false)
    expect(guard.shouldReserve('Enter', true)).toBe(false)
    expect(guard.claim('Enter')).toBe(false)
    expect(guard.claim('Delete')).toBe(true)
    expect(guard.shouldReserve('Delete', false)).toBe(true)
    expect(guard.shouldReserve('Backspace', false)).toBe(false)

    guard.release('Delete')
    expect(guard.shouldReserve('Delete', false)).toBe(false)
  })

  it('keeps a held delete reserved after the focused marker unmounts', () => {
    const guard = createCameraCutDeleteKeyGuard()

    expect(guard.shouldReserve('Backspace', true)).toBe(true)
    expect(guard.shouldReserve('Backspace', false)).toBe(true)

    guard.reset()
    expect(guard.shouldReserve('Backspace', false)).toBe(false)
  })

  it('removes and restores only the cut while its camera survives', () => {
    const api = createSceneAPI()
    api.setMeta({
      name: 'Camera cut keyboard test',
      duration: 4,
      frameRate: 60,
      canvas: { width: 960, height: 540 },
    })
    const root = api.createNode('frame', null, {
      name: 'Root',
      size: { width: 960, height: 540 },
    })
    const layer = api.createNode('text', root, {
      name: 'Selected layer',
      text: 'Keep me',
    })
    const alternateCamera = api.createNode('camera', null, {
      name: 'Camera 2',
    })
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const scene = project.getActiveScene()!
    project.upsertCameraCut(scene.id, {
      id: 'detail-cut',
      time: 1,
      cameraId: alternateCamera,
    })

    const sceneMap = api.doc.getMap('scene')
    const compositions = sceneMap.get(
      'compositionScenes',
    ) as Y.Map<unknown>
    const undo = new Y.UndoManager([sceneMap, compositions], {
      trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]),
    })

    api.doc.transact(
      () => project.removeCameraCut(scene.id, 'detail-cut'),
      UNDOABLE_GESTURE_ORIGIN,
    )

    expect(project.getScene(scene.id)?.cameraCuts['detail-cut']).toBeUndefined()
    expect(api.getNode(alternateCamera)?.kind).toBe('camera')
    expect(api.getNode(layer)?.kind).toBe('text')

    undo.undo()

    expect(project.getScene(scene.id)?.cameraCuts['detail-cut']).toMatchObject({
      id: 'detail-cut',
      cameraId: alternateCamera,
      time: 1,
    })
    expect(api.getNode(alternateCamera)?.kind).toBe('camera')
    expect(api.getNode(layer)?.kind).toBe('text')
    undo.destroy()
  })
})
