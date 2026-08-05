// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { retimeStaggerSet } from '@/anim/staggerSets'
import { findTrack } from '@/anim/tracks'
import { createSceneAPI } from '@/scene/doc'
import { toggleInspectorPropertyKeyframe } from './keyframeAuthoring'

describe('Inspector stagger keyframe authoring', () => {
  it('staggers the first and second keys, then reuses the same track outside S', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const layers = ['A', 'B', 'C'].map((name) =>
      api.createNode('frame', root, { name }),
    )
    const active = {
      staggerOn: true,
      activeStaggerSetId: 'cards',
      staggerDraftLayerIds: layers,
      staggerDelay: 0.1,
    }

    expect(
      toggleInspectorPropertyKeyframe(
        api,
        active,
        layers[0]!,
        'transform.x',
        1,
        0,
      ),
    ).toMatchObject({ action: 'added', staggered: true })
    const originalTrackIds = layers.map(
      (nodeId) => findTrack(api, nodeId, 'transform.x')!.id,
    )

    expect(
      toggleInspectorPropertyKeyframe(
        api,
        active,
        layers[0]!,
        'transform.x',
        3,
        240,
      ),
    ).toMatchObject({ action: 'added', staggered: true })

    expect(
      layers.map((nodeId) =>
        findTrack(api, nodeId, 'transform.x')!.keyframes.map(
          (keyframe) => keyframe.time,
        ),
      ),
    ).toEqual([
      [1, 3],
      [1.1, 3.1],
      [1.2, 3.2],
    ])
    expect(
      layers.map((nodeId) => findTrack(api, nodeId, 'transform.x')!.id),
    ).toEqual(originalTrackIds)

    const setAfterSecondKey = api.getUiState().staggerSets.cards!
    for (const nodeId of layers) {
      expect(setAfterSecondKey.members[nodeId]?.['transform.x']).toHaveLength(
        2,
      )
    }

    expect(
      toggleInspectorPropertyKeyframe(
        api,
        { ...active, staggerOn: false, activeStaggerSetId: null },
        layers[0]!,
        'transform.x',
        5,
        480,
      ),
    ).toMatchObject({ action: 'added', staggered: false })

    const leaderTrack = findTrack(api, layers[0]!, 'transform.x')!
    expect(leaderTrack.id).toBe(originalTrackIds[0])
    expect(leaderTrack.keyframes.map((keyframe) => keyframe.time)).toEqual([
      1, 3, 5,
    ])
    expect(
      api.getUiState().staggerSets.cards?.members[layers[0]!]?.[
        'transform.x'
      ],
    ).toHaveLength(2)
    expect(findTrack(api, layers[1]!, 'transform.x')?.keyframes).toHaveLength(
      2,
    )

    // Removing a loose key must leave stagger membership alone.
    expect(
      toggleInspectorPropertyKeyframe(
        api,
        { ...active, staggerOn: false, activeStaggerSetId: null },
        layers[0]!,
        'transform.x',
        5,
        480,
      ),
    ).toMatchObject({ action: 'removed', staggered: false })
    expect(
      api.getUiState().staggerSets.cards?.members[layers[0]!]?.[
        'transform.x'
      ],
    ).toHaveLength(2)

    // Removing an owned key outside S uses the same property track but must
    // also remove that exact id from the stagger relationship.
    expect(
      toggleInspectorPropertyKeyframe(
        api,
        { ...active, staggerOn: false, activeStaggerSetId: null },
        layers[0]!,
        'transform.x',
        1,
        0,
      ),
    ).toMatchObject({ action: 'removed', staggered: false })
    const afterOwnedRemoval = api.getUiState().staggerSets.cards!
    expect(afterOwnedRemoval.members[layers[0]!]?.['transform.x']).toHaveLength(
      1,
    )

    // Removing the remaining owned key clears only its membership. The
    // captured layer slot remains so later stagger offsets cannot be renumbered
    // underneath surviving follower keys.
    toggleInspectorPropertyKeyframe(
      api,
      { ...active, staggerOn: false, activeStaggerSetId: null },
      layers[0]!,
      'transform.x',
      3,
      240,
    )
    const preserved = api.getUiState().staggerSets.cards!
    expect(preserved.members[layers[0]!]).toBeUndefined()
    expect(preserved.layerIds).toEqual(layers)
  })

  it('preserves a deleted middle member offset for later authoring and retiming', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const layers = ['A', 'B', 'C'].map((name) =>
      api.createNode('frame', root, { name }),
    )
    const active = {
      staggerOn: true,
      activeStaggerSetId: 'cards',
      staggerDraftLayerIds: layers,
      staggerDelay: 0.1,
    }

    toggleInspectorPropertyKeyframe(
      api,
      active,
      layers[0]!,
      'transform.y',
      1,
      0,
    )
    toggleInspectorPropertyKeyframe(
      api,
      { ...active, staggerOn: false, activeStaggerSetId: null },
      layers[1]!,
      'transform.y',
      1.1,
      0,
    )

    const afterMiddleRemoval = api.getUiState().staggerSets.cards!
    expect(afterMiddleRemoval.layerIds).toEqual(layers)
    expect(afterMiddleRemoval.members[layers[1]!]).toBeUndefined()
    expect(
      findTrack(api, layers[2]!, 'transform.y')?.keyframes.map(
        (keyframe) => keyframe.time,
      ),
    ).toEqual([1.2])

    toggleInspectorPropertyKeyframe(
      api,
      active,
      layers[0]!,
      'transform.y',
      3,
      300,
    )
    expect(
      layers.map((nodeId) =>
        findTrack(api, nodeId, 'transform.y')?.keyframes.map(
          (keyframe) => keyframe.time,
        ),
      ),
    ).toEqual([[1, 3], [3.1], [1.2, 3.2]])

    expect(retimeStaggerSet(api, 'cards', 0.2)).toBe(true)
    expect(
      layers.map((nodeId) =>
        findTrack(api, nodeId, 'transform.y')?.keyframes.map(
          (keyframe) => keyframe.time,
        ),
      ),
    ).toEqual([[1, 3], [3.2], [1.4, 3.4]])
  })
})
