// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr } from '../testUtils/stdout.js'
import { renderCommand } from './render.js'

test('render command reports invalid fps before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--fps', '0'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] invalid fps: 0$/m)
})

test('render command reports non-numeric fps before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--fps', 'fast'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] invalid fps: fast$/m)
})

test('render command rejects fps values above the MCP limit before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--fps', '121'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] invalid fps: 121$/m)
})

test('render command reports unsupported formats before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--format', 'mov'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] unsupported format: mov \(use mp4 \/ webm \/ gif\)$/m)
})

test('render command reports unsupported quality before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--quality', 'draft'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] unsupported quality: draft \(use comp \/ 720p \/ 2k \/ 4k\)$/m)
})

test('render command reports missing scene files before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-'))
  const scenePath = path.join(dir, 'missing.hype')
  const outPath = path.join(dir, 'out.mp4')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand().parseAsync(['--scene', scenePath, '-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(stderr, /^\[render\] scene file not found: .*missing\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports directories before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  const outPath = path.join(dir, 'out.mp4')
  fs.mkdirSync(scenePath)
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand().parseAsync(['--scene', scenePath, '-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(stderr, /^\[render\] scene path is not a file: .*scene\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
