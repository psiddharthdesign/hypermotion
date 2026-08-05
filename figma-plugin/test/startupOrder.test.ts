// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Figma plugin startup', () => {
  it('initializes the selection revision before the initial capture', () => {
    const source = fs.readFileSync(
      path.resolve('figma-plugin/src/code.ts'),
      'utf8',
    )
    const initialization = source.indexOf('let selectionRevision = 0')
    const initialCapture = source.indexOf('\nprepareSelection()')

    expect(initialization).toBeGreaterThanOrEqual(0)
    expect(initialCapture).toBeGreaterThan(initialization)
  })
})
