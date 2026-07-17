// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { shouldUseRadialExportFocusMask } from './focusFallback'

describe('canvas depth-of-field export fallback', () => {
  it('uses the radial sharp mask only for screen/point focus', () => {
    expect(shouldUseRadialExportFocusMask('screen')).toBe(true)
    expect(shouldUseRadialExportFocusMask('plane')).toBe(false)
    expect(shouldUseRadialExportFocusMask('target')).toBe(false)
  })
})
