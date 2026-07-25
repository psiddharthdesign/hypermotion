// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI, snapshotScene } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import {
  applyInstanceVariantTransition,
  instantiateComponent,
} from '@/ui/actions'
import { getAnimEngine } from '@/anim'
import { normalizeLayerMotionPath } from '@/anim/layerMotionPath'
import {
  CURSOR_ASSET_PAYLOAD_VERSION,
  CURSOR_ASSETS,
  CURSOR_COMPONENT_SIZE,
  CURSOR_MOTION_HOTSPOT,
  CURSOR_STATES,
  type CursorState,
} from './cursorAssets'
import {
  createCursorComponent,
  ensureCursorComponent,
  findCursorComponent,
  isCursorInstance,
  CURSOR_COMPONENT_ID,
} from './cursorComponent'

describe('cursor built-in component', () => {
  it('creates a hidden workspace master with all seven state variants', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })

    const componentId = createCursorComponent(api)
    const component = api.getNode(componentId)
    expect(component?.kind).toBe('component')
    if (!component || component.kind !== 'component') {
      throw new Error('Expected cursor component')
    }

    expect(api.getRoot()).toBe(rootId)
    expect(component.parent).toBeNull()
    expect(component.workspaceOnly).toBe(true)
    expect(component.visible).toBe(false)
    expect(component.locked).toBe(true)
    expect(component.size).toEqual({
      width: CURSOR_COMPONENT_SIZE,
      height: CURSOR_COMPONENT_SIZE,
    })
    expect(component.transform.anchorX).toBe(CURSOR_MOTION_HOTSPOT.x)
    expect(component.transform.anchorY).toBe(CURSOR_MOTION_HOTSPOT.y)
    expect(component.transform.anchorZ).toBe(0)
    expect(component.variants).toEqual([
      { name: 'State', values: [...CURSOR_STATES] },
    ])
    expect(component.defaultSelection).toEqual({ State: 'Default' })
    expect(component.variantTransition).toEqual({
      duration: 0,
      easing: 'linear',
    })

    const stateNodes = cursorStateNodes(api, componentId)
    expect([...stateNodes.keys()]).toEqual([...CURSOR_STATES])
    for (const state of CURSOR_STATES) {
      const vector = stateNodes.get(state)
      expect(vector?.kind).toBe('vector')
      if (!vector || vector.kind !== 'vector') {
        throw new Error(`Expected ${state} vector`)
      }
      expect(vector.vector.items.length).toBeGreaterThan(0)
      expect(vector.importFidelity).toBe('preserved')
      expect(vector.size).toEqual({ width: 'fill', height: 'fill' })
      expect(vector.viewBox).toEqual(CURSOR_ASSETS[state].viewBox)
      expect(vector.source?.originalSvg).toBe(
        CURSOR_ASSETS[state].svg,
      )
      expect(vector.source?.payloadVersion).toBe(
        CURSOR_ASSET_PAYLOAD_VERSION,
      )
      expect(vector.source?.metadata).toMatchObject({
        builtInId: CURSOR_COMPONENT_ID,
        state,
        sourceIcon: CURSOR_ASSETS[state].sourceIcon,
      })
      expect(vector.source?.metadata).not.toHaveProperty('creator')
      expect(vector.source?.metadata).not.toHaveProperty('sourceUrl')
      expect(vector.source?.metadata).not.toHaveProperty('licenseName')
      expect(vector.source?.metadata).not.toHaveProperty('licenseUrl')
      expect(vector.source?.metadata).not.toHaveProperty('copyrightNotice')
      expect(vector.appearance.opacity).toBe(state === 'Default' ? 1 : 0)
    }

    const click = stateNodes.get('Click')
    expect(click?.kind === 'vector' ? click.size : null).toEqual({
      width: 'fill',
      height: 'fill',
    })
    expect(click?.transform.x).toBe(0)
    expect(click?.transform.y).toBe(0)
    expect(click?.transform.scaleX).toBe(0.875)
    expect(click?.transform.scaleY).toBe(0.875)
    expect(click?.kind === 'vector' ? click.source?.metadata?.derivedFrom : null)
      .toBe('Pointer')

    for (const activeState of CURSOR_STATES) {
      const variant = component.variantOverrides.find(
        (candidate) => candidate.match.State === activeState,
      )
      expect(variant).toBeDefined()
      for (const [state, vector] of stateNodes) {
        expect(variant?.overrides[vector.id]).toEqual({
          appearance: { opacity: state === activeState ? 1 : 0 },
        })
      }
    }
  })

  it('finds the master by metadata and stays idempotent across persistence', () => {
    const api = createSceneAPI()
    const componentId = ensureCursorComponent(api)

    api.setNodeProperty(componentId, 'name', 'Renamed cursor')
    expect(findCursorComponent(api)).toBe(componentId)
    expect(ensureCursorComponent(api)).toBe(componentId)

    const reopened = readScene(sceneToBytes(api.doc)).api
    expect(findCursorComponent(reopened)).toBe(componentId)
    expect(ensureCursorComponent(reopened)).toBe(componentId)
    const components = reopened
      .getAllNodeIds()
      .map((id) => reopened.getNode(id))
      .filter((node) => node?.kind === 'component')
    expect(components).toHaveLength(1)
  })

  it('recognizes renamed cursor instances without treating ordinary instances as cursors', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const cursorComponentId = ensureCursorComponent(api)
    const cursorId = instantiateComponent(api, cursorComponentId, rootId, {
      absolute: true,
      position: { x: 120, y: 80 },
    })
    if (!cursorId) throw new Error('Expected cursor instance')
    api.setNodeProperty(cursorId, 'name', 'Presentation pointer')

    const ordinaryComponentId = api.createNode('component', null, {
      name: 'Ordinary component',
      workspaceOnly: true,
      size: { width: 48, height: 48 },
    })
    const ordinaryId = instantiateComponent(
      api,
      ordinaryComponentId,
      rootId,
      {
        absolute: true,
        position: { x: 220, y: 80 },
      },
    )
    if (!ordinaryId) throw new Error('Expected ordinary instance')

    expect(isCursorInstance(api, cursorId)).toBe(true)
    expect(isCursorInstance(api, api.getNode(cursorId))).toBe(true)
    expect(isCursorInstance(api, ordinaryId)).toBe(false)
    expect(isCursorInstance(api, rootId)).toBe(false)
  })

  it('uses ordinary transform keyframes and ignores retired cursor paths', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const componentId = ensureCursorComponent(api)
    const cursorId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      position: { x: 120, y: 80 },
    })
    if (!cursorId) throw new Error('Expected cursor instance')

    api.setNodeProperty(
      cursorId,
      'motionPath',
      normalizeLayerMotionPath({
        version: 1,
        progress: 0,
        points: [
          { id: 'start', t: 0, x: 0, y: 0, z: 0 },
          { id: 'end', t: 1, x: 400, y: 300, z: 80 },
        ],
      }),
    )
    api.setTrack({
      id: 'retired-cursor-path',
      nodeId: cursorId,
      propertyId: 'motionPath.progress',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'path-start', time: 0, value: 0 },
        { id: 'path-end', time: 1, value: 1 },
      ],
    })
    api.setTrack({
      id: 'cursor-x',
      nodeId: cursorId,
      propertyId: 'transform.x',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'x-start', time: 0, value: 100 },
        { id: 'x-end', time: 1, value: 200 },
      ],
    })
    api.setTrack({
      id: 'cursor-y',
      nodeId: cursorId,
      propertyId: 'transform.y',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'y-start', time: 0, value: 80 },
        { id: 'y-end', time: 1, value: 120 },
      ],
    })

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.5)

    expect(engine.getSnapshot()[cursorId]).toMatchObject({
      x: 150,
      y: 100,
    })
    expect(
      engine.getSnapshot()[cursorId]?.motionPathProgress,
    ).toBeUndefined()
  })

  it('removes retired cursor paths on load without touching ordinary layer paths', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const componentId = ensureCursorComponent(api)
    const cursorId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      position: { x: 120, y: 80 },
    })
    if (!cursorId) throw new Error('Expected cursor instance')

    const motionPath = normalizeLayerMotionPath({
      version: 1,
      progress: 0,
      points: [
        { id: 'start', t: 0, x: 0, y: 0, z: 0 },
        { id: 'end', t: 1, x: 240, y: 120, z: 0 },
      ],
    })
    api.setNodeProperty(cursorId, 'motionPath', motionPath)
    api.setTrack({
      id: 'cursor-path-progress',
      nodeId: cursorId,
      propertyId: 'motionPath.progress',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'cursor-start', time: 0, value: 0 },
        { id: 'cursor-end', time: 1, value: 1 },
      ],
    })

    const ordinaryId = api.createNode('rect', rootId, {
      name: 'Ordinary path layer',
      size: { width: 80, height: 80 },
      motionPath,
    })
    api.setTrack({
      id: 'ordinary-path-progress',
      nodeId: ordinaryId,
      propertyId: 'motionPath.progress',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'ordinary-start', time: 0, value: 0 },
        { id: 'ordinary-end', time: 1, value: 1 },
      ],
    })

    const reopened = readScene(sceneToBytes(api.doc)).api
    expect(reopened.getNode(cursorId)?.motionPath).toBeNull()
    expect(reopened.getTrack('cursor-path-progress')).toBeNull()
    expect(reopened.getNode(ordinaryId)?.motionPath).toEqual(motionPath)
    expect(reopened.getTrack('ordinary-path-progress')).not.toBeNull()
  })

  it('migrates the padded 32 px cursor and repairs compensatory scale', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const componentId = createCursorComponent(api)
    api.setNodeProperty(componentId, 'size', { width: 32, height: 32 })

    for (const [, vector] of cursorStateNodes(api, componentId)) {
      if (vector.kind !== 'vector') continue
      if (!vector.source) throw new Error('Expected cursor vector source')
      api.setNodeProperty(vector.id, 'size', { width: 32, height: 32 })
      api.setNodeProperty(vector.id, 'viewBox', {
        x: 0,
        y: 0,
        width: 32,
        height: 32,
      })
      api.setNodeProperty(vector.id, 'source', {
        ...vector.source,
        payloadVersion: 1,
      })
    }

    const instanceId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      position: { x: 120, y: 80 },
    })
    if (!instanceId) throw new Error('Expected cursor instance')
    const instance = api.getNode(instanceId)
    if (!instance || instance.kind !== 'instance') {
      throw new Error('Expected cursor instance node')
    }
    api.setNodeProperty(instanceId, 'transform', {
      ...instance.transform,
      scaleX: 12,
      scaleY: 12,
    })
    const scene = api.doc.getMap<unknown>('scene')
    const nodes = scene.get('nodes') as Y.Map<Y.Map<unknown>>
    nodes.get(instanceId)?.delete('alwaysOnTop')

    const reopened = readScene(sceneToBytes(api.doc)).api
    const migratedMaster = reopened.getNode(componentId)
    const migratedInstance = reopened.getNode(instanceId)
    expect(
      migratedMaster?.kind === 'component' ? migratedMaster.size : null,
    ).toEqual({
      width: CURSOR_COMPONENT_SIZE,
      height: CURSOR_COMPONENT_SIZE,
    })
    expect(
      migratedInstance?.kind === 'instance' ? migratedInstance.size : null,
    ).toEqual({
      width: CURSOR_COMPONENT_SIZE,
      height: CURSOR_COMPONENT_SIZE,
    })
    expect(migratedInstance?.transform.scaleX).toBe(1)
    expect(migratedInstance?.transform.scaleY).toBe(1)
    expect(
      migratedInstance?.kind === 'instance'
        ? migratedInstance.alwaysOnTop
        : null,
    ).toBe(true)

    reopened.setNodeProperty(instanceId, 'alwaysOnTop', false)
    const reopenedAgain = readScene(sceneToBytes(reopened.doc)).api
    const reopenedAgainInstance = reopenedAgain.getNode(instanceId)
    expect(
      reopenedAgainInstance?.kind === 'instance'
        ? reopenedAgainInstance.alwaysOnTop
        : null,
    ).toBe(false)

    for (const parentId of [componentId, instanceId]) {
      for (const [state, vector] of cursorStateNodes(reopened, parentId)) {
        if (vector.kind !== 'vector') continue
        expect(vector.size).toEqual({ width: 'fill', height: 'fill' })
        expect(vector.viewBox).toEqual(CURSOR_ASSETS[state].viewBox)
        expect(vector.source?.payloadVersion).toBe(
          CURSOR_ASSET_PAYLOAD_VERSION,
        )
        expect(vector.transform.scaleX).toBe(CURSOR_ASSETS[state].scale)
        expect(vector.transform.scaleY).toBe(CURSOR_ASSETS[state].scale)
      }
    }
  })

  it('moves historical centered cursors to the tip without overwriting authored pivots', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const componentId = createCursorComponent(api)

    const centeredId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      position: { x: 120, y: 80 },
    })
    const customId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      position: { x: 220, y: 80 },
    })
    const animatedId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      position: { x: 320, y: 80 },
    })
    if (!centeredId || !customId || !animatedId) {
      throw new Error('Expected cursor instances')
    }

    const centered = api.getNode(centeredId)
    const custom = api.getNode(customId)
    const animated = api.getNode(animatedId)
    const component = api.getNode(componentId)
    if (!centered || !custom || !animated || !component) {
      throw new Error('Expected cursor nodes')
    }

    api.setNodeProperty(componentId, 'transform', {
      ...component.transform,
      anchorX: 0.5,
      anchorY: 0.5,
    })
    api.setNodeProperty(centeredId, 'transform', {
      ...centered.transform,
      anchorX: 0.5,
      anchorY: 0.5,
    })
    api.setNodeProperty(customId, 'transform', {
      ...custom.transform,
      anchorX: 0.25,
      anchorY: 0.75,
    })
    api.setNodeProperty(animatedId, 'transform', {
      ...animated.transform,
      anchorX: 0.5,
      anchorY: 0.5,
    })
    api.setTrack({
      id: 'cursor-anchor-x',
      nodeId: animatedId,
      propertyId: 'transform.anchorX',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'anchor-start', time: 0, value: 0.5 },
        { id: 'anchor-end', time: 1, value: 0.2 },
      ],
    })

    const reopened = readScene(sceneToBytes(api.doc)).api
    const migratedMaster = reopened.getNode(componentId)
    const migratedCentered = reopened.getNode(centeredId)
    const preservedCustom = reopened.getNode(customId)
    const preservedAnimated = reopened.getNode(animatedId)

    expect(migratedMaster?.transform.anchorX).toBe(CURSOR_MOTION_HOTSPOT.x)
    expect(migratedMaster?.transform.anchorY).toBe(CURSOR_MOTION_HOTSPOT.y)
    expect(migratedCentered?.transform.anchorX).toBe(CURSOR_MOTION_HOTSPOT.x)
    expect(migratedCentered?.transform.anchorY).toBe(CURSOR_MOTION_HOTSPOT.y)
    expect(preservedCustom?.transform.anchorX).toBe(0.25)
    expect(preservedCustom?.transform.anchorY).toBe(0.75)
    expect(preservedAnimated?.transform.anchorX).toBe(0.5)
    expect(preservedAnimated?.transform.anchorY).toBe(0.5)
    expect(reopened.getTrack('cursor-anchor-x')?.keyframes).toEqual([
      { id: 'anchor-start', time: 0, value: 0.5 },
      { id: 'anchor-end', time: 1, value: 0.2 },
    ])
  })

  it('removes obsolete provider labels and metadata from existing scenes', () => {
    const provider = ['Nu', 'cleo'].join('')
    const legacyBuiltInId =
      `hypermotion.builtin.${provider.toLowerCase()}-cursor.v1`
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const componentId = createCursorComponent(api)
    api.setNodeProperty(componentId, 'name', `${provider} Cursor`)

    const legacyStateNodes = cursorStateNodes(api, componentId)
    for (const [state, node] of legacyStateNodes) {
      if (node.kind !== 'vector') continue
      if (!node.source) throw new Error('Expected cursor vector source')
      api.setNodeProperty(node.id, 'source', {
        ...node.source,
        metadata: {
          ...node.source?.metadata,
          builtInId: legacyBuiltInId,
          creator: provider,
          sourceUrl: `https://${provider.toLowerCase()}.example/cursors`,
          licenseName: `${provider} Icons License`,
          copyrightNotice: `Copyright ${provider}`,
        },
      })
      api.setNodeProperty(node.id, 'vector', {
        ...node.vector,
        items: node.vector.items.map((item, index) => ({
          ...item,
          id: `${provider.toLowerCase()}-${state.toLowerCase()}-${index + 1}`,
        })),
      })
    }

    const instanceId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      alwaysOnTop: true,
      position: { x: 120, y: 80 },
    })
    expect(instanceId).not.toBeNull()

    const reopened = readScene(sceneToBytes(api.doc)).api
    const migratedComponentId = findCursorComponent(reopened)
    expect(migratedComponentId).toBe(componentId)
    expect(reopened.getNode(componentId)?.name).toBe('Cursor')
    expect(instanceId ? reopened.getNode(instanceId)?.name : null).toBe(
      'Cursor instance',
    )

    const serialized = JSON.stringify(snapshotScene(reopened))
    expect(serialized.toLowerCase()).not.toContain(provider.toLowerCase())
    for (const parentId of [componentId, instanceId].filter(
      (id): id is string => Boolean(id),
    )) {
      for (const [state, node] of cursorStateNodes(reopened, parentId)) {
        if (node.kind !== 'vector') continue
        expect(node.source?.metadata).toEqual({
          builtInId: CURSOR_COMPONENT_ID,
          state,
          sourceIcon: CURSOR_ASSETS[state].sourceIcon,
          ...(CURSOR_ASSETS[state].derivedFrom
            ? { derivedFrom: CURSOR_ASSETS[state].derivedFrom }
            : {}),
        })
        expect(
          node.vector.items.every((item) =>
            item.id.startsWith(`cursor-${state.toLowerCase()}-`),
          ),
        ).toBe(true)
      }
    }
  })

  it('switches state statically without creating timeline clutter', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const componentId = ensureCursorComponent(api)
    const instanceId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      alwaysOnTop: true,
      position: { x: 120, y: 80 },
    })
    expect(instanceId).not.toBeNull()
    if (!instanceId) throw new Error('Expected cursor instance')

    const instance = api.getNode(instanceId)
    expect(instance?.kind).toBe('instance')
    expect(instance?.visible).toBe(true)
    expect(instance?.kind === 'instance' ? instance.alwaysOnTop : null).toBe(
      true,
    )
    const stateNodes = cursorStateNodes(api, instanceId)
    expect(stateNodes.size).toBe(CURSOR_STATES.length)
    expect(stateNodes.get('Default')?.appearance.opacity).toBe(1)

    applyInstanceVariantTransition(api, instanceId, { State: 'Click' }, {
      playhead: 2,
      keyframe: false,
    })

    const updated = api.getNode(instanceId)
    expect(updated?.kind === 'instance' ? updated.selection : null).toEqual({
      State: 'Click',
    })
    const updatedStateNodes = cursorStateNodes(api, instanceId)
    for (const state of CURSOR_STATES) {
      expect(updatedStateNodes.get(state)?.appearance.opacity).toBe(
        state === 'Click' ? 1 : 0,
      )
      expect(api.getTracksForNode(updatedStateNodes.get(state)!.id)).toEqual(
        [],
      )
    }
    expect(api.getTracksForNode(instanceId)).toEqual([])
  })

  it('authors one stepped State track and evaluates it while scrubbing', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const componentId = ensureCursorComponent(api)
    const instanceId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      alwaysOnTop: true,
      position: { x: 120, y: 80 },
    })
    if (!instanceId) throw new Error('Expected cursor instance')

    applyInstanceVariantTransition(api, instanceId, { State: 'Default' }, {
      playhead: 0,
      keyframe: true,
    })
    applyInstanceVariantTransition(api, instanceId, { State: 'Pointer' }, {
      playhead: 1,
      keyframe: false,
    })
    applyInstanceVariantTransition(api, instanceId, { State: 'Grab' }, {
      playhead: 2,
      keyframe: false,
    })

    const beforeReplacement = api
      .getTracksForNode(instanceId)
      .find((track) => track.propertyId === 'variant')
    const replacedKeyId = beforeReplacement?.keyframes[2]?.id
    applyInstanceVariantTransition(api, instanceId, { State: 'Click' }, {
      playhead: 2,
      keyframe: false,
    })

    const stateTrack = api
      .getTracksForNode(instanceId)
      .find((track) => track.propertyId === 'variant')
    if (!stateTrack) throw new Error('Expected semantic State track')
    expect(stateTrack.defaultEasing).toBe('ease-in-out')
    expect(stateTrack.keyframes).toHaveLength(3)
    expect(stateTrack.keyframes.map(({ time, value }) => ({ time, value })))
      .toEqual([
        { time: 0, value: { State: 'Default' } },
        { time: 1, value: { State: 'Pointer' } },
        { time: 2, value: { State: 'Click' } },
      ])
    expect(stateTrack.keyframes[2]?.id).toBe(replacedKeyId)
    expect(api.getAllTracks()).toHaveLength(1)

    // Discrete State keys land exactly on the destination time even if an
    // easing curve overshoots above 1 between the keys.
    api.setTrack({
      ...stateTrack,
      keyframes: stateTrack.keyframes.map((keyframe, index) =>
        index === 0
          ? {
              ...keyframe,
              easingOut: { bezier: [0.2, 2, 0.8, 2] },
            }
          : keyframe,
      ),
    })

    const stateNodes = cursorStateNodes(api, instanceId)
    for (const stateNode of stateNodes.values()) {
      expect(api.getTracksForNode(stateNode.id)).toEqual([])
    }

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.5)
    expect(engine.getSnapshot()[instanceId]?.variant).toEqual({
      State: 'Default',
    })
    engine.seek(0.999)
    expect(engine.getSnapshot()[instanceId]?.variant).toEqual({
      State: 'Default',
    })
    expect(engine.getSnapshot()[stateNodes.get('Default')!.id]?.opacity).toBe(1)

    engine.seek(1)
    expect(engine.getSnapshot()[instanceId]?.variant).toEqual({
      State: 'Pointer',
    })
    expect(engine.getSnapshot()[stateNodes.get('Pointer')!.id]?.opacity).toBe(1)
    expect(engine.getSnapshot()[stateNodes.get('Default')!.id]?.opacity).toBe(0)

    engine.seek(1.999)
    expect(engine.getSnapshot()[instanceId]?.variant).toEqual({
      State: 'Pointer',
    })
    engine.seek(2)
    expect(engine.getSnapshot()[instanceId]?.variant).toEqual({
      State: 'Click',
    })
    expect(engine.getSnapshot()[stateNodes.get('Pointer')!.id]?.opacity).toBe(0)
    expect(engine.getSnapshot()[stateNodes.get('Click')!.id]?.opacity).toBe(1)

    engine.seek(0.5)
    expect(engine.getSnapshot()[instanceId]?.variant).toEqual({
      State: 'Default',
    })

    const reopened = readScene(sceneToBytes(api.doc)).api
    expect(
      reopened
        .getTracksForNode(instanceId)
        .find((track) => track.propertyId === 'variant')
        ?.keyframes.map((keyframe) => keyframe.value),
    ).toEqual([
      { State: 'Default' },
      { State: 'Pointer' },
      { State: 'Click' },
    ])
  })

  it('keeps legacy child-opacity cursor tracks playable', () => {
    const api = createSceneAPI()
    const rootId = api.createNode('frame', null, {
      name: 'Artboard',
      size: { width: 960, height: 540 },
    })
    const componentId = ensureCursorComponent(api)
    const instanceId = instantiateComponent(api, componentId, rootId, {
      absolute: true,
      position: { x: 120, y: 80 },
    })
    if (!instanceId) throw new Error('Expected cursor instance')
    const stateNodes = cursorStateNodes(api, instanceId)

    for (const state of ['Default', 'Click'] as const) {
      const nodeId = stateNodes.get(state)!.id
      api.setTrack({
        id: `legacy-${state}`,
        nodeId,
        propertyId: 'appearance.opacity',
        defaultEasing: 'linear',
        keyframes: [
          {
            id: `${state}-before`,
            time: 1,
            value: state === 'Default' ? 1 : 0,
          },
          {
            id: `${state}-after`,
            time: 2,
            value: state === 'Click' ? 1 : 0,
          },
        ],
      })
    }

    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(1)
    expect(engine.getSnapshot()[stateNodes.get('Default')!.id]?.opacity).toBe(1)
    expect(engine.getSnapshot()[stateNodes.get('Click')!.id]?.opacity).toBe(0)
    engine.seek(2)
    expect(engine.getSnapshot()[stateNodes.get('Default')!.id]?.opacity).toBe(0)
    expect(engine.getSnapshot()[stateNodes.get('Click')!.id]?.opacity).toBe(1)
  })
})

function cursorStateNodes(
  api: ReturnType<typeof createSceneAPI>,
  parentId: string,
) {
  const out = new Map<
    CursorState,
    Exclude<ReturnType<typeof api.getNode>, null>
  >()
  for (const child of api.getChildren(parentId)) {
    if (child.kind !== 'vector') continue
    const state = child.source?.metadata?.state
    if (
      typeof state === 'string' &&
      (CURSOR_STATES as readonly string[]).includes(state)
    ) {
      out.set(state as CursorState, child)
    }
  }
  return out
}
