// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { captureStdout } from './stdout.js'

test('captureStdout decodes Uint8Array chunks as text', async () => {
  const output = await captureStdout(() => {
    process.stdout.write(new TextEncoder().encode('render complete'))
  })

  assert.equal(output, 'render complete')
})
