// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { captureStderr, captureStdout } from './stdout.js'

test('captureStdout decodes Uint8Array chunks as text', async () => {
  const output = await captureStdout(() => {
    process.stdout.write(new TextEncoder().encode('render complete'))
  })

  assert.equal(output, 'render complete')
})

test('captureStderr decodes Uint8Array chunks as text', async () => {
  const output = await captureStderr(() => {
    process.stderr.write(new TextEncoder().encode('render failed'))
  })

  assert.equal(output, 'render failed')
})

test('captureStdout restores the writer when the callback throws', async () => {
  const originalWrite = process.stdout.write

  await assert.rejects(
    captureStdout(() => {
      throw new Error('boom')
    }),
    /boom/,
  )

  assert.equal(process.stdout.write, originalWrite)
})

test('captureStderr restores the writer when the callback throws', async () => {
  const originalWrite = process.stderr.write

  await assert.rejects(
    captureStderr(() => {
      throw new Error('boom')
    }),
    /boom/,
  )

  assert.equal(process.stderr.write, originalWrite)
})
