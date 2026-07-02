// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr, captureStdout } from '../testUtils/stdout.js'
import { inspectCommand } from './inspect.js'

test('inspect command prints the editable scene graph as JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Inspect JSON',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: ['title'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          title: {
            id: 'title',
            kind: 'text',
            parent: 'root',
            text: 'Inspectable',
            fontFamily: 'Inter',
            fontSize: 24,
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await inspectCommand()
        .exitOverride()
        .parseAsync([scenePath, '--json'], { from: 'user' })
    })

    const scene = JSON.parse(stdout) as {
      meta: { name?: string }
      nodes: Record<string, { kind?: string; text?: string }>
    }

    assert.equal(scene.meta.name, 'Inspect JSON')
    assert.equal(scene.nodes.root.kind, 'frame')
    assert.equal(scene.nodes.title.kind, 'text')
    assert.equal(scene.nodes.title.text, 'Inspectable')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect command defaults to JSON output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Inspect Default JSON',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await inspectCommand().exitOverride().parseAsync([scenePath], { from: 'user' })
    })

    const scene = JSON.parse(stdout) as {
      meta: { name?: string }
      nodes: Record<string, { kind?: string }>
    }

    assert.equal(scene.meta.name, 'Inspect Default JSON')
    assert.equal(scene.nodes.root.kind, 'frame')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect command trims padded scene paths before reading', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-trimmed-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Inspect Trimmed Path',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await inspectCommand()
        .exitOverride()
        .parseAsync([`  ${scenePath}  `], { from: 'user' })
    })

    const scene = JSON.parse(stdout) as {
      meta: { name?: string }
    }

    assert.equal(scene.meta.name, 'Inspect Trimmed Path')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect command rejects blank scene paths after trimming', async () => {
  const stderr = await withProcessExitThrow(() => captureStderr(() => {
    assert.throws(
      () => {
        inspectCommand().parse(['   '], { from: 'user' })
      },
      { exitCode: 2 },
    )
  }))

  assert.equal(stderr, '[inspect] scene path is required\n')
})

test('inspect command reports missing scene files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-'))
  const scenePath = path.join(dir, 'missing.hype')
  try {
    const stderr = await captureStderr(async () => {
      await assert.rejects(
        withProcessExitThrow(async () => {
          inspectCommand().parse([scenePath], { from: 'user' })
        }),
        { exitCode: 2 },
      )
    })

    assert.match(stderr, /^\[inspect\] failed to read .*missing\.hype:/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect command reports directory inputs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.mkdirSync(scenePath)
  try {
    const stderr = await captureStderr(async () => {
      await assert.rejects(
        withProcessExitThrow(async () => {
          inspectCommand().parse([scenePath], { from: 'user' })
        }),
        { exitCode: 2 },
      )
    })

    assert.match(stderr, /^\[inspect\] scene path is not a file: .*scene\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect command reports resolved relative scene paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-relative-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousCwd = process.cwd()
  fs.mkdirSync(scenePath)
  try {
    process.chdir(dir)
    const resolvedScenePath = path.resolve('scene.hype')
    const stderr = await captureStderr(async () => {
      await assert.rejects(
        withProcessExitThrow(async () => {
          inspectCommand().parse(['scene.hype'], { from: 'user' })
        }),
        { exitCode: 2 },
      )
    })

    assert.match(
      stderr,
      new RegExp(
        `^\\[inspect\\] scene path is not a file: ${escapeRegExp(resolvedScenePath)}$`,
        'm',
      ),
    )
  } finally {
    process.chdir(previousCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect command reports read failures after stat succeeds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-read-'))
  const scenePath = path.join(dir, 'scene.hype')
  const originalReadFileSync = fs.readFileSync
  try {
    fs.writeFileSync(scenePath, '')
    Object.defineProperty(fs, 'readFileSync', {
      configurable: true,
      value: ((readPath: fs.PathOrFileDescriptor) => {
        if (readPath === scenePath) throw new Error('read failed')
        return originalReadFileSync(readPath)
      }) as typeof fs.readFileSync,
    })

    const stderr = await captureStderr(async () => {
      await assert.rejects(
        withProcessExitThrow(async () => {
          inspectCommand().parse([scenePath], { from: 'user' })
        }),
        { exitCode: 2 },
      )
    })

    assert.equal(
      stderr,
      `[inspect] failed to read ${path.resolve(scenePath)}: read failed\n`,
    )
  } finally {
    Object.defineProperty(fs, 'readFileSync', { value: originalReadFileSync })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect command reports malformed scene files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-'))
  const scenePath = path.join(dir, 'broken.hype')
  try {
    fs.writeFileSync(scenePath, 'not a yjs update')

    const stderr = await captureStderr(async () => {
      await assert.rejects(
        withProcessExitThrow(async () => {
          inspectCommand().parse([scenePath], { from: 'user' })
        }),
        { exitCode: 2 },
      )
    })

    assert.match(stderr, /^\[inspect\] failed to inspect .*broken\.hype:/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
