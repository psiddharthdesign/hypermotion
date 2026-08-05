// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { ensureCursorComponent } from '@/scene/builtins/cursorComponent'
import { instantiateComponent } from '@/ui/actions'
import {
  resolveCursorVariantKeyframeSelection,
  setSelectedCursorVariantKeyframeState,
} from './cursorVariantKeyframeEditing'

function cursorFixture() {
  const api = createSceneAPI()
  const rootId = api.createNode('frame', null, {
    size: { width: 960, height: 540 },
  })
  const componentId = ensureCursorComponent(api)
  const cursorId = instantiateComponent(api, componentId, rootId, {
    absolute: true,
  })
  if (!cursorId) throw new Error('Expected cursor instance')
  api.setTrack({
    id: 'cursor-variant',
    nodeId: cursorId,
    propertyId: 'variant',
    defaultEasing: 'linear',
    keyframes: [
      {
        id: 'default',
        time: 0,
        value: { State: 'Default' },
        easingOut: 'ease-out',
        easingPreset: { presetId: 'slow-down', strength: 80 },
      },
      { id: 'pointer', time: 1, value: { State: 'Pointer' } },
      { id: 'click', time: 2, value: { State: 'Click' } },
    ],
  })
  return { api, cursorId }
}

describe('cursor variant keyframe editing', () => {
  it('resolves same-track multi-selection and reports mixed states', () => {
    const { api } = cursorFixture()
    const selection = resolveCursorVariantKeyframeSelection(api, [
      'cursor-variant:default',
      'cursor-variant:pointer',
    ])

    expect(selection).toMatchObject({
      selectedKeyframeIds: ['default', 'pointer'],
      currentState: null,
    })
    expect(selection?.stateValues).toContain('Click')
  })

  it('updates only selected values in one undoable transaction', () => {
    const { api } = cursorFixture()
    const origins: unknown[] = []
    api.doc.on('afterTransaction', (transaction) => {
      if (transaction.changed.size > 0) origins.push(transaction.origin)
    })

    const updated = setSelectedCursorVariantKeyframeState(
      api,
      ['cursor-variant:default', 'cursor-variant:click'],
      'Grab',
    )

    expect(updated).toBe(2)
    const track = api.getTrack('cursor-variant')!
    expect(track.keyframes.map((keyframe) => keyframe.value)).toEqual([
      { State: 'Grab' },
      { State: 'Pointer' },
      { State: 'Grab' },
    ])
    expect(track.keyframes[0]).toMatchObject({
      id: 'default',
      time: 0,
      easingOut: 'ease-out',
      easingPreset: { presetId: 'slow-down', strength: 80 },
    })
    expect(origins).toEqual([UNDOABLE_GESTURE_ORIGIN])
  })

  it('rejects cross-track and non-cursor variant selections', () => {
    const { api, cursorId } = cursorFixture()
    api.setTrack({
      id: 'other-variant',
      nodeId: cursorId,
      propertyId: 'variant',
      defaultEasing: 'linear',
      keyframes: [{ id: 'other', time: 3, value: { State: 'Move' } }],
    })
    expect(
      resolveCursorVariantKeyframeSelection(api, [
        'cursor-variant:default',
        'other-variant:other',
      ]),
    ).toBeNull()

    const frameId = api.getRoot()
    api.setTrack({
      id: 'frame-variant',
      nodeId: frameId,
      propertyId: 'variant',
      defaultEasing: 'linear',
      keyframes: [{ id: 'frame', time: 0, value: { State: 'Default' } }],
    })
    expect(
      resolveCursorVariantKeyframeSelection(api, ['frame-variant:frame']),
    ).toBeNull()
  })
})
