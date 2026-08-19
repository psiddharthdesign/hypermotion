// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { renderCameraBackendKey } from './renderCameraBackend'

describe('renderCameraBackendKey', () => {
  it('keeps one WebGL viewport mounted across camera cuts', () => {
    expect(renderCameraBackendKey('scene-a', 'wide')).toBe(
      renderCameraBackendKey('scene-a', 'detail'),
    )
  })

  it('remounts when the composition or camera backend changes', () => {
    expect(renderCameraBackendKey('scene-a', 'wide')).not.toBe(
      renderCameraBackendKey('scene-b', 'wide'),
    )
    expect(renderCameraBackendKey('scene-a', 'wide')).not.toBe(
      renderCameraBackendKey('scene-a', null),
    )
  })
})
