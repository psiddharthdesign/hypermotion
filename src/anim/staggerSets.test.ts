// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { PropertyId } from '@/scene'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { addKeyframe, findTrack } from './tracks'
import {
  deleteStaggerSetKeyframes,
  deleteStaggerSet,
  detachStaggerSetKeyframes,
  detachStaggerSetLayers,
  inspectStaggerSetProperty,
  inspectStaggerSetPropertyFromMember,
  patchStaggerKeyframeBundle,
  removeStaggerSet,
  renameStaggerSet,
  resolveStaggerKeyframeBundle,
  retimeStaggerSet,
  stampStaggerSetPatch,
  staggerSetPropertyIds,
  toggleStaggerSetPropertyKeyframes,
  toggleStaggerSetPropertyFromMember,
  type StaggerPropertyTarget,
} from './staggerSets'

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

describe('stagger property keyframe sets', () => {
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
