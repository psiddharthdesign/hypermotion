// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { PropertyId, Track } from '@/scene'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { addKeyframe, findTrack } from './tracks'
import {
  DEFAULT_TEXT_ANIMATION,
  type TextAnimationConfig,
} from './textAnimations'
import {
  createStaggerSetReturn,
  deleteStaggerSetKeyframes,
  deleteStaggerSet,
  detachStaggerSetKeyframes,
  detachStaggerSetLayers,
  duplicateStaggerSet,
  findStaggerSetMemberTrack,
  inspectStaggerSetProperty,
  inspectStaggerSetPropertyFromMember,
  patchStaggerKeyframeBundle,
  removeStaggerSet,
  renameStaggerSet,
  registerStaggerSetKeyframes,
  reverseStaggerSetInPlace,
  resolveStaggerKeyframeBundle,
  resolveStaggerSetSourceNodeId,
  resolveStaggerTrackBundle,
  retimeStaggerSet,
  stampStaggerSetPatch,
  staggerSetPropertyIds,
  toggleStaggerSetPropertyKeyframes,
  toggleStaggerSetPropertyFromMember,
  type StaggerPropertyTarget,
} from './staggerSets'

function textTrack(
  id: string,
  nodeId: string,
  start: number,
  end: number,
): Track & { textAnimation: TextAnimationConfig } {
  const textAnimation = { ...DEFAULT_TEXT_ANIMATION, startTime: start }
  return {
    id,
    nodeId,
    propertyId: 'text.progress',
    defaultEasing: 'ease-out',
    textAnimation,
    keyframes: [
      { id: `${id}-start`, time: start, value: 0 },
      { id: `${id}-end`, time: end, value: 1 },
    ],
  }
}

function setup() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { name: 'Root' })
  const layers = ['A', 'B', 'C'].map((name) =>
    api.createNode('frame', root, { name }),
  )
  const values = [10, 20, 30]
  const targets: StaggerPropertyTarget[] = layers.map((nodeId, index) => ({
    nodeId,
    currentValue: values[index]!,
  }))
  const options = {
    setId: 'set-1',
    layerIds: layers,
    delay: 0.1,
    order: 'forward' as const,
  }
  return { api, layers, targets, options }
}

function times(
  api: ReturnType<typeof createSceneAPI>,
  nodeId: string,
  propertyId: PropertyId,
) {
  return findTrack(api, nodeId, propertyId)?.keyframes.map((keyframe) =>
    keyframe.time,
  )
}

function ownedKeyframes(
  api: ReturnType<typeof createSceneAPI>,
  setId: string,
  nodeId: string,
  propertyId: PropertyId,
) {
  const ids = new Set(
    api.getUiState().staggerSets[setId]?.members[nodeId]?.[propertyId] ?? [],
  )
  return api
    .getTracksForNode(nodeId)
    .filter((track) => track.propertyId === propertyId)
    .flatMap((track) => track.keyframes.filter((keyframe) => ids.has(keyframe.id)))
    .sort((a, b) => a.time - b.time)
}

