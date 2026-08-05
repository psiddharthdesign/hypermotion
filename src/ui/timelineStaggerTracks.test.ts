// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Track } from '@/scene'
import {
  filterTimelineTrackByHiddenStaggerKeyframes,
  hiddenStaggerKeyframeIdsByTrack,
  type TimelineStaggerTrackSet,
} from '@/ui/timelineStaggerTracks'

function track(
  id: string,
  nodeId: string,
  keyframeIds: string[],
): Track {
  return {
    id,
    nodeId,
    propertyId: 'transform.x',
    defaultEasing: 'linear',
    keyframes: keyframeIds.map((keyframeId, index) => ({
      id: keyframeId,
      time: index,
      value: index,
    })),
  }
}

function displayKeyframeIds(
  candidate: Track,
  sets: TimelineStaggerTrackSet[],
): string[] | null {
  return (
    filterTimelineTrackByHiddenStaggerKeyframes(
      candidate,
      hiddenStaggerKeyframeIdsByTrack(sets),
    )?.keyframes.map((keyframe) => keyframe.id) ?? null
  )
}

describe('timeline stagger track visibility', () => {
  it('keeps loose keys on a collapsed stagger member property row', () => {
    const candidate = track('card-x', 'card', [
      'stagger-in',
      'stagger-out',
      'loose-return',
    ])

    expect(
      displayKeyframeIds(candidate, [
        {
          sourceNodeId: 'card',
          active: false,
          expanded: false,
          members: [
            { trackId: 'card-x', kfId: 'stagger-in', nodeId: 'card' },
            { trackId: 'card-x', kfId: 'stagger-out', nodeId: 'card' },
          ],
        },
      ]),
    ).toEqual(['loose-return'])
  })

  it('keeps owned and loose source keys together during collapsed editing', () => {
    const source = track('source-x', 'source', [
      'source-in',
      'source-out',
      'source-loose',
    ])
    const follower = track('follower-x', 'follower', [
      'follower-in',
      'follower-out',
      'follower-loose',
    ])
    const activeSet: TimelineStaggerTrackSet = {
      sourceNodeId: 'source',
      active: true,
      expanded: false,
      members: [
        { trackId: 'source-x', kfId: 'source-in', nodeId: 'source' },
        { trackId: 'source-x', kfId: 'source-out', nodeId: 'source' },
        {
          trackId: 'follower-x',
          kfId: 'follower-in',
          nodeId: 'follower',
        },
        {
          trackId: 'follower-x',
          kfId: 'follower-out',
          nodeId: 'follower',
        },
      ],
    }

    expect(displayKeyframeIds(source, [activeSet])).toEqual([
      'source-in',
      'source-out',
      'source-loose',
    ])
    expect(displayKeyframeIds(follower, [activeSet])).toEqual([
      'follower-loose',
    ])
  })

  it('leaves expanded stagger tracks unchanged', () => {
    const candidate = track('card-x', 'card', [
      'stagger-in',
      'stagger-out',
      'loose-return',
    ])

    expect(
      displayKeyframeIds(candidate, [
        {
          sourceNodeId: 'card',
          active: false,
          expanded: true,
          members: [
            { trackId: 'card-x', kfId: 'stagger-in', nodeId: 'card' },
            { trackId: 'card-x', kfId: 'stagger-out', nodeId: 'card' },
          ],
        },
      ]),
    ).toEqual(['stagger-in', 'stagger-out', 'loose-return'])
  })

  it('unions hidden ids across overlapping collapsed stagger sets', () => {
    const candidate = track('card-x', 'card', [
      'active-source',
      'inactive-owned',
      'loose',
    ])

    expect(
      displayKeyframeIds(candidate, [
        {
          sourceNodeId: 'card',
          active: true,
          expanded: false,
          members: [
            { trackId: 'card-x', kfId: 'active-source', nodeId: 'card' },
          ],
        },
        {
          sourceNodeId: 'other',
          active: false,
          expanded: false,
          members: [
            {
              trackId: 'card-x',
              kfId: 'inactive-owned',
              nodeId: 'card',
            },
            { trackId: 'card-x', kfId: 'active-source', nodeId: 'card' },
          ],
        },
      ]),
    ).toEqual(['loose'])
  })

  it('removes a normal property row only when no loose keys remain', () => {
    const candidate = track('card-x', 'card', ['owned'])

    expect(
      displayKeyframeIds(candidate, [
        {
          sourceNodeId: 'card',
          active: false,
          expanded: false,
          members: [
            { trackId: 'card-x', kfId: 'owned', nodeId: 'card' },
          ],
        },
      ]),
    ).toBeNull()
  })
})
