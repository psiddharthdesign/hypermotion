// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import type {
  CompositionScene,
  SequenceItem,
} from '@/sequence/types'
import { createSceneAPI } from './doc'
import {
  applyJsonToScene,
  loadSceneIntoDoc,
  sceneToBytes,
  sceneToJson,
} from './file'
import { createProjectAPI } from '@/project/doc'

function createProjectFixture(): {
  api: ReturnType<typeof createSceneAPI>
  first: CompositionScene
  second: CompositionScene
  items: Record<string, SequenceItem>
} {
  const api = createSceneAPI()
  const firstCameraId = api.getActiveCameraId()
  if (!firstCameraId) throw new Error('default camera was not seeded')
  const firstRootId = api.createNode('frame', null, {
    name: 'Opening root',
  })
  const secondRootId = api.createNode('frame', null, {
    name: 'Detail root',
  })
  const secondCameraId = api.createNode('camera', null, {
    name: 'Detail camera',
  })
  const openingComponentId = api.createNode('component', null, {
    name: 'Opening component',
    workspaceOnly: true,
  })
  api.createNode('text', openingComponentId, {
    name: 'Opening component label',
    text: 'Start',
  })
  api.createNode('instance', firstRootId, {
    name: 'Opening instance',
    componentId: openingComponentId,
  })
  const first: CompositionScene = {
    id: 'opening',
    name: 'Opening',
    rootNodeId: firstRootId,
    duration: 2,
    workArea: { start: 0.25, end: 1.75 },
    workspaceNodeIds: [openingComponentId],
    cameraIds: [firstCameraId],
    defaultCameraId: firstCameraId,
    cameraCuts: {},
  }
  const second: CompositionScene = {
    id: 'detail',
    name: 'Detail',
    rootNodeId: secondRootId,
    duration: 3,
    cameraIds: [secondCameraId],
    defaultCameraId: secondCameraId,
    cameraCuts: {
      closeup: {
        id: 'closeup',
        time: 1.25,
        cameraId: secondCameraId,
      },
    },
  }
  const items: Record<string, SequenceItem> = {
    openingUse: {
      id: 'openingUse',
      sceneId: first.id,
      trimStart: 0,
      duration: 2,
      transitionOut: { kind: 'crossfade', duration: 0.5 },
    },
    detailUse: {
      id: 'detailUse',
      sceneId: second.id,
      masterAudioMuted: true,
      trimStart: 0.25,
      duration: 2.5,
      transitionOut: { kind: 'cut', duration: 0 },
    },
  }

  const scene = api.doc.getMap<unknown>('scene')
  const compositions = new Y.Map<CompositionScene>()
  compositions.set(first.id, first)
  compositions.set(second.id, second)
  scene.set('compositionScenes', compositions)
  const sequenceItems = new Y.Map<SequenceItem>()
  for (const [id, sequenceItem] of Object.entries(items)) {
    sequenceItems.set(id, sequenceItem)
  }
  scene.set('sequenceItems', sequenceItems)
  const sequenceOrder = new Y.Array<string>()
  sequenceOrder.push(['openingUse', 'detailUse'])
  scene.set('sequenceOrder', sequenceOrder)
  scene.set('activeCompositionId', second.id)
  scene.set('sequenceSchemaVersion', 2)
  scene.set('root', secondRootId)
  api.setActiveCameraId(secondCameraId)

  return { api, first, second, items }
}

