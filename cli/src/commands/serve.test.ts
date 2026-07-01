// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr } from '../testUtils/stdout.js'
import { serveCommand } from './serve.js'

test('serve command requires an explicit server mode', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(serveCommand().parseAsync([], { from: 'user' }), {
        exitCode: 1,
      })
    })
  })

  assert.match(stderr, /^\[serve\] no mode specified\. Use --mcp/m)
})
