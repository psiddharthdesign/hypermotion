// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from 'vitest'
import { useUI } from './ui'

describe('Inspector mode selection behavior', () => {
  beforeEach(() => {
    useUI.setState({
      selection: [],
      selectionAnchor: null,
      selectedTrackId: null,
      selectedTrackIds: [],
      selectedKeyframes: [],
      inspectorMode: 'properties',
    })
  })

  it('opens Animate only through the explicit mode action', () => {
    useUI.getState().setInspectorMode('animate')

    expect(useUI.getState().inspectorMode).toBe('animate')
  })

  it('returns to Properties when a layer or timeline item is selected', () => {
    const expectPropertiesAfter = (select: () => void) => {
      useUI.getState().setInspectorMode('animate')
      select()
      expect(useUI.getState().inspectorMode).toBe('properties')
    }

    expectPropertiesAfter(() => useUI.getState().setSelection(['node']))
    expectPropertiesAfter(() =>
      useUI.getState().toggleInSelection('second-node', true),
    )
    expectPropertiesAfter(() =>
      useUI.getState().setSelectedTrackIds(['track']),
    )
    expectPropertiesAfter(() => useUI.getState().setSelectedTrackId('track'))
    expectPropertiesAfter(() =>
      useUI.getState().setSelectedKeyframes(['track:keyframe']),
    )
  })
})