describe('stagger property keyframe sets', () => {
  it('resolves the first live owned member in stagger playback order', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )
    const authored = api.getUiState().staggerSets['set-1']!

    expect(resolveStaggerSetSourceNodeId(api, authored)).toBe(layers[0])
    expect(
      resolveStaggerSetSourceNodeId(api, {
        ...authored,
        order: 'reverse',
      }),
    ).toBe(layers[2])

    const withoutFirstMember = {
      ...authored,
      members: {
        ...authored.members,
        [layers[0]!]: {},
      },
    }
    expect(resolveStaggerSetSourceNodeId(api, withoutFirstMember)).toBe(
      layers[1],
    )
  })

  it('authors one property as layer-offset sets and persists membership', () => {
    const { api, layers, targets, options } = setup()
    let updates = 0
    api.doc.on('update', () => updates++)

    const result = toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      1,
      options,
    )

    expect(result.action).toBe('added')
    expect(result.trackIds).toHaveLength(3)
    expect(times(api, layers[0]!, 'transform.x')).toEqual([1])
    expect(times(api, layers[1]!, 'transform.x')).toEqual([1.1])
    expect(times(api, layers[2]!, 'transform.x')).toEqual([1.2])
    const set = api.getUiState().staggerSets['set-1']
    expect(set?.layerIds).toEqual(layers)
    expect(staggerSetPropertyIds(set)).toEqual(['transform.x'])
    expect(updates).toBe(1)
    expect(
      inspectStaggerSetProperty(
        api,
        targets,
        'transform.x',
        1,
        options,
      ).state,
    ).toBe('at')
  })

  it('accepts more properties and later keyframes after already staggering', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )

    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.rotation',
      0,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      2,
      options,
    )

    expect(times(api, layers[0]!, 'transform.x')).toEqual([0, 2])
    expect(times(api, layers[1]!, 'transform.x')).toEqual([0.1, 2.1])
    expect(times(api, layers[2]!, 'transform.x')).toEqual([0.2, 2.2])
    expect(times(api, layers[1]!, 'transform.rotation')).toEqual([0.1])
    const set = api.getUiState().staggerSets['set-1']
    expect(new Set(staggerSetPropertyIds(set))).toEqual(
      new Set(['transform.x', 'transform.rotation']),
    )
    // Stagger membership stays in the dedicated stagger-set model; it no
    // longer produces synthetic generic keyframe groups in the timeline.
    expect(api.getUiState().kfGroups).toEqual({})
  })

  it('authors a newly introduced leader property exactly on every member', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )

    toggleStaggerSetPropertyFromMember(
      api,
      options.setId,
      layers[0]!,
      'appearance.opacity',
      2,
      0,
    )
    toggleStaggerSetPropertyFromMember(
      api,
      options.setId,
      layers[0]!,
      'appearance.opacity',
      3,
      1,
    )

    expect(times(api, layers[0]!, 'appearance.opacity')).toEqual([2, 3])
    expect(times(api, layers[1]!, 'appearance.opacity')).toEqual([2.1, 3.1])
    expect(times(api, layers[2]!, 'appearance.opacity')).toEqual([2.2, 3.2])
    for (const nodeId of layers) {
      expect(
        findTrack(api, nodeId, 'appearance.opacity')?.keyframes.map(
          (keyframe) => keyframe.value,
        ),
      ).toEqual([0, 1])
    }
  })

  it('adopts a complete leader property track across the stagger and undoes atomically', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )

    const followerOpacities = [0, 0.4, 0.7]
    layers.forEach((nodeId, index) => {
      const node = api.getNode(nodeId)!
      api.setNodeProperty(nodeId, 'appearance', {
        ...node.appearance,
        opacity: followerOpacities[index]!,
      })
    })

    const curve = {
      bezier: [0.12, 0.7, 0.28, 1] as [number, number, number, number],
    }
    // This is the pre-fix path: both keys exist only on the visible leader and
    // the stagger relationship has no opacity membership at all.
    addKeyframe(api, layers[0]!, 'appearance.opacity', 2, 0, curve)
    addKeyframe(api, layers[0]!, 'appearance.opacity', 3, 1)
    const sourceTrack = findTrack(api, layers[0]!, 'appearance.opacity')!
    api.setTrack({ ...sourceTrack, defaultEasing: 'ease-out' })
    expect(times(api, layers[0]!, 'appearance.opacity')).toEqual([2, 3])
    expect(times(api, layers[1]!, 'appearance.opacity')).toBeUndefined()

    const scene = api.doc.getMap('scene')
    const tracks = scene.get('tracks') as Y.Map<unknown>
    const uiState = scene.get('uiState') as Y.Map<unknown>
    const undo = new Y.UndoManager([scene, tracks, uiState], {
      captureTimeout: 500,
      trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]),
    })
    const closeGestureCapture = (transaction: Y.Transaction) => {
      if (transaction.origin === UNDOABLE_GESTURE_ORIGIN) {
        undo.stopCapturing()
      }
    }
    api.doc.on('afterTransaction', closeGestureCapture)

    expect(
      toggleStaggerSetPropertyFromMember(
        api,
        options.setId,
        layers[0]!,
        'appearance.opacity',
        2,
        0,
      )?.action,
    ).toBe('added')

    expect(times(api, layers[0]!, 'appearance.opacity')).toEqual([2, 3])
    expect(times(api, layers[1]!, 'appearance.opacity')).toEqual([2.1, 3.1])
    expect(times(api, layers[2]!, 'appearance.opacity')).toEqual([2.2, 3.2])
    const adoptedSet = api.getUiState().staggerSets['set-1']!
    for (const nodeId of layers) {
      const track = findTrack(api, nodeId, 'appearance.opacity')!
      expect(track.keyframes.map((keyframe) => keyframe.value)).toEqual([0, 1])
      expect(track.keyframes[0]?.easingOut).toEqual(curve)
      expect(track.defaultEasing).toBe('ease-out')
      expect(adoptedSet.members[nodeId]?.['appearance.opacity']).toEqual(
        track.keyframes.map((keyframe) => keyframe.id),
      )
    }
    expect(
      inspectStaggerSetPropertyFromMember(
        api,
        options.setId,
        layers[0]!,
        'appearance.opacity',
        2,
      )?.state,
    ).toBe('at')
    expect(
      inspectStaggerSetPropertyFromMember(
        api,
        options.setId,
        layers[0]!,
        'appearance.opacity',
        3,
      )?.state,
    ).toBe('at')
    expect(
      new Set(
        staggerSetPropertyIds(api.getUiState().staggerSets['set-1']),
      ),
    ).toEqual(new Set(['transform.x', 'appearance.opacity']))

    undo.undo()
    expect(times(api, layers[0]!, 'appearance.opacity')).toEqual([2, 3])
    expect(times(api, layers[1]!, 'appearance.opacity')).toBeUndefined()
    expect(times(api, layers[2]!, 'appearance.opacity')).toBeUndefined()
    expect(
      staggerSetPropertyIds(api.getUiState().staggerSets['set-1']),
    ).toEqual(['transform.x'])

    undo.redo()
    expect(times(api, layers[1]!, 'appearance.opacity')).toEqual([2.1, 3.1])
    expect(times(api, layers[2]!, 'appearance.opacity')).toEqual([2.2, 3.2])

    api.doc.off('afterTransaction', closeGestureCapture)
    undo.destroy()
  })

  it('rebases a leader-only property track for reverse stagger order', () => {
    const { api, layers, targets, options } = setup()
    const reverse = { ...options, order: 'reverse' as const }
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      reverse,
    )
    addKeyframe(api, layers[2]!, 'appearance.opacity', 2, 0)
    addKeyframe(api, layers[2]!, 'appearance.opacity', 3, 1)

    expect(
      toggleStaggerSetPropertyFromMember(
        api,
        reverse.setId,
        layers[2]!,
        'appearance.opacity',
        2,
        0,
      )?.action,
    ).toBe('added')

    expect(times(api, layers[0]!, 'appearance.opacity')).toEqual([2.2, 3.2])
    expect(times(api, layers[1]!, 'appearance.opacity')).toEqual([2.1, 3.1])
    expect(times(api, layers[2]!, 'appearance.opacity')).toEqual([2, 3])
    for (const nodeId of layers) {
      expect(
        findTrack(api, nodeId, 'appearance.opacity')?.keyframes.map(
          (keyframe) => keyframe.value,
        ),
      ).toEqual([0, 1])
    }
  })

  it('does not silently reattach a property detached from the stagger', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )
    toggleStaggerSetPropertyFromMember(
      api,
      options.setId,
      layers[0]!,
      'appearance.opacity',
      2,
      0,
    )
    toggleStaggerSetPropertyFromMember(
      api,
      options.setId,
      layers[0]!,
      'appearance.opacity',
      3,
      1,
    )
    const opacityMembers = layers.map((nodeId) => {
      const track = findTrack(api, nodeId, 'appearance.opacity')!
      return {
        nodeId,
        propertyId: 'appearance.opacity' as const,
        keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
      }
    })
    const before = layers.map((nodeId) =>
      findTrack(api, nodeId, 'appearance.opacity')?.keyframes,
    )

    expect(
      detachStaggerSetKeyframes(api, options.setId, opacityMembers),
    ).toBe(true)
    expect(
      staggerSetPropertyIds(api.getUiState().staggerSets['set-1']),
    ).toEqual(['transform.x'])

    const trackIds = stampStaggerSetPatch(
      api,
      3,
      'appearance',
      { opacity: 0.75 },
      'active-track',
      options,
    )

    expect(trackIds).toEqual([])
    expect(
      layers.map(
        (nodeId) =>
          findTrack(api, nodeId, 'appearance.opacity')?.keyframes,
      ),
    ).toEqual(before)
    expect(
      staggerSetPropertyIds(api.getUiState().staggerSets['set-1']),
    ).toEqual(['transform.x'])
  })

  it('appends later property edits at the same per-layer offsets', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )

    const trackIds = stampStaggerSetPatch(
      api,
      3,
      'transform',
      { x: 120 },
      'active-track',
      options,
    )

    expect(trackIds).toHaveLength(3)
    expect(times(api, layers[0]!, 'transform.x')).toEqual([0, 3])
    expect(times(api, layers[1]!, 'transform.x')).toEqual([0.1, 3.1])
    expect(times(api, layers[2]!, 'transform.x')).toEqual([0.2, 3.2])
  })

  it('retimes only set members when delay changes', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.y',
      1,
      options,
    )
    // Hand-authored key on the same track is deliberately outside the set.
    addKeyframe(api, layers[2]!, 'transform.y', 5, 999)

    expect(retimeStaggerSet(api, 'set-1', 0.25)).toBe(true)
    expect(times(api, layers[0]!, 'transform.y')).toEqual([1])
    expect(times(api, layers[1]!, 'transform.y')).toEqual([1.25])
    expect(times(api, layers[2]!, 'transform.y')).toEqual([1.5, 5])
    expect(api.getUiState().staggerSets['set-1']?.delay).toBe(0.25)
  })

  it('applies value, curve, and time edits exactly across a linked bundle', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      1,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      3,
      options,
    )
    const editedTrack = findTrack(api, layers[1]!, 'transform.x')!
    const editedKeyframe = editedTrack.keyframes[0]!
    const curve = {
      bezier: [0.15, 0.7, 0.3, 1] as [number, number, number, number],
    }

    const before = resolveStaggerKeyframeBundle(
      api,
      editedTrack.id,
      editedKeyframe.id,
    )
    expect(before?.members).toHaveLength(3)
    expect(
      patchStaggerKeyframeBundle(api, editedTrack.id, editedKeyframe.id, {
        time: 1.35,
        value: 444,
        easingOut: curve,
      }),
    ).not.toBeNull()

    expect(times(api, layers[0]!, 'transform.x')).toEqual([1.25, 3])
    expect(times(api, layers[1]!, 'transform.x')).toEqual([1.35, 3.1])
    expect(times(api, layers[2]!, 'transform.x')).toEqual([1.45, 3.2])
    for (const nodeId of layers) {
      const keyframe = findTrack(api, nodeId, 'transform.x')!.keyframes[0]!
      expect(keyframe.value).toBe(444)
      expect(keyframe.easingOut).toEqual(curve)
    }
  })

  it('restores stagger timing and metadata with one undo', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.y',
      1,
      options,
    )
    const scene = api.doc.getMap('scene')
    const tracks = scene.get('tracks') as Y.Map<unknown>
    const uiState = scene.get('uiState') as Y.Map<unknown>
    const undo = new Y.UndoManager([scene, tracks, uiState], {
      captureTimeout: 500,
      trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]),
    })
    const closeGestureCapture = (transaction: Y.Transaction) => {
      if (transaction.origin === UNDOABLE_GESTURE_ORIGIN) {
        undo.stopCapturing()
      }
    }
    api.doc.on('afterTransaction', closeGestureCapture)

    expect(retimeStaggerSet(api, 'set-1', 0.4)).toBe(true)
    expect(times(api, layers[1]!, 'transform.y')).toEqual([1.4])
    expect(times(api, layers[2]!, 'transform.y')).toEqual([1.8])
    expect(api.getUiState().staggerSets['set-1']?.delay).toBe(0.4)

    undo.undo()
    expect(times(api, layers[0]!, 'transform.y')).toEqual([1])
    expect(times(api, layers[1]!, 'transform.y')).toEqual([1.1])
    expect(times(api, layers[2]!, 'transform.y')).toEqual([1.2])
    expect(api.getUiState().staggerSets['set-1']?.delay).toBe(0.1)

    api.doc.off('afterTransaction', closeGestureCapture)
    undo.destroy()
  })

  it('removes the base-time member set without touching later members', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.z',
      0,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.z',
      2,
      options,
    )
    const result = toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.z',
      0,
      options,
    )

    expect(result.action).toBe('removed')
    expect(times(api, layers[0]!, 'transform.z')).toEqual([2])
    expect(times(api, layers[1]!, 'transform.z')).toEqual([2.1])
    expect(times(api, layers[2]!, 'transform.z')).toEqual([2.2])
    expect(api.getUiState().staggerSets['set-1']).not.toBeNull()
  })

  it('can be renamed and dissolved later without deleting keyframes', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      1,
      options,
    )

    expect(renameStaggerSet(api, 'set-1', 'Card cascade')).toBe(true)
    expect(api.getUiState().staggerSets['set-1']?.name).toBe('Card cascade')
    expect(removeStaggerSet(api, 'set-1')).toBe(true)
    expect(api.getUiState().staggerSets['set-1']).toBeUndefined()
    expect(times(api, layers[0]!, 'transform.x')).toEqual([1])
    expect(times(api, layers[1]!, 'transform.x')).toEqual([1.1])
    expect(times(api, layers[2]!, 'transform.x')).toEqual([1.2])
  })

  it('removes legacy synthetic stagger groups without touching manual groups', () => {
    const { api, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )
    api.setUiState({
      kfGroups: {
        'stagger-set:set-1:layer-a': ['legacy:key'],
        manual: ['track:key-a', 'track:key-b'],
      },
      kfGroupCollapsed: {
        'stagger-set:set-1:layer-a': true,
        manual: true,
      },
    })

    renameStaggerSet(api, 'set-1', 'Cascade')

    expect(api.getUiState().kfGroups).toEqual({
      manual: ['track:key-a', 'track:key-b'],
    })
    expect(api.getUiState().kfGroupCollapsed).toEqual({ manual: true })
  })

  it('detaches selected member keys without deleting their animation', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      2,
      options,
    )
    const track = findTrack(api, layers[1]!, 'transform.x')!
    const detachedKey = track.keyframes[1]!

    expect(
      detachStaggerSetKeyframes(api, 'set-1', [
        {
          nodeId: layers[1]!,
          propertyId: 'transform.x',
          keyframeIds: [detachedKey.id],
        },
      ]),
    ).toBe(true)
    expect(times(api, layers[1]!, 'transform.x')).toEqual([0.1, 2.1])
    expect(
      api.getUiState().staggerSets['set-1']?.members[layers[1]!]![
        'transform.x'
      ],
    ).not.toContain(detachedKey.id)
  })

  it('detaches layers and dissolves a one-layer remainder without deleting keys', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.y',
      1,
      options,
    )

    expect(detachStaggerSetLayers(api, 'set-1', layers.slice(1))).toBe(true)
    expect(api.getUiState().staggerSets['set-1']).toBeUndefined()
    expect(times(api, layers[0]!, 'transform.y')).toEqual([1])
    expect(times(api, layers[1]!, 'transform.y')).toEqual([1.1])
    expect(times(api, layers[2]!, 'transform.y')).toEqual([1.2])
  })

  it('closes the timing gap when one layer is plucked from a larger set', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'appearance.opacity',
      0,
      options,
    )

    expect(detachStaggerSetLayers(api, 'set-1', [layers[1]!])).toBe(true)
    expect(
      api.getUiState().staggerSets['set-1']?.layerIds,
    ).toEqual([layers[0], layers[2]])
    expect(times(api, layers[0]!, 'appearance.opacity')).toEqual([0])
    // The remaining follower closes from index 2 to index 1.
    expect(times(api, layers[2]!, 'appearance.opacity')).toEqual([0.1])
    // Detached layer animation remains at its authored time.
    expect(times(api, layers[1]!, 'appearance.opacity')).toEqual([0.1])
  })

  it('deletes one linked source/follower bundle and keeps later bundles', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.rotation',
      0,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.rotation',
      2,
      options,
    )
    const inputs = layers.map((nodeId) => {
      const track = findTrack(api, nodeId, 'transform.rotation')!
      return {
        nodeId,
        propertyId: 'transform.rotation' as const,
        keyframeIds: [track.keyframes[0]!.id],
      }
    })

    expect(deleteStaggerSetKeyframes(api, 'set-1', inputs)).toBe(true)
    expect(times(api, layers[0]!, 'transform.rotation')).toEqual([2])
    expect(times(api, layers[1]!, 'transform.rotation')).toEqual([2.1])
    expect(times(api, layers[2]!, 'transform.rotation')).toEqual([2.2])
    expect(api.getUiState().staggerSets['set-1']).toBeDefined()
  })

  it('deletes a selected stagger set without deleting its layers and undoes cleanly', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      0,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      'transform.x',
      2,
      options,
    )
    // An ordinary key on the same track is not owned by the stagger and must
    // survive deleting the aggregate group.
    addKeyframe(api, layers[0]!, 'transform.x', 5, 999)
    const scene = api.doc.getMap('scene')
    const undo = new Y.UndoManager(
      [
        scene,
        scene.get('tracks') as Y.Map<unknown>,
        scene.get('uiState') as Y.Map<unknown>,
      ],
      { trackedOrigins: new Set([null, UNDOABLE_GESTURE_ORIGIN]) },
    )

    expect(deleteStaggerSet(api, 'set-1')).toBe(true)
    expect(api.getUiState().staggerSets['set-1']).toBeUndefined()
    expect(times(api, layers[0]!, 'transform.x')).toEqual([5])
    expect(times(api, layers[1]!, 'transform.x')).toBeUndefined()
    expect(times(api, layers[2]!, 'transform.x')).toBeUndefined()
    expect(layers.every((nodeId) => api.getNode(nodeId))).toBe(true)

    undo.undo()
    expect(api.getUiState().staggerSets['set-1']).toBeDefined()
    expect(times(api, layers[0]!, 'transform.x')).toEqual([0, 2, 5])
    expect(times(api, layers[1]!, 'transform.x')).toEqual([0.1, 2.1])
    expect(times(api, layers[2]!, 'transform.x')).toEqual([0.2, 2.2])
    undo.destroy()
  })
})

