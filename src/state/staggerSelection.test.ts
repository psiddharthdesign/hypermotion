// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from 'vitest'
import { useUI } from './ui'

describe('local stagger timeline selection', () => {
  beforeEach(() => {
    useUI.setState({
      staggerOn: false,
      staggerDelay: 0.1,
      activeStaggerSetId: null,
      selectedStaggerSetId: null,
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
})
