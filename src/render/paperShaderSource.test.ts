// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { resolvePaperShaderStatusMount } from './paperShaderSource'

describe('Paper shader status mount', () => {
  it('measures the local status wrapper when the parent ref is not attached yet', () => {
    const parent = {} as HTMLElement
    const status = { parentElement: parent } as HTMLElement

    expect(resolvePaperShaderStatusMount(status, null)).toEqual({
      measureElement: status,
      publishElement: parent,
    })
  })

  it('publishes through the stable shared host once it is available', () => {
    const parent = {} as HTMLElement
    const sharedHost = {} as HTMLElement
    const status = { parentElement: parent } as HTMLElement

    expect(resolvePaperShaderStatusMount(status, sharedHost)).toEqual({
      measureElement: status,
      publishElement: sharedHost,
    })
  })

  it('returns null until the local status wrapper has mounted', () => {
    expect(resolvePaperShaderStatusMount(null, null)).toBeNull()
  })
})
