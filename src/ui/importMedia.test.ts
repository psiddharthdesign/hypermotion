// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  resolveAudioImportTarget,
  resolveMediaImportStartTime,
} from './importMedia'

describe('audio import ownership', () => {
  it('keeps parentless audio on the Master timeline', () => {
    expect(resolveAudioImportTarget(null)).toEqual({
      parent: null,
      workspaceOnly: true,
      ownership: 'master',
    })
  })

  it('creates parented audio as a scene-local overlay', () => {
    expect(resolveAudioImportTarget('scene-root')).toEqual({
      parent: 'scene-root',
      workspaceOnly: false,
      ownership: 'scene-overlay',
    })
  })
})

describe('media import timeline placement', () => {
  it('uses a finite non-negative Scene start time', () => {
    expect(resolveMediaImportStartTime(2.75)).toBe(2.75)
    expect(resolveMediaImportStartTime(-1)).toBe(0)
    expect(resolveMediaImportStartTime(Number.NaN)).toBe(0)
    expect(resolveMediaImportStartTime(undefined)).toBe(0)
  })
})