describe('project sequence JSON persistence', () => {
  it('snapshots and applies project state with every node reference translated', () => {
    const source = createProjectFixture()
    const sourceJson = sceneToJson(source.api)

    expect(sourceJson.compositionScenes).toEqual({
      opening: source.first,
      detail: source.second,
    })
    expect(sourceJson.sequenceItems).toEqual(source.items)
    expect(sourceJson.sequenceOrder).toEqual([
      'openingUse',
      'detailUse',
    ])
    expect(sourceJson.activeCompositionId).toBe('detail')
    expect(sourceJson.sequenceSchemaVersion).toBe(2)

    const targetDoc = new Y.Doc()
    createSceneAPI(targetDoc)
    const targetScene = targetDoc.getMap<unknown>('scene')
    const retainedCompositions = new Y.Map<CompositionScene>()
    const retainedItems = new Y.Map<SequenceItem>()
    const retainedOrder = new Y.Array<string>()
    targetScene.set('compositionScenes', retainedCompositions)
    targetScene.set('sequenceItems', retainedItems)
    targetScene.set('sequenceOrder', retainedOrder)

    const importedApi = applyJsonToScene(targetDoc, sourceJson)
    const imported = sceneToJson(importedApi)
    const importedOpening = imported.compositionScenes?.opening
    const importedDetail = imported.compositionScenes?.detail
    if (!importedOpening || !importedDetail) {
      throw new Error('composition scenes did not round-trip')
    }

    expect(targetScene.get('compositionScenes')).toBe(retainedCompositions)
    expect(targetScene.get('sequenceItems')).toBe(retainedItems)
    expect(targetScene.get('sequenceOrder')).toBe(retainedOrder)
    expect(importedOpening.rootNodeId).not.toBe(source.first.rootNodeId)
    expect(importedDetail.rootNodeId).not.toBe(source.second.rootNodeId)
    expect(imported.root).toBe(importedDetail.rootNodeId)
    expect(imported.nodes[importedOpening.rootNodeId]).toMatchObject({
      kind: 'frame',
      name: 'Opening root',
    })
    expect(imported.nodes[importedDetail.rootNodeId]).toMatchObject({
      kind: 'frame',
      name: 'Detail root',
    })
    const importedOpeningComponentId =
      importedOpening.workspaceNodeIds?.[0]
    expect(importedOpeningComponentId).toBeTruthy()
    expect(importedOpeningComponentId).not.toBe(
      source.first.workspaceNodeIds?.[0],
    )
    if (!importedOpeningComponentId) {
      throw new Error('opening workspace component did not round-trip')
    }
    expect(imported.nodes[importedOpeningComponentId]).toMatchObject({
      kind: 'component',
      workspaceOnly: true,
      parent: null,
    })
    const importedOpeningInstance = Object.values(imported.nodes).find(
      (node) =>
        node.kind === 'instance' &&
        node.parent === importedOpening.rootNodeId,
    )
    expect(importedOpeningInstance).toMatchObject({
      kind: 'instance',
      componentId: importedOpeningComponentId,
    })

    const importedDetailCamera = importedDetail.defaultCameraId
    expect(importedDetailCamera).not.toBeNull()
    if (!importedDetailCamera) {
      throw new Error('detail camera did not round-trip')
    }
    expect(importedDetail.cameraIds).toEqual([importedDetailCamera])
    expect(imported.activeCameraId).toBe(importedDetailCamera)
    expect(imported.nodes[importedDetailCamera]).toMatchObject({
      kind: 'camera',
      name: 'Detail camera',
    })
    expect(importedDetail.cameraCuts.closeup).toEqual({
      id: 'closeup',
      time: 1.25,
      cameraId: importedDetailCamera,
    })
    expect(imported.sequenceItems).toEqual(source.items)
    expect(imported.sequenceOrder).toEqual([
      'openingUse',
      'detailUse',
    ])
    expect(imported.activeCompositionId).toBe('detail')
    expect(imported.sequenceSchemaVersion).toBe(2)
  })

  it('keeps legacy JSON valid and clears stale project state in place', () => {
    const legacyApi = createSceneAPI()
    const legacyRootId = legacyApi.createNode('frame', null, {
      name: 'Legacy root',
    })
    const legacyJson = sceneToJson(legacyApi)
    expect(legacyJson.root).toBe(legacyRootId)
    expect(legacyJson.compositionScenes).toBeUndefined()
    expect(legacyJson.sequenceItems).toBeUndefined()
    expect(legacyJson.sequenceOrder).toBeUndefined()

    const targetDoc = new Y.Doc()
    createSceneAPI(targetDoc)
    const targetScene = targetDoc.getMap<unknown>('scene')
    const staleCompositions = new Y.Map<CompositionScene>()
    staleCompositions.set('stale', {
      id: 'stale',
      name: 'Stale',
      rootNodeId: 'missing-root',
      duration: 1,
      cameraIds: [],
      defaultCameraId: null,
      cameraCuts: {},
    })
    const staleItems = new Y.Map<SequenceItem>()
    staleItems.set('stale-use', {
      id: 'stale-use',
      sceneId: 'stale',
    })
    const staleOrder = new Y.Array<string>()
    staleOrder.push(['stale-use'])
    targetScene.set('compositionScenes', staleCompositions)
    targetScene.set('sequenceItems', staleItems)
    targetScene.set('sequenceOrder', staleOrder)
    targetScene.set('activeCompositionId', 'stale')
    targetScene.set('sequenceSchemaVersion', 2)

    const importedApi = applyJsonToScene(targetDoc, legacyJson)
    const imported = sceneToJson(importedApi)

    expect(targetScene.get('compositionScenes')).toBe(staleCompositions)
    expect(targetScene.get('sequenceItems')).toBe(staleItems)
    expect(targetScene.get('sequenceOrder')).toBe(staleOrder)
    expect(staleCompositions.size).toBe(0)
    expect(staleItems.size).toBe(0)
    expect(staleOrder.length).toBe(0)
    expect(targetScene.has('activeCompositionId')).toBe(false)
    expect(targetScene.has('sequenceSchemaVersion')).toBe(false)
    expect(imported.compositionScenes).toBeUndefined()
    expect(imported.sequenceItems).toBeUndefined()
    expect(imported.sequenceOrder).toBeUndefined()
    expect(imported.activeCompositionId).toBeUndefined()
    expect(imported.sequenceSchemaVersion).toBeUndefined()
    expect(imported.nodes[imported.root]).toMatchObject({
      kind: 'frame',
      name: 'Legacy root',
    })
  })

  it('keeps an existing ProjectAPI live when binary scene loading replaces its data', () => {
    const sourceApi = createSceneAPI()
    sourceApi.createNode('frame', null, { name: 'Source opening' })
    const sourceProject = createProjectAPI(sourceApi)
    sourceProject.ensureInitialized()
    const opening = sourceProject.getScenes()[0]!
    const openingItem = sourceProject.getSequenceItems()[0]!
    const detail = sourceProject.createScene({
      name: 'Source detail',
      duration: 3,
    })
    sourceProject.setTransition(openingItem.id, {
      kind: 'crossfade',
      duration: 0.5,
    })

    const targetApi = createSceneAPI()
    targetApi.createNode('frame', null, { name: 'Stale target' })
    const retainedProject = createProjectAPI(targetApi)
    retainedProject.ensureInitialized()

    loadSceneIntoDoc(targetApi.doc, sceneToBytes(sourceApi.doc))
    retainedProject.ensureInitialized()

    expect(retainedProject.getScenes().map((scene) => scene.name)).toEqual([
      opening.name,
      detail.name,
    ])
    expect(retainedProject.getSequenceItems()).toHaveLength(2)
    expect(retainedProject.getSequenceTimeMap()).toMatchObject({
      duration: 7.5,
      transitions: [
        expect.objectContaining({
          fromItemId: openingItem.id,
          duration: 0.5,
        }),
      ],
    })
    expect(retainedProject.getActiveSceneId()).toBe(detail.id)
    expect(targetApi.getRoot()).toBe(detail.rootNodeId)
  })
})
