// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { ISOMETRIC_CAMERA_VIEWS } from '@/scene/cameraProjection'
import { isometricViewForShortcut } from './isometricViewShortcut'

const key = { code: 'Digit1', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false }
describe('isometric view shortcuts', () => {
  it('maps Option/Alt plus 1–4 to the four named views', () => {
    ISOMETRIC_CAMERA_VIEWS.forEach((view, index) => {
      expect(isometricViewForShortcut({ ...key, code: `Digit${index + 1}` })).toBe(view.id)
    })
  })
  it('leaves canvas zoom and other modified shortcuts alone and ignores held-key repetition', () => {
    for (const patch of [{ altKey: false }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { repeat: true }, { code: 'Digit5' }, { code: 'KeyA' }]) {
      expect(isometricViewForShortcut({ ...key, ...patch })).toBeNull()
    }
  })
})
