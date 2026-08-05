// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import type { CompositionScene } from '@/sequence/types'
import { createProjectAPI, type ProjectAPI } from './doc'
import {
  exportCompositionToHypeBytes,
  importScenesFromHypeBytes,
  transferCompositionScenes,
} from './sceneTransfer'

function legacyProject(name: string): {
  api: SceneAPI
  project: ProjectAPI
  scene: CompositionScene
} {
  const api = createSceneAPI()
  api.setMeta({
    name,
    duration: 4,
    frameRate: 60,
    canvas: { width: 960, height: 540 },
  })
  api.createNode('frame', null, {
    name: `${name} root`,
    size: { width: 960, height: 540 },
  })
  const project = createProjectAPI(api)
  project.ensureInitialized()
  const scene = project.getScenes()[0]
  if (!scene) throw new Error('fixture scene was not initialized')
  project.updateScene(scene.id, { name, duration: 4 })
  return { api, project, scene: project.getScene(scene.id)! }
}

function sourceFixture(): {
  api: SceneAPI
  project: ProjectAPI
  first: CompositionScene
  second: CompositionScene
  componentId: string
  componentChildId: string
  instanceId: string
  shaderId: string
  shaderSourceId: string
  staggerPeerId: string
  secondInstanceId: string
  masterAudioId: string
} {
  const { api, project, scene } = legacyProject('Opening')
  const componentId = api.createNode('component', null, {
    name: 'Shared card',
    workspaceOnly: true,
  })
  const componentChildId = api.createNode('text', componentId, {
    name: 'Card label',
    text: 'Portable component',
    fontFamily: 'Portable',
  })
  api.setNodeProperty(componentId, 'componentProperties', [
    {
      id: 'label',
      name: 'Label',
      nodeId: componentChildId,
      path: 'text',
      type: 'text',
    },
  ])
  api.setNodeProperty(componentId, 'variantOverrides', [
    {
      match: { State: 'Active' },
      overrides: { [componentChildId]: { text: 'Active' } },
    },
  ])
  api.setNodeProperty(componentId, 'timelines', {
    pulse: {
      id: 'pulse',
      name: 'Pulse',
      duration: 0.4,
      tracks: [
        {
          id: 'local-track',
          nodeId: componentChildId,
          propertyId: 'appearance.opacity',
          defaultEasing: 'ease-out',
          keyframes: [
            { id: 'local-a', time: 0, value: 0.5 },
            { id: 'local-b', time: 0.4, value: 1 },
          ],
        },
      ],
    },
  })
  api.setNodeProperty(componentId, 'interactions', [
    {
      id: 'component-click',
      sourceNodeId: componentChildId,
      event: 'click',
      actions: [
        {
          type: 'playTimeline',
          timelineId: 'pulse',
          target: { kind: 'node', nodeId: componentChildId },
        },
      ],
    },
  ])
  project.registerWorkspaceNode(scene.id, componentId)

  const instanceId = api.createNode('instance', scene.rootNodeId, {
    name: 'Card instance',
    componentId,
    overrides: { [componentChildId]: { text: 'Imported' } },
  })
  api.setNodeProperty(instanceId, 'interactions', [
    {
      id: 'instance-click',
      event: 'click',
      actions: [
        {
          type: 'setVariant',
          selection: { State: 'Active' },
          target: { kind: 'instance', instanceId },
        },
      ],
    },
  ])
  const shaderSourceId = api.createNode('image', null, {
    name: 'Shader source',
    workspaceOnly: true,
    src: 'data:image/png;base64,AA==',
  })
  project.registerWorkspaceNode(scene.id, shaderSourceId)
  const shaderId = api.createNode('shader', scene.rootNodeId, {
    name: 'Glass',
    shaderType: 'fluted-glass',
    sourceNodeId: shaderSourceId,
  })
  const cameraId = scene.defaultCameraId
  if (!cameraId) throw new Error('fixture camera missing')
  api.setNodeProperty(cameraId, 'focusTargetNodeId', instanceId)
  api.setTrack({
    id: 'instance-x',
    nodeId: instanceId,
    propertyId: 'transform.x',
    defaultEasing: 'ease-out',
    keyframes: [
      { id: 'source-a', time: 0, value: 0 },
      { id: 'source-b', time: 1, value: 120 },
    ],
  })
  const staggerPeerId = api.createNode('rect', scene.rootNodeId, {
    name: 'Stagger peer',
  })
  api.setTrack({
    id: 'peer-x',
    nodeId: staggerPeerId,
    propertyId: 'transform.x',
    defaultEasing: 'ease-out',
    keyframes: [
      { id: 'peer-a', time: 0.1, value: 0 },
      { id: 'peer-b', time: 1.1, value: 120 },
    ],
  })
  api.setUiState({
    trackGroups: {
      motion: {
        trackIds: ['instance-x', 'peer-x'],
        collapsed: true,
        name: 'Motion',
      },
    },
    kfGroups: {
      pair: ['instance-x:source-a', 'instance-x:source-b'],
    },
    kfGroupCollapsed: { pair: true },
    staggerSets: {
      cascade: {
        id: 'cascade',
        name: 'Cascade',
        layerIds: [instanceId, staggerPeerId],
        delay: 0.1,
        order: 'forward',
        members: {
          [instanceId]: {
            'transform.x': ['source-a', 'source-b'],
          },
          [staggerPeerId]: {
            'transform.x': ['peer-a', 'peer-b'],
          },
        },
      },
    },
  })
  project.upsertCameraCut(scene.id, {
    id: 'opening-cut',
    time: 1,
    cameraId,
  })
  api.setCustomFont({
    id: 'font-source',
    name: 'Portable.woff2',
    family: 'Portable',
    weight: 400,
    style: 'normal',
    format: 'woff2',
    bytes: new Uint8Array([1, 2, 3]),
  })

  const second = project.createScene({ name: 'Closing', duration: 2 })
  api.createNode('text', second.rootNodeId, {
    name: 'Closing title',
    text: 'Done',
  })
  const secondInstanceId = api.createNode('instance', second.rootNodeId, {
    name: 'Closing card instance',
    componentId,
    overrides: { [componentChildId]: { text: 'Closing' } },
  })
  // A repeated source occurrence must not duplicate the composition on import.
  project.addSequenceItem(scene.id)
  const masterAudioId = api.createNode('audio', null, {
    name: 'Master soundtrack',
    src: 'data:audio/wav;base64,AA==',
    duration: 4,
  })
  project.activateScene(second.id)

  return {
    api,
    project,
    first: project.getScene(scene.id)!,
    second: project.getScene(second.id)!,
    componentId,
    componentChildId,
    instanceId,
    shaderId,
    shaderSourceId,
    staggerPeerId,
    secondInstanceId,
    masterAudioId,
  }
}

