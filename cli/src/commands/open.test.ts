// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { captureStderr } from '../testUtils/stdout.js'
import { openCommand } from './open.js'

test('open command reports missing scene files before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-'))
  const scenePath = path.join(dir, 'missing.hype')
  const previousExit = process.exit
  try {
    process.exit = ((code?: number) => {
      throw Object.assign(new Error(`process.exit ${code ?? 0}`), { exitCode: code })
    }) as typeof process.exit

    const stderr = await captureStderr(async () => {
      await assert.rejects(
        openCommand().parseAsync([scenePath], { from: 'user' }),
        { exitCode: 2 },
      )
    })

    assert.match(stderr, /^\[open\] scene file not found: .*missing\.hype$/m)
  } finally {
    process.exit = previousExit
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
