// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import type { CompositionScene } from '@/sequence'
import { createProjectAPI } from './doc'

function legacyDocument() {
  const api = createSceneAPI()
  api.setMeta({
    name: 'Legacy demo',
    duration: 4,
    frameRate: 60,
    canvas: { width: 960, height: 540 },
  })
  const root = api.createNode('frame', null, {
    name: 'Legacy root',
    size: { width: 960, height: 540 },
  })
  return { api, root }
}

describe('ProjectAPI', () => {
  it('migrates a legacy composition without losing its root or camera', () => {
    const { api, root } = legacyDocument()
    const camera = api.getActiveCameraId()
    const project = createProjectAPI(api)

    project.ensureInitialized()

    expect(project.getScenes()).toHaveLength(1)
    expect(project.getSequenceItems()).toHaveLength(1)
    expect(project.getActiveScene()).toMatchObject({
      name: 'Legacy demo',
      rootNodeId: root,
      duration: 4,
      defaultCameraId: camera,
      cameraIds: [camera],
    })
    expect(api.getRoot()).toBe(root)
    expect(api.getActiveCameraId()).toBe(camera)
  })

  it('creates, orders and activates independently rooted scenes', () => {
    const { api, root } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const first = project.getScenes()[0]!

    const second = project.createScene({ name: 'Form success', duration: 3 })
    expect(second.rootNodeId).not.toBe(root)
    expect(second.defaultCameraId).not.toBe(first.defaultCameraId)
    expect(api.getRoot()).toBe(second.rootNodeId)
    expect(api.getMeta().duration).toBe(3)

    const items = project.getSequenceItems()
    expect(items.map((item) => item.sceneId)).toEqual([first.id, second.id])
    project.reorderSequenceItem(items[1]!.id, 0)
    expect(project.getSequenceItems().map((item) => item.sceneId)).toEqual([
      second.id,
      first.id,
    ])

    project.activateScene(first.id)
    expect(api.getRoot()).toBe(root)
    expect(api.getMeta().duration).toBe(4)
  })

  it('repairs an empty legacy root projection for the active scene', () => {
    const { api, root } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    api.doc.getMap('scene').delete('root')

    expect(api.getRoot()).toBe('')

    project.ensureInitialized()

    expect(api.getRoot()).toBe(root)
    expect(api.getNode(api.getRoot()!)).toMatchObject({
      id: root,
      kind: 'frame',
    })
  })

  it('repairs a stale projection without changing the active scene', () => {
    const { api, root } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const second = project.createScene({ name: 'Second scene' })
    api.doc.getMap('scene').set('root', root)

    project.ensureInitialized()

    expect(project.getActiveSceneId()).toBe(second.id)
    expect(api.getRoot()).toBe(second.rootNodeId)
  })

  it('recovers a missing composition root without replacing the scene', () => {
    const { api, root } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const before = project.getActiveScene()!
    const cameraId = before.defaultCameraId

    api.deleteNode(root)
    project.ensureInitialized()

    const after = project.getActiveScene()!
    expect(after.id).toBe(before.id)
    expect(after.rootNodeId).not.toBe(root)
    expect(after.defaultCameraId).toBe(cameraId)
    expect(api.getRoot()).toBe(after.rootNodeId)
    expect(api.getNode(after.rootNodeId)).toMatchObject({
      kind: 'frame',
      parent: null,
      workspaceOnly: false,
      layout: { mode: 'none' },
    })
  })

  it('reuses the sole unclaimed frame when repairing a scene root', () => {
    const { api, root } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const scene = project.getActiveScene()!

    api.deleteNode(root)
    const replacement = api.createNode('frame', null, {
      name: scene.name,
      size: { width: 960, height: 540 },
    })
    project.ensureInitialized()

    expect(project.getActiveScene()?.rootNodeId).toBe(replacement)
    expect(api.getRoot()).toBe(replacement)
  })

  it('does not steal children when a composition points at a nested frame', () => {
    const { api, root } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const scene = project.getActiveScene()!
    const nested = api.createNode('frame', root, { name: 'Nested' })
    const child = api.createNode('text', nested, {
      name: 'Nested child',
      text: 'Keep me nested',
    })
    const compositions = api.doc
      .getMap<unknown>('scene')
      .get('compositionScenes') as Y.Map<CompositionScene>
    compositions.set(scene.id, { ...scene, rootNodeId: nested })

    project.ensureInitialized()

    expect(project.getActiveScene()?.rootNodeId).toBe(root)
    expect(api.getNode(nested)?.parent).toBe(root)
    expect(api.getNode(child)?.parent).toBe(nested)
  })

  it('creates a fresh root when multiple unclaimed frames are ambiguous', () => {
    const { api, root } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()

    api.deleteNode(root)
    const firstCandidate = api.createNode('frame', null, { name: 'One' })
    const secondCandidate = api.createNode('frame', null, { name: 'Two' })
    api.doc.getMap('scene').delete('root')

    project.ensureInitialized()

    const repairedRoot = project.getActiveScene()!.rootNodeId
    expect(repairedRoot).not.toBe(firstCandidate)
    expect(repairedRoot).not.toBe(secondCandidate)
    expect(api.getNode(repairedRoot)).toMatchObject({
      kind: 'frame',
      parent: null,
    })
  })

  it('duplicates scene nodes, tracks, cameras and camera cuts', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const source = project.getScenes()[0]!
    const child = api.createNode('text', source.rootNodeId, {
      name: 'Title',
      text: 'Explainer',
    })
    api.setTrack({
      id: 'title-opacity',
      nodeId: child,
      propertyId: 'appearance.opacity',
      defaultEasing: 'ease-out',
      keyframes: [
        { id: 'a', time: 0, value: 0 },
        { id: 'b', time: 0.5, value: 1 },
      ],
    })
    project.upsertCameraCut(source.id, {
      id: 'opening',
      time: 1,
      cameraId: source.defaultCameraId!,
    })

    const copy = project.duplicateScene(source.id)

    expect(copy).not.toBeNull()
    expect(copy!.rootNodeId).not.toBe(source.rootNodeId)
    expect(copy!.defaultCameraId).not.toBe(source.defaultCameraId)
    expect(copy!.cameraIds).toHaveLength(1)
    expect(Object.values(copy!.cameraCuts)).toHaveLength(1)
    expect(Object.values(copy!.cameraCuts)[0]!.cameraId).toBe(
      copy!.defaultCameraId,
    )
    const copiedChild = api.getChildren(copy!.rootNodeId)[0]!
    expect(copiedChild.name).toBe('Title')
    expect(api.getTracksForNode(copiedChild.id)[0]).toMatchObject({
      propertyId: 'appearance.opacity',
    })
  })

  it('owns, duplicates, clamps and clears work areas per composition', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const source = project.getScenes()[0]!

    expect(source.workArea).toBeUndefined()
    project.setSceneWorkArea(source.id, { start: 1, end: 3.5 })
    expect(project.getScene(source.id)?.workArea).toEqual({
      start: 1,
      end: 3.5,
    })
    expect(project.getSequenceTimeMap().items[0]).toMatchObject({
      sourceStart: 1,
      sourceEnd: 3.5,
      duration: 2.5,
    })

    const copy = project.duplicateScene(source.id)
    expect(copy?.workArea).toEqual({ start: 1, end: 3.5 })

    project.updateScene(source.id, { duration: 2 })
    expect(project.getScene(source.id)?.workArea).toEqual({
      start: 1,
      end: 2,
    })

    project.setSceneWorkArea(source.id, null)
    expect(project.getScene(source.id)?.workArea).toBeUndefined()
    expect(project.getSequenceTimeMap().items[0]).toMatchObject({
      sourceStart: 0,
      sourceEnd: 2,
      duration: 2,
    })
  })

  it('lets occurrence trims narrow but never expand a scene work area', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const scene = project.getScenes()[0]!
    const item = project.getSequenceItems()[0]!

    project.setSceneWorkArea(scene.id, { start: 1, end: 3 })
    project.updateSequenceItem(item.id, { trimStart: 0, duration: 2 })
    expect(project.getSequenceTimeMap().items[0]).toMatchObject({
      sourceStart: 1,
      sourceEnd: 2,
      duration: 1,
    })

    project.updateSequenceItem(item.id, { trimStart: 1.5, duration: 10 })
    expect(project.getSequenceTimeMap().items[0]).toMatchObject({
      sourceStart: 1.5,
      sourceEnd: 3,
      duration: 1.5,
    })
  })

  it('stores Master soundtrack mute per occurrence and keeps false implicit', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const item = project.getSequenceItems()[0]!

    expect(item.masterAudioMuted).toBeUndefined()
    project.updateSequenceItem(item.id, { masterAudioMuted: true })
    expect(project.getSequenceItems()[0]!.masterAudioMuted).toBe(true)

    project.updateSequenceItem(item.id, { masterAudioMuted: false })
    expect(project.getSequenceItems()[0]!.masterAudioMuted).toBeUndefined()
  })

  it('persists an occurrence hold without changing authored scene duration', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const composition = project.getScenes()[0]!
    const item = project.getSequenceItems()[0]!

    project.updateSequenceItem(item.id, { holdDuration: 3.25 })

    expect(project.getScene(composition.id)?.duration).toBe(
      composition.duration,
    )
    expect(project.getSequenceItems()[0]?.holdDuration).toBe(3.25)
    expect(project.getSequenceTimeMap().items[0]).toMatchObject({
      sourceDuration: composition.duration,
      holdDuration: 3.25,
      duration: composition.duration + 3.25,
    })

    project.updateSequenceItem(item.id, { holdDuration: 0 })
    expect(project.getSequenceItems()[0]?.holdDuration).toBeUndefined()
    expect(project.getSequenceTimeMap().duration).toBe(composition.duration)
  })

  it('reconciles newly-created cameras and drops stale cuts', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const active = project.getActiveScene()!
    const alternate = api.createNode('camera', null, { name: 'Detail' })
    project.upsertCameraCut(active.id, {
      id: 'detail',
      time: 2,
      cameraId: alternate,
    })

    expect(project.getScene(active.id)!.cameraIds).toContain(alternate)
    api.deleteNode(alternate)
    const reconciled = project.reconcileSceneCameras(active.id)!
    expect(reconciled.cameraIds).not.toContain(alternate)
    expect(reconciled.cameraCuts.detail).toBeUndefined()
  })

  it('does not let one camera become owned by two compositions', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const first = project.getScenes()[0]!
    const second = project.createScene({ name: 'Second' })

    expect(() =>
      project.setDefaultCamera(first.id, second.defaultCameraId!)
    ).toThrow(`already belongs to scene ${second.id}`)
    expect(project.getScene(first.id)!.cameraIds).not.toContain(
      second.defaultCameraId,
    )
  })

  it('keeps one scene and repairs the active projection after deletion', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const first = project.getScenes()[0]!
    const second = project.createScene({ name: 'Outro' })

    expect(project.deleteScene(second.id)).toMatchObject({
      deleted: true,
      activeSceneId: first.id,
    })
    expect(api.getRoot()).toBe(first.rootNodeId)
    expect(project.deleteScene(first.id)).toMatchObject({
      deleted: false,
      reason: 'last-scene',
    })
  })

  it('deletes every repeated occurrence without projecting deleted nodes', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const first = project.getScenes()[0]!
    const repeated = project.createScene({ name: 'Repeated' })
    const repeatedRoot = repeated.rootNodeId
    const repeatedCamera = repeated.defaultCameraId!
    project.addSequenceItem(repeated.id, 1)

    expect(
      project.getSequenceItems().filter((item) => item.sceneId === repeated.id),
    ).toHaveLength(2)

    expect(project.deleteScene(repeated.id)).toMatchObject({
      deleted: true,
      activeSceneId: first.id,
    })
    expect(project.getSequenceItems().map((item) => item.sceneId)).toEqual([
      first.id,
    ])
    expect(project.getActiveSceneId()).toBe(first.id)
    expect(api.getRoot()).toBe(first.rootNodeId)
    expect(api.getNode(repeatedRoot)).toBeNull()
    expect(api.getNode(repeatedCamera)).toBeNull()
  })

  it('keeps the active projection when deleting another composition', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const first = project.getScenes()[0]!
    project.createScene({ name: 'Middle' })
    const active = project.createScene({ name: 'Active' })

    expect(project.getActiveSceneId()).toBe(active.id)
    expect(project.deleteScene(first.id)).toMatchObject({
      deleted: true,
      activeSceneId: active.id,
    })
    expect(project.getActiveSceneId()).toBe(active.id)
    expect(api.getRoot()).toBe(active.rootNodeId)
  })

  it('deletes registered workspace assets without touching user pasteboard assets', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const generatedScene = project.createScene({ name: 'Generated' })
    const generatedAsset = api.createNode('component', null, {
      name: 'Generated form component',
      workspaceOnly: true,
    })
    const generatedChild = api.createNode('text', generatedAsset, {
      name: 'Generated label',
      text: 'Submit',
    })
    api.setTrack({
      id: 'generated-opacity',
      nodeId: generatedChild,
      propertyId: 'appearance.opacity',
      defaultEasing: 'ease-out',
      keyframes: [{ id: 'visible', time: 0, value: 1 }],
    })
    const userAsset = api.createNode('component', null, {
      name: 'User component',
      workspaceOnly: true,
    })

    project.registerWorkspaceNode(generatedScene.id, generatedAsset)

    expect(project.getScene(generatedScene.id)?.workspaceNodeIds).toEqual([
      generatedAsset,
    ])
    expect(project.deleteScene(generatedScene.id).deleted).toBe(true)
    expect(api.getNode(generatedAsset)).toBeNull()
    expect(api.getNode(generatedChild)).toBeNull()
    expect(api.getTrack('generated-opacity')).toBeNull()
    expect(api.getNode(userAsset)).not.toBeNull()
  })

  it('retains shared workspace assets until the final owning scene is deleted', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const source = project.getScenes()[0]!
    const sharedAsset = api.createNode('component', null, {
      name: 'Shared component',
      workspaceOnly: true,
    })
    project.registerWorkspaceNode(source.id, sharedAsset)
    const copy = project.duplicateScene(source.id)
    if (!copy) throw new Error('Expected duplicate scene')
    const survivor = project.createScene({ name: 'Survivor' })

    expect(copy.workspaceNodeIds).toEqual([sharedAsset])
    expect(project.deleteScene(source.id).deleted).toBe(true)
    expect(api.getNode(sharedAsset)).not.toBeNull()
    expect(project.deleteScene(copy.id).deleted).toBe(true)
    expect(api.getNode(sharedAsset)).toBeNull()
    expect(project.getScene(survivor.id)).not.toBeNull()
  })

  it('rejects lifecycle ownership for ordinary artboard nodes', () => {
    const { api, root } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const scene = project.getScenes()[0]!
    const ordinaryLayer = api.createNode('text', root, {
      name: 'Authored title',
      text: 'Keep me',
    })

    expect(() =>
      project.registerWorkspaceNode(scene.id, ordinaryLayer)
    ).toThrow('must be parentless and workspace-only')
  })

  it('preserves implicit full-scene duration when editing a transition', () => {
    const { api } = legacyDocument()
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const scene = project.getScenes()[0]!
    const item = project.getSequenceItems()[0]!
    project.createScene({ name: 'Following scene', duration: 2 })

    expect(item.duration).toBeUndefined()
    project.setTransition(item.id, {
      kind: 'crossfade',
      duration: 0.5,
    })

    expect(project.getSequenceItems()[0]).toMatchObject({
      transitionOut: { kind: 'crossfade', duration: 0.5 },
    })
    expect(project.getSequenceItems()[0]!.duration).toBeUndefined()

    project.updateScene(scene.id, { duration: 6 })
    expect(project.getSequenceTimeMap().items[0]).toMatchObject({
      duration: 6,
      transitionOut: 0.5,
    })
  })
})