describe('complete stagger mutations', () => {
  it('duplicates every owned property with fresh membership one frame after the source', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(api, targets, 'transform.x', 0, options)
    toggleStaggerSetPropertyKeyframes(
      api,
      targets.map((target) => ({
        ...target,
        currentValue: Number(target.currentValue) + 100,
      })),
      'transform.x',
      1,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets.map((target, index) => ({ ...target, currentValue: index / 2 })),
      'appearance.opacity',
      0,
      options,
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      targets.map((target) => ({ ...target, currentValue: 1 })),
      'appearance.opacity',
      1,
      options,
    )
    addKeyframe(api, layers[0]!, 'transform.x', 4, 999)
    api.setMeta({ duration: 1.2, frameRate: 60 })

    const source = api.getUiState().staggerSets['set-1']!
    const sourceIds = new Set(
      Object.values(source.members).flatMap((properties) =>
        Object.values(properties).flatMap((ids) => ids ?? []),
      ),
    )
    const transactions: unknown[] = []
    const observe = (transaction: Y.Transaction) => {
      transactions.push(transaction.origin)
    }
    api.doc.on('afterTransaction', observe)

    const result = duplicateStaggerSet(api, 'set-1', { setId: 'set-copy' })

    api.doc.off('afterTransaction', observe)
    expect(result?.startTime).toBeCloseTo(1.2 + 1 / 60)
    expect(result?.endTime).toBeCloseTo(2.4 + 1 / 60)
    expect(result?.set.order).toBe('forward')
    expect(result?.set.name).toBe('Stagger Copy')
    expect(transactions).toEqual([UNDOABLE_GESTURE_ORIGIN])
    expect(api.getMeta().duration).toBeCloseTo(2.4 + 1 / 60)
    expect(times(api, layers[0]!, 'transform.x')).toEqual([
      0,
      1,
      1.216666667,
      2.216666667,
      4,
    ])
    expect(ownedKeyframes(api, 'set-copy', layers[2]!, 'transform.x')).toMatchObject([
      { time: 1.416666667, value: 30 },
      { time: 2.416666667, value: 130 },
    ])
    expect(ownedKeyframes(api, 'set-copy', layers[1]!, 'appearance.opacity')).toMatchObject([
      { time: 1.316666667, value: 0.5 },
      { time: 2.316666667, value: 1 },
    ])
    const copyIds = Object.values(result!.set.members).flatMap((properties) =>
      Object.values(properties).flatMap((ids) => ids ?? []),
    )
    expect(copyIds.every((id) => !sourceIds.has(id))).toBe(true)
    expect(new Set(copyIds).size).toBe(copyIds.length)
    expect(findTrack(api, layers[0]!, 'transform.x')?.keyframes.find(
      (keyframe) => keyframe.value === 999,
    )).toMatchObject({ time: 4, value: 999 })
  })

  it('creates a globally mirrored exact return with mirrored easing', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(api, targets, 'transform.x', 0, options)
    toggleStaggerSetPropertyKeyframes(
      api,
      targets.map((target) => ({
        ...target,
        currentValue: Number(target.currentValue) + 100,
      })),
      'transform.x',
      1,
      options,
    )
    const curve = {
      bezier: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number],
    }
    for (const nodeId of layers) {
      const track = findTrack(api, nodeId, 'transform.x')!
      api.setTrack({
        ...track,
        keyframes: track.keyframes.map((keyframe, index) =>
          index === 0 ? { ...keyframe, easingOut: curve } : keyframe,
        ),
      })
    }
    addKeyframe(api, layers[0]!, 'transform.x', 2.5, 999)
    const unrelated = findTrack(api, layers[0]!, 'transform.x')!.keyframes.find(
      (keyframe) => keyframe.value === 999,
    )!
    const sourceIds = new Set(
      api.getUiState().staggerSets['set-1']!.members[layers[0]]![
        'transform.x'
      ],
    )

    const result = createStaggerSetReturn(api, 'set-1', {
      setId: 'set-return',
      insertionTime: 3,
    })

    expect(result?.set.order).toBe('reverse')
    expect(result?.set.name).toBe('Stagger Return')
    expect(result?.startTime).toBe(3)
    expect(result?.endTime).toBe(4.2)
    expect(ownedKeyframes(api, 'set-return', layers[0]!, 'transform.x')).toMatchObject([
      {
        time: 3.2,
        value: 110,
        easingOut: { bezier: [0.7, 0.6, 0.9, 0.8] },
      },
      { time: 4.2, value: 10 },
    ])
    expect(ownedKeyframes(api, 'set-return', layers[1]!, 'transform.x')).toMatchObject([
      { time: 3.1, value: 120 },
      { time: 4.1, value: 20 },
    ])
    expect(ownedKeyframes(api, 'set-return', layers[2]!, 'transform.x')).toMatchObject([
      { time: 3, value: 130 },
      { time: 4, value: 30 },
    ])
    expect(
      ownedKeyframes(api, 'set-return', layers[0]!, 'transform.x').every(
        (keyframe) => !sourceIds.has(keyframe.id),
      ),
    ).toBe(true)
    expect(findTrack(api, layers[0]!, 'transform.x')?.keyframes).toContainEqual(
      unrelated,
    )
  })

  it('reverses owned keys in place, preserves ids and unrelated keys, and undoes atomically', () => {
    const { api, layers, targets, options } = setup()
    toggleStaggerSetPropertyKeyframes(api, targets, 'transform.x', 0, options)
    toggleStaggerSetPropertyKeyframes(
      api,
      targets.map((target) => ({
        ...target,
        currentValue: Number(target.currentValue) + 100,
      })),
      'transform.x',
      1,
      options,
    )
    addKeyframe(api, layers[0]!, 'transform.x', 0.6, 999)
    const before = findTrack(api, layers[0]!, 'transform.x')!
    const ownedIds = [
      ...(api.getUiState().staggerSets['set-1']!.members[layers[0]]![
        'transform.x'
      ] ?? []),
    ]
    const unrelated = before.keyframes.find((keyframe) => keyframe.value === 999)!
    const scene = api.doc.getMap('scene')
    const undo = new Y.UndoManager(
      [scene, scene.get('tracks') as Y.Map<unknown>, scene.get('uiState') as Y.Map<unknown>],
      { trackedOrigins: new Set([UNDOABLE_GESTURE_ORIGIN]) },
    )

    expect(reverseStaggerSetInPlace(api, 'set-1')).toBe(true)

    expect(api.getUiState().staggerSets['set-1']?.order).toBe('reverse')
    expect(ownedKeyframes(api, 'set-1', layers[0]!, 'transform.x')).toMatchObject([
      { time: 0.2, value: 110 },
      { time: 1.2, value: 10 },
    ])
    expect(ownedKeyframes(api, 'set-1', layers[2]!, 'transform.x')).toMatchObject([
      { time: 0, value: 130 },
      { time: 1, value: 30 },
    ])
    expect(
      ownedKeyframes(api, 'set-1', layers[0]!, 'transform.x')
        .map((keyframe) => keyframe.id)
        .sort(),
    ).toEqual([...ownedIds].sort())
    expect(findTrack(api, layers[0]!, 'transform.x')?.keyframes).toContainEqual(
      unrelated,
    )

    undo.undo()
    expect(api.getUiState().staggerSets['set-1']?.order).toBe('forward')
    expect(findTrack(api, layers[0]!, 'transform.x')).toEqual(before)
    undo.destroy()
  })
})

