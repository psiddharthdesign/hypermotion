// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from 'vitest'
import { toggleStaggerSetPropertyKeyframes } from '@/anim/staggerSets'
import { createSceneAPI } from '@/scene/doc'
import {
  activateStaggerSetForEditing,
  toggleStaggerSetEditing,
} from '@/ui/staggerEditing'
import { useUI } from './ui'

describe('local stagger timeline selection', () => {
  beforeEach(() => {
    useUI.setState({
      staggerOn: false,
      staggerDelay: 0.1,
      activeStaggerSetId: null,
      selectedStaggerSetId: null,
      selection: [],
      selectedTrackIds: [],
      selectedTrackId: null,
      selectedKeyframes: [],
      inspectorMode: 'properties',
    })
  })

  it('selects a stagger row without entering edit mode', () => {
    useUI.getState().setSelectedStaggerSetId('cards')

    expect(useUI.getState().selectedStaggerSetId).toBe('cards')
    expect(useUI.getState().staggerOn).toBe(false)
    expect(useUI.getState().activeStaggerSetId).toBeNull()
  })

  it('creates an explicit armed draft session for immediate UI feedback', () => {
    useUI.getState().setStaggerOn(true)

    expect(useUI.getState().staggerOn).toBe(true)
    expect(useUI.getState().activeStaggerSetId).toMatch(/^stagger_/)
    expect(useUI.getState().selectedStaggerSetId).toBeNull()

    useUI.getState().setStaggerOn(false)
    expect(useUI.getState().activeStaggerSetId).toBeNull()
  })

  it('activates the selected relationship explicitly and preserves selection on exit', () => {
    useUI.getState().setSelectedStaggerSetId('cards')
    useUI.getState().activateStaggerSet('cards', 0.18)

    expect(useUI.getState().staggerOn).toBe(true)
    expect(useUI.getState().activeStaggerSetId).toBe('cards')
    expect(useUI.getState().selectedStaggerSetId).toBe('cards')
    expect(useUI.getState().staggerDelay).toBe(0.18)

    useUI.getState().setStaggerOn(false)
    expect(useUI.getState().staggerOn).toBe(false)
    expect(useUI.getState().activeStaggerSetId).toBeNull()
    expect(useUI.getState().selectedStaggerSetId).toBe('cards')
  })

  it('reveals a live source and restores it instead of toggling off from an empty active selection', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { name: 'Root' })
    const layers = ['First', 'Second'].map((name) =>
      api.createNode('frame', root, { name }),
    )
    toggleStaggerSetPropertyKeyframes(
      api,
      layers.map((nodeId, index) => ({
        nodeId,
        currentValue: index * 100,
      })),
      'transform.y',
      0,
      {
        setId: 'cards',
        layerIds: layers,
        delay: 0.2,
        order: 'forward',
      },
    )
    useUI.setState({
      selectedTrackIds: ['stale-track'],
      selectedTrackId: 'stale-track',
      selectedKeyframes: ['stale-track:stale-key'],
    })

    expect(activateStaggerSetForEditing(api, 'cards')).toBe(layers[0])
    expect(useUI.getState()).toMatchObject({
      staggerOn: true,
      activeStaggerSetId: 'cards',
      selectedStaggerSetId: 'cards',
      selection: [layers[0]],
      selectedTrackIds: [],
      selectedTrackId: null,
      selectedKeyframes: [],
      inspectorMode: 'animate',
    })

    useUI.getState().setSelection([])
    expect(toggleStaggerSetEditing(api, 'cards')).toBe('activated')
    expect(useUI.getState().staggerOn).toBe(true)
    expect(useUI.getState().selection).toEqual([layers[0]])

    expect(toggleStaggerSetEditing(api, 'cards')).toBe('deactivated')
    expect(useUI.getState().staggerOn).toBe(false)
  })
})
