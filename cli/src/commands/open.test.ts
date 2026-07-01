// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import test from 'node:test'
import { withEnvVar } from '../testUtils/env.js'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr, captureStdout } from '../testUtils/stdout.js'
import { openCommand } from './open.js'

test('open command launches the desktop app with the resolved scene path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-ok-'))
  const scenePath = path.join(dir, 'scene.hype')
  const appPath = path.join(dir, 'hyper-motion')
  const spawnCalls: Array<{
    command: string
    args: readonly string[]
    options: Pick<SpawnOptions, 'detached' | 'stdio'>
  }> = []
  let unrefCalled = false
  fs.writeFileSync(scenePath, '')
  try {
    const stdout = await captureStdout(async () => {
      await openCommand({
        locateApp: async () => appPath,
        spawnApp: (command, args, options) => {
          spawnCalls.push({ command, args, options })
          return { unref: () => { unrefCalled = true } } satisfies Pick<
            ChildProcess,
            'unref'
          >
        },
      }).parseAsync([scenePath], { from: 'user' })
    })

    assert.deepEqual(spawnCalls, [
      {
        command: appPath,
        args: [scenePath],
        options: { detached: true, stdio: 'ignore' },
      },
    ])
    assert.equal(unrefCalled, true)
    assert.match(stdout, new RegExp(`^Opened ${scenePath}$`, 'm'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open command resolves relative scene paths before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-relative-'))
  const scenePath = path.join(dir, 'scene.hype')
  const appPath = path.join(dir, 'hyper-motion')
  const originalCwd = process.cwd()
  const spawnCalls: Array<{ command: string; args: readonly string[] }> = []
  fs.writeFileSync(scenePath, '')
  try {
    process.chdir(dir)
    const resolvedScenePath = path.resolve('scene.hype')

    await openCommand({
      locateApp: async () => appPath,
      spawnApp: (command, args) => {
        spawnCalls.push({ command, args })
        return { unref: () => {} } satisfies Pick<ChildProcess, 'unref'>
      },
    }).parseAsync(['scene.hype'], { from: 'user' })

    assert.deepEqual(spawnCalls, [{ command: appPath, args: [resolvedScenePath] }])
  } finally {
    process.chdir(originalCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open command trims padded scene paths before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-trimmed-'))
  const scenePath = path.join(dir, 'scene.hype')
  const appPath = path.join(dir, 'hyper-motion')
  const spawnCalls: Array<{ command: string; args: readonly string[] }> = []
  fs.writeFileSync(scenePath, '')
  try {
    await openCommand({
      locateApp: async () => appPath,
      spawnApp: (command, args) => {
        spawnCalls.push({ command, args })
        return { unref: () => {} } satisfies Pick<ChildProcess, 'unref'>
      },
    }).parseAsync([`  ${scenePath}  `], { from: 'user' })

    assert.deepEqual(spawnCalls, [{ command: appPath, args: [scenePath] }])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

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

test('open command reports stat failures before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-stat-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.writeFileSync(scenePath, '')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          openCommand({
            locateApp: async () => path.join(dir, 'hyper-motion'),
            existsSync: fs.existsSync,
            statSync: () => {
              throw new Error('stat failed')
            },
            spawnApp: () => {
              throw new Error('should not launch')
            },
          }).parseAsync([scenePath], { from: 'user' }),
          { exitCode: 2 },
        )
      })
    })

    assert.equal(stderr, `[open] failed to read ${scenePath}: stat failed\n`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open command reports when the desktop app cannot be found', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-app-'))
  const scenePath = path.join(dir, 'scene.hype')
  const missingAppPath = path.join(dir, 'missing-hyper-motion')
  fs.writeFileSync(scenePath, '')
  try {
    const stderr = await captureStderr(() => {
      return withEnvVar('HYPERMOTION_APP_PATH', missingAppPath, () => {
        return withProcessExitThrow(async () => {
          await assert.rejects(
            openCommand().parseAsync([scenePath], { from: 'user' }),
            { exitCode: 1 },
          )
        })
      })
    })

    assert.match(stderr, /HYPERMOTION_APP_PATH is set but the file does not exist/)
    assert.match(stderr, /^\[open\] hyper-motion desktop app not found\.$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open command reports desktop launch failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-launch-'))
  const scenePath = path.join(dir, 'scene.hype')
  const appPath = path.join(dir, 'hyper-motion')
  fs.writeFileSync(scenePath, '')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          openCommand({
            locateApp: async () => appPath,
            spawnApp: () => {
              throw new Error('launch failed')
            },
          }).parseAsync([scenePath], { from: 'user' }),
          { exitCode: 1 },
        )
      })
    })

    assert.equal(stderr, `[open] failed to open ${scenePath}: launch failed\n`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
