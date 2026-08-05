// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { getProjectAPI } from '@/project/doc'
import { resolveFigmaImportRoot } from './figmaImportRoot'

describe('resolveFigmaImportRoot', () => {
  it('repairs a stale legacy projection from the active composition', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { name: 'Opening' })
    const project = getProjectAPI(api)
    project.ensureInitialized()
    const active = project.createScene({ name: 'Detail' })

    api.doc.getMap<unknown>('scene').set('root', 'deleted-root')

    expect(resolveFigmaImportRoot(api)).toBe(active.rootNodeId)
    expect(api.getRoot()).toBe(active.rootNodeId)
  })

  it('falls back to the first composition whose root still exists', () => {
    const api = createSceneAPI()
    const openingRootId = api.createNode('frame', null, { name: 'Opening' })
    const project = getProjectAPI(api)
    project.ensureInitialized()
    const deleted = project.createScene({ name: 'Deleted detail' })
    api.deleteNode(deleted.rootNodeId)
    api.doc.getMap<unknown>('scene').set('root', 'deleted-root')

    expect(resolveFigmaImportRoot(api)).toBe(openingRootId)
    expect(api.getRoot()).toBe(openingRootId)
  })

  it('creates a recovery scene when the document has no live artboard', () => {
    const api = createSceneAPI()
    const deletedRootId = api.createNode('frame', null, { name: 'Deleted' })
    const project = getProjectAPI(api)
    project.ensureInitialized()
    api.deleteNode(deletedRootId)

    const recoveredRootId = resolveFigmaImportRoot(api)

    expect(recoveredRootId).not.toBeNull()
    expect(api.getNode(recoveredRootId!)).toMatchObject({
      kind: 'frame',
      parent: null,
    })
    expect(api.getRoot()).toBe(recoveredRootId)
    expect(project.getActiveScene()?.rootNodeId).toBe(recoveredRootId)
  })
})
