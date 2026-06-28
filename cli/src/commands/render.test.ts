// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { captureStderr } from '../testUtils/stdout.js'
import { renderCommand } from './render.js'

test('render command reports missing scene files before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-'))
  const scenePath = path.join(dir, 'missing.hype')
  const outPath = path.join(dir, 'out.mp4')
  const previousExit = process.exit
  try {
    process.exit = ((code?: number) => {
      throw Object.assign(new Error(`process.exit ${code ?? 0}`), { exitCode: code })
    }) as typeof process.exit

    const stderr = await captureStderr(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['--scene', scenePath, '-o', outPath], {
          from: 'user',
        }),
        { exitCode: 2 },
      )
    })

    assert.match(stderr, /^\[render\] scene file not found: .*missing\.hype$/m)
  } finally {
    process.exit = previousExit
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports directories before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  const outPath = path.join(dir, 'out.mp4')
  fs.mkdirSync(scenePath)
  const previousExit = process.exit
  try {
    process.exit = ((code?: number) => {
      throw Object.assign(new Error(`process.exit ${code ?? 0}`), { exitCode: code })
    }) as typeof process.exit

    const stderr = await captureStderr(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['--scene', scenePath, '-o', outPath], {
          from: 'user',
        }),
        { exitCode: 2 },
      )
    })

    assert.match(stderr, /^\[render\] scene path is not a file: .*scene\.hype$/m)
  } finally {
    process.exit = previousExit
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
