// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr } from '../testUtils/stdout.js'
import { openCommand } from './open.js'

test('open command reports missing scene files before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-'))
  const scenePath = path.join(dir, 'missing.hype')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          openCommand().parseAsync([scenePath], { from: 'user' }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(stderr, /^\[open\] scene file not found: .*missing\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open command reports directories before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.mkdirSync(scenePath)
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          openCommand().parseAsync([scenePath], { from: 'user' }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(stderr, /^\[open\] scene path is not a file: .*scene\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