describe('scene transfer', () => {
  it('appends unique compositions with fresh ids and remapped dependencies', () => {
    const source = sourceFixture()
    const target = legacyProject('Existing')
    const existingItemId = target.project.getSequenceItems()[0]!.id
    const sourceNodeIds = new Set(source.api.getAllNodeIds())
    const sourceTrackIds = new Set(source.api.getAllTracks().map((track) => track.id))

    const result = importScenesFromHypeBytes(
      target.project,
      sceneToBytes(source.api.doc),
    )

    expect(result.scenes.map((scene) => scene.name)).toEqual([
      'Opening',
      'Closing',
    ])
    expect(result.warnings).toEqual([])
    expect(target.project.getSequenceItems().map((item) => item.id)[0]).toBe(
      existingItemId,
    )
    expect(target.project.getScenes().map((scene) => scene.name)).toEqual([
      'Existing',
      'Opening',
      'Closing',
    ])
    expect(target.project.getSequenceItems()).toHaveLength(3)
    expect(target.project.getActiveSceneId()).toBe(result.scenes[0]!.sceneId)

    const importedOpening = target.project.getScene(result.scenes[0]!.sceneId)!
    expect(importedOpening.id).not.toBe(source.first.id)
    expect(importedOpening.rootNodeId).not.toBe(source.first.rootNodeId)
    expect(Object.values(importedOpening.cameraCuts)).toHaveLength(1)
    expect(Object.values(importedOpening.cameraCuts)[0]!.id).not.toBe(
      'opening-cut',
    )

    const importedNodes = target.api
      .getAllNodeIds()
      .map((id) => target.api.getNode(id))
      .filter((node): node is NonNullable<typeof node> => node !== null)
    for (const transferred of importedNodes.filter((node) =>
      node.id !== target.scene.rootNodeId,
    )) {
      expect(sourceNodeIds.has(transferred.id)).toBe(false)
    }
    const importedComponent = importedNodes.find(
      (node) => node.kind === 'component' && node.name === 'Shared card',
    )
    const importedComponentChild = importedNodes.find(
      (node) => node.name === 'Card label',
    )
    const importedInstance = importedNodes.find(
      (node) => node.kind === 'instance' && node.name === 'Card instance',
    )
    const importedShader = importedNodes.find(
      (node) => node.kind === 'shader' && node.name === 'Glass',
    )
    const importedShaderSource = importedNodes.find(
      (node) => node.kind === 'image' && node.name === 'Shader source',
    )
    const importedStaggerPeer = importedNodes.find(
      (node) => node.name === 'Stagger peer',
    )
    const importedSecondInstance = importedNodes.find(
      (node) =>
        node.kind === 'instance' && node.name === 'Closing card instance',
    )
    expect(importedComponent?.id).toBeTruthy()
    expect(importedComponentChild?.id).toBeTruthy()
    expect(importedInstance).toMatchObject({
      kind: 'instance',
      componentId: importedComponent?.id,
      overrides: { [importedComponentChild!.id]: { text: 'Imported' } },
    })
    expect(importedShader).toMatchObject({
      kind: 'shader',
      sourceNodeId: importedShaderSource?.id,
    })
    expect(importedSecondInstance).toMatchObject({
      kind: 'instance',
      componentId: importedComponent?.id,
    })
    const importedClosing = target.project.getScene(result.scenes[1]!.sceneId)!
    expect(importedClosing.workspaceNodeIds).toContain(importedComponent?.id)
    const importedCamera = target.api.getNode(
      importedOpening.defaultCameraId!,
    )
    expect(importedCamera?.kind).toBe('camera')
    if (importedCamera?.kind !== 'camera') {
      throw new Error('imported camera was not transferred')
    }
    expect(importedCamera.focusTargetNodeId).toBe(importedInstance?.id)

    if (importedComponent?.kind !== 'component' || !importedComponentChild) {
      throw new Error('component dependency was not transferred')
    }
    expect(importedComponent.componentProperties[0]?.nodeId).toBe(
      importedComponentChild.id,
    )
    expect(
      importedComponent.timelines.pulse?.tracks[0]?.nodeId,
    ).toBe(importedComponentChild.id)
    expect(
      importedComponent.interactions[0]?.sourceNodeId,
    ).toBe(importedComponentChild.id)

    const importedTracks = target.api.getTracksForNode(importedInstance!.id)
    expect(importedTracks).toHaveLength(1)
    expect(sourceTrackIds.has(importedTracks[0]!.id)).toBe(false)
    expect(importedTracks[0]!.keyframes.map((keyframe) => keyframe.id)).not.toEqual([
      'source-a',
      'source-b',
    ])
    expect(
      importedNodes.some((node) => node.id === source.masterAudioId),
    ).toBe(false)
    expect(
      importedNodes.some(
        (node) => node.kind === 'audio' && node.parent === null,
      ),
    ).toBe(false)
    expect(target.api.getCustomFont('font-source')?.bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    )

    const importedPeerTrack = target.api.getTracksForNode(
      importedStaggerPeer!.id,
    )[0]!
    const uiState = target.api.getUiState()
    expect(Object.values(uiState.trackGroups)).toContainEqual({
      trackIds: [importedTracks[0]!.id, importedPeerTrack.id],
      collapsed: true,
      name: 'Motion',
    })
    const importedKeyframeKeys = importedTracks[0]!.keyframes.map(
      (keyframe) => `${importedTracks[0]!.id}:${keyframe.id}`,
    )
    const importedKeyframeGroup = Object.entries(uiState.kfGroups).find(
      ([, keys]) =>
        keys.length === importedKeyframeKeys.length &&
        keys.every((key, index) => key === importedKeyframeKeys[index]),
    )
    expect(importedKeyframeGroup).toBeTruthy()
    expect(uiState.kfGroupCollapsed[importedKeyframeGroup![0]]).toBe(true)
    const importedStagger = Object.values(uiState.staggerSets).find(
      (set) => set.name === 'Cascade',
    )
    expect(importedStagger).toMatchObject({
      layerIds: [importedInstance!.id, importedStaggerPeer!.id],
      members: {
        [importedInstance!.id]: {
          'transform.x': importedTracks[0]!.keyframes.map(
            (keyframe) => keyframe.id,
          ),
        },
        [importedStaggerPeer!.id]: {
          'transform.x': importedPeerTrack.keyframes.map(
            (keyframe) => keyframe.id,
          ),
        },
      },
    })
    expect(uiState.staggerSets[importedStagger!.id]).toEqual(importedStagger)
  })

  it('exports one portable composition and excludes unrelated project data', () => {
    const source = sourceFixture()

    const bytes = exportCompositionToHypeBytes(source.project, source.first.id)
    const exported = readScene(bytes)
    const project = createProjectAPI(exported.api)
    project.ensureInitialized()

    expect(project.getScenes().map((scene) => scene.name)).toEqual(['Opening'])
    expect(project.getSequenceItems()).toHaveLength(1)
    expect(exported.api.getMeta()).toMatchObject({
      name: 'Opening',
      duration: 4,
      canvas: { width: 960, height: 540 },
      frameRate: 60,
    })
    expect(
      exported.api
        .getAllNodeIds()
        .map((id) => exported.api.getNode(id))
        .some((node) => node?.name === 'Closing title'),
    ).toBe(false)
    expect(
      exported.api
        .getAllNodeIds()
        .map((id) => exported.api.getNode(id))
        .some((node) => node?.kind === 'audio' && node.parent === null),
    ).toBe(false)
    expect(exported.api.getCustomFont('font-source')?.bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    exported.doc.destroy()
  })

  it('includes a shared component when exporting only a referencing scene', () => {
    const source = sourceFixture()

    const bytes = exportCompositionToHypeBytes(source.project, source.second.id)
    const exported = readScene(bytes)
    const project = createProjectAPI(exported.api)
    project.ensureInitialized()
    const [scene] = project.getScenes()
    const nodes = exported.api
      .getAllNodeIds()
      .map((id) => exported.api.getNode(id))
      .filter((node): node is NonNullable<typeof node> => node !== null)
    const component = nodes.find(
      (node) => node.kind === 'component' && node.name === 'Shared card',
    )
    const instance = nodes.find(
      (node) =>
        node.kind === 'instance' && node.name === 'Closing card instance',
    )

    expect(project.getScenes().map((candidate) => candidate.name)).toEqual([
      'Closing',
    ])
    expect(component?.parent).toBeNull()
    expect(component?.workspaceOnly).toBe(true)
    expect(scene?.workspaceNodeIds).toContain(component?.id)
    expect(instance).toMatchObject({
      kind: 'instance',
      componentId: component?.id,
    })
    expect(nodes.some((node) => node.name === 'Opening root')).toBe(false)
    exported.doc.destroy()
  })

  it('aliases a conflicting embedded font without changing target typography', () => {
    const source = sourceFixture()
    const target = legacyProject('Existing')
    const existingTextId = target.api.createNode(
      'text',
      target.scene.rootNodeId,
      {
        name: 'Existing Portable text',
        text: 'Existing',
        fontFamily: 'Portable',
        fontWeight: 400,
      },
    )
    target.api.setCustomFont({
      id: 'target-font',
      name: 'Existing.woff2',
      family: 'Portable',
      weight: 400,
      style: 'normal',
      format: 'woff2',
      bytes: new Uint8Array([9, 9, 9]),
    })

    importScenesFromHypeBytes(target.project, sceneToBytes(source.api.doc))

    expect(target.api.getCustomFont('target-font')?.bytes).toEqual(
      new Uint8Array([9, 9, 9]),
    )
    expect(target.api.getNode(existingTextId)).toMatchObject({
      kind: 'text',
      fontFamily: 'Portable',
    })
    const importedFont = target.api
      .getAllCustomFonts()
      .find((font) => font.bytes[0] === 1)
    expect(importedFont?.family).toMatch(/^Portable \(Imported/)
    const importedText = target.api
      .getAllNodeIds()
      .map((id) => target.api.getNode(id))
      .find((node) => node?.name === 'Card label')
    expect(importedText).toMatchObject({
      kind: 'text',
      fontFamily: importedFont?.family,
    })
  })

  it('reports canvas and frame-rate mismatches without changing target meta', () => {
    const source = sourceFixture()
    const target = legacyProject('Existing')
    target.api.setMeta({
      ...target.api.getMeta(),
      canvas: { width: 1920, height: 1080 },
      frameRate: 30,
    })

    const result = importScenesFromHypeBytes(
      target.project,
      sceneToBytes(source.api.doc),
    )

    expect(result.warnings).toEqual([
      'Imported scenes use 960×540; this project stays 1920×1080.',
      'Imported scenes use 60 FPS; this project stays 30 FPS.',
    ])
    expect(target.api.getMeta()).toMatchObject({
      canvas: { width: 1920, height: 1080 },
      frameRate: 30,
    })
  })

  it('leaves the target untouched when a donor graph is invalid', () => {
    const source = sourceFixture()
    const target = legacyProject('Existing')
    const before = sceneToBytes(target.api.doc)
    source.api.setNodeProperty(
      source.instanceId,
      'componentId',
      'missing-component',
    )

    expect(() =>
      importScenesFromHypeBytes(target.project, sceneToBytes(source.api.doc)),
    ).toThrow(/Referenced node does not exist/)
    expect(sceneToBytes(target.api.doc)).toEqual(before)
  })

  it('rejects ordinary cross-scene references instead of changing their meaning', () => {
    const source = sourceFixture()
    const target = legacyProject('Existing')
    const foreignImageId = source.api.createNode(
      'image',
      source.second.rootNodeId,
      {
        name: 'Foreign image',
        src: 'data:image/png;base64,AA==',
      },
    )
    source.api.setNodeProperty(
      source.shaderId,
      'sourceNodeId',
      foreignImageId,
    )
    const before = sceneToBytes(target.api.doc)

    expect(() =>
      importScenesFromHypeBytes(target.project, sceneToBytes(source.api.doc)),
    ).toThrow(/owned by another scene|cross-scene reference/)
    expect(sceneToBytes(target.api.doc)).toEqual(before)
  })

  it('records a transferred batch as one undoable project change', () => {
    const source = sourceFixture()
    const target = legacyProject('Existing')
    const sceneMap = target.api.doc.getMap<unknown>('scene')
    const undo = new Y.UndoManager(
      [
        sceneMap as Y.AbstractType<unknown>,
        sceneMap.get('nodes') as Y.AbstractType<unknown>,
        sceneMap.get('tracks') as Y.AbstractType<unknown>,
        sceneMap.get('uiState') as Y.AbstractType<unknown>,
        sceneMap.get('compositionScenes') as Y.AbstractType<unknown>,
        sceneMap.get('sequenceItems') as Y.AbstractType<unknown>,
        sceneMap.get('sequenceOrder') as Y.AbstractType<unknown>,
      ],
      { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) },
    )
    const beforeScenes = target.project.getScenes().length
    const beforeNodes = target.api.getAllNodeIds().length

    transferCompositionScenes(source.project, target.project)
    expect(target.project.getScenes()).toHaveLength(beforeScenes + 2)

    undo.undo()
    expect(target.project.getScenes()).toHaveLength(beforeScenes)
    expect(target.project.getSequenceItems()).toHaveLength(beforeScenes)
    expect(target.api.getAllNodeIds()).toHaveLength(beforeNodes)
    expect(target.api.getCustomFont('font-source')).toBeNull()
    expect(target.api.getUiState()).toMatchObject({
      trackGroups: {},
      kfGroups: {},
      kfGroupCollapsed: {},
      staggerSets: {},
    })
    undo.destroy()
  })
})