describe('stacked text animation stagger sets', () => {
  it('creates an exact text return on fresh tracks without changing custom geometry semantics', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const first = api.createNode('text', root, { text: 'First' })
    const second = api.createNode('text', root, { text: 'Second' })
    const staggerCurve = {
      version: 1 as const,
      points: [
        { id: 'a', x: 0, y: 0, inX: 0, inY: 0, outX: 0.1, outY: 0.4 },
        { id: 'b', x: 1, y: 1, inX: 0.8, inY: 0.9, outX: 1, outY: 1 },
      ],
    }
    const easing = {
      bezier: [0.15, 0.25, 0.6, 0.9] as [number, number, number, number],
    }
    const tracks = [
      textTrack('first-in', first, 1, 2),
      textTrack('second-in', second, 1.2, 2.2),
    ].map((track) => ({
      ...track,
      textAnimation: {
        ...track.textAnimation!,
        mode: 'in' as const,
        order: 'forward' as const,
        staggerCurve,
      },
      keyframes: track.keyframes.map((keyframe, index) =>
        index === 0 ? { ...keyframe, easingOut: easing } : keyframe,
      ),
    }))
    for (const track of tracks) {
      api.setTrack(track)
      api.setNodeProperty(track.nodeId, 'textAnimation', track.textAnimation)
    }
    registerStaggerSetKeyframes(
      api,
      {
        setId: 'text-set',
        layerIds: [first, second],
        delay: 0.2,
        order: 'forward',
      },
      tracks.map((track) => ({
        nodeId: track.nodeId,
        propertyId: 'text.progress',
        keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
      })),
    )

    const result = createStaggerSetReturn(api, 'text-set', {
      setId: 'text-return',
      insertionTime: 5,
    })!
    const firstReturnIds = new Set(
      result.set.members[first]?.['text.progress'] ?? [],
    )
    const secondReturnIds = new Set(
      result.set.members[second]?.['text.progress'] ?? [],
    )
    const firstReturn = api
      .getTracksForNode(first)
      .find((track) =>
        track.keyframes.some((keyframe) => firstReturnIds.has(keyframe.id)),
      )!
    const secondReturn = api
      .getTracksForNode(second)
      .find((track) =>
        track.keyframes.some((keyframe) => secondReturnIds.has(keyframe.id)),
      )!

    expect(result.set.order).toBe('reverse')
    expect(firstReturn.id).not.toBe('first-in')
    expect(secondReturn.id).not.toBe('second-in')
    expect(firstReturn.keyframes).toMatchObject([
      {
        time: 5.2,
        value: 1,
        easingOut: {
          bezier: [0.4, 0.09999999999999998, 0.85, 0.75],
        },
      },
      { time: 6.2, value: 0 },
    ])
    expect(secondReturn.keyframes).toMatchObject([
      { time: 5, value: 1 },
      { time: 6, value: 0 },
    ])
    expect(firstReturn.textAnimation).toMatchObject({
      mode: 'in',
      order: 'forward',
      startTime: 5.2,
      staggerCurve,
    })
    expect(secondReturn.textAnimation?.startTime).toBe(5)
    const firstNode = api.getNode(first)
    expect(firstNode?.kind === 'text' && firstNode.textAnimation).toMatchObject({
      startTime: 1,
      mode: 'in',
    })
    const sourceIds = new Set(tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.id)))
    expect(
      [...firstReturnIds, ...secondReturnIds].every((id) => !sourceIds.has(id)),
    ).toBe(true)
  })

  it('reverses text tracks in place and synchronizes unambiguous node metadata', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const first = api.createNode('text', root, { text: 'First' })
    const second = api.createNode('text', root, { text: 'Second' })
    const tracks = [
      textTrack('first-in', first, 1, 2),
      textTrack('second-in', second, 1.2, 2.2),
    ]
    for (const track of tracks) {
      api.setTrack(track)
      api.setNodeProperty(track.nodeId, 'textAnimation', track.textAnimation)
    }
    registerStaggerSetKeyframes(
      api,
      {
        setId: 'text-set',
        layerIds: [first, second],
        delay: 0.2,
        order: 'forward',
      },
      tracks.map((track) => ({
        nodeId: track.nodeId,
        propertyId: 'text.progress',
        keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
      })),
    )
    const sourceIds = tracks.map((track) => track.keyframes.map((keyframe) => keyframe.id))

    expect(reverseStaggerSetInPlace(api, 'text-set')).toBe(true)

    expect(api.getUiState().staggerSets['text-set']?.order).toBe('reverse')
    expect(api.getTrack('first-in')?.keyframes).toMatchObject([
      { id: sourceIds[0]![1], time: 1.2, value: 1 },
      { id: sourceIds[0]![0], time: 2.2, value: 0 },
    ])
    expect(api.getTrack('second-in')?.keyframes).toMatchObject([
      { id: sourceIds[1]![1], time: 1, value: 1 },
      { id: sourceIds[1]![0], time: 2, value: 0 },
    ])
    expect(api.getTrack('first-in')?.textAnimation).toMatchObject({
      mode: 'in',
      order: 'forward',
      startTime: 1.2,
    })
    const firstNode = api.getNode(first)
    expect(firstNode?.kind === 'text' && firstNode.textAnimation).toMatchObject({
      mode: 'in',
      startTime: 1.2,
    })
  })

  it('keeps a single owned text track editable outside its active range', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const text = api.createNode('text', root, { text: 'Only' })
    const second = api.createNode('text', root, { text: 'Second' })
    const track = textTrack('only-in', text, 2, 3)
    const secondTrack = textTrack('second-in', second, 2.2, 3.2)
    api.setTrack(track)
    api.setTrack(secondTrack)
    registerStaggerSetKeyframes(
      api,
      {
        setId: 'text-set',
        layerIds: [text, second],
        delay: 0.2,
        order: 'forward',
      },
      [
        {
          nodeId: text,
          propertyId: 'text.progress',
          keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
        },
        {
          nodeId: second,
          propertyId: 'text.progress',
          keyframeIds: secondTrack.keyframes.map((keyframe) => keyframe.id),
        },
      ],
    )

    expect(
      findStaggerSetMemberTrack(
        api,
        'text-set',
        text,
        'text.progress',
        10,
      )?.id,
    ).toBe('only-in')
  })

  it('resolves and retimes the matching stacked text track by member ids', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const first = api.createNode('text', root, { text: 'First' })
    const second = api.createNode('text', root, { text: 'Second' })
    const tracks = [
      textTrack('first-in', first, 0, 1),
      textTrack('first-out', first, 3, 4),
      textTrack('second-in', second, 0.2, 1.2),
      textTrack('second-out', second, 3.2, 4.2),
    ]
    for (const track of tracks) api.setTrack(track)
    const options = {
      setId: 'text-set',
      layerIds: [first, second],
      delay: 0.2,
      order: 'forward' as const,
    }
    for (const pair of [
      [tracks[0]!, tracks[2]!],
      [tracks[1]!, tracks[3]!],
    ]) {
      registerStaggerSetKeyframes(
        api,
        options,
        pair.map((track) => ({
          nodeId: track.nodeId,
          propertyId: 'text.progress' as const,
          keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
        })),
      )
    }

    expect(
      findStaggerSetMemberTrack(
        api,
        'text-set',
        first,
        'text.progress',
        3.5,
      )?.id,
    ).toBe('first-out')
    expect(
      findStaggerSetMemberTrack(
        api,
        'text-set',
        first,
        'text.progress',
        2,
      ),
    ).toBeNull()
    expect(
      resolveStaggerTrackBundle(api, 'text-set', 'first-out')
        ?.trackIdsByNode,
    ).toEqual({
      [first]: 'first-out',
      [second]: 'second-out',
    })

    expect(retimeStaggerSet(api, 'text-set', 0.4)).toBe(true)
    expect(api.getTrack('second-in')?.keyframes.map((keyframe) => keyframe.time)).toEqual([
      0.4,
      1.4,
    ])
    expect(api.getTrack('second-out')?.keyframes.map((keyframe) => keyframe.time)).toEqual([
      3.4,
      4.4,
    ])
    expect(api.getTrack('second-out')?.textAnimation?.startTime).toBe(3.4)
    expect(api.getTrack('first-out')?.keyframes.map((keyframe) => keyframe.time)).toEqual([
      3,
      4,
    ])
  })

  it('prunes dead ids when a preset re-registers live text endpoints', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const first = api.createNode('text', root)
    const second = api.createNode('text', root)
    const firstTrack = textTrack('first', first, 0, 1)
    const secondTrack = textTrack('second', second, 0.1, 1.1)
    api.setTrack(firstTrack)
    api.setTrack(secondTrack)
    const options = {
      setId: 'text-set',
      layerIds: [first, second],
      delay: 0.1,
      order: 'forward' as const,
    }
    registerStaggerSetKeyframes(api, options, [firstTrack, secondTrack].map((track) => ({
      nodeId: track.nodeId,
      propertyId: 'text.progress' as const,
      keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
    })))
    const set = api.getUiState().staggerSets['text-set']!
    api.setUiState({
      staggerSets: {
        ...api.getUiState().staggerSets,
        'text-set': {
          ...set,
          members: {
            ...set.members,
            [first]: {
              ...set.members[first],
              'text.progress': [
                ...(set.members[first]?.['text.progress'] ?? []),
                'dead-id',
              ],
            },
          },
        },
      },
    })

    registerStaggerSetKeyframes(api, options, [{
      nodeId: first,
      propertyId: 'text.progress',
      keyframeIds: firstTrack.keyframes.map((keyframe) => keyframe.id),
    }])

    expect(
      api.getUiState().staggerSets['text-set']?.members[first]?.[
        'text.progress'
      ],
    ).toEqual(firstTrack.keyframes.map((keyframe) => keyframe.id))
  })
})
