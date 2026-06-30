// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr, captureStdout } from '../testUtils/stdout.js'
import { validateCommand } from './validate.js'

test('validate command prints JSON validation results', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousExitCode = process.exitCode
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate JSON',
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
      await validateCommand()
        .exitOverride()
        .parseAsync([scenePath, '--json'], { from: 'user' })
    })

    assert.deepEqual(JSON.parse(stdout), {
      ok: true,
      errors: [],
      warnings: ['scene.activeCameraId is missing'],
    })
    assert.equal(process.exitCode, previousExitCode)
  } finally {
    process.exitCode = previousExitCode
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command prints human-readable validation errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousExitCode = process.exitCode
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Text',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: ['missing-child'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await validateCommand().exitOverride().parseAsync([scenePath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Scene is invalid$/m)
    assert.match(stdout, /^error: node root has missing child: missing-child$/m)
    assert.match(stdout, /^warning: scene\.activeCameraId is missing$/m)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command prints JSON validation errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousExitCode = process.exitCode
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate JSON Errors',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: ['missing-child'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await validateCommand()
        .exitOverride()
        .parseAsync([scenePath, '--json'], { from: 'user' })
    })

    assert.deepEqual(JSON.parse(stdout), {
      ok: false,
      errors: ['node root has missing child: missing-child'],
      warnings: ['scene.activeCameraId is missing'],
    })
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command rejects a non-camera active camera id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousExitCode = process.exitCode
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Active Camera',
          canvas: { width: 320, height: 180 },
        },
        activeCameraId: 'root',
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
      await validateCommand().exitOverride().parseAsync([scenePath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Scene is invalid$/m)
    assert.match(stdout, /^error: scene\.activeCameraId is not a camera node: root$/m)
    assert.doesNotMatch(stdout, /^warning: scene\.activeCameraId is missing$/m)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command rejects camera nodes nested under frames', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousExitCode = process.exitCode
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Nested Camera',
          canvas: { width: 320, height: 180 },
        },
        activeCameraId: 'camera',
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: ['camera'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          camera: {
            id: 'camera',
            kind: 'camera',
            parent: 'root',
            transform: { x: 160, y: 90, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await validateCommand().exitOverride().parseAsync([scenePath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Scene is invalid$/m)
    assert.match(stdout, /^error: camera node camera must be scene-level with parent: null$/m)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command rejects a parent link missing from children', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousExitCode = process.exitCode
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Parent Link',
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
          title: {
            id: 'title',
            kind: 'text',
            parent: 'root',
            text: 'Detached child',
            fontFamily: 'Inter',
            fontSize: 24,
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await validateCommand().exitOverride().parseAsync([scenePath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Scene is invalid$/m)
    assert.match(stdout, /^error: node title parent root does not list it as a child$/m)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command rejects duplicate child entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousExitCode = process.exitCode
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Duplicate Child',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: ['title', 'title'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          title: {
            id: 'title',
            kind: 'text',
            parent: 'root',
            text: 'Duplicate child',
            fontFamily: 'Inter',
            fontSize: 24,
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await validateCommand().exitOverride().parseAsync([scenePath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Scene is invalid$/m)
    assert.match(stdout, /^error: node root lists duplicate child: title$/m)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command reports missing scene files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'missing.hype')
  try {
    const stderr = await withProcessExitThrow(() => captureStderr(() => {
      assert.throws(
        () => {
          validateCommand().parse([scenePath], { from: 'user' })
        },
        { exitCode: 2 },
      )
    }))

    assert.match(stderr, /^\[validate\] failed to read .*missing\.hype:/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command reports directories before reading scene bytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.mkdirSync(scenePath)
  try {
    const stderr = await withProcessExitThrow(() => captureStderr(() => {
      assert.throws(
        () => {
          validateCommand().parse([scenePath], { from: 'user' })
        },
        { exitCode: 2 },
      )
    }))

    assert.match(stderr, /^\[validate\] scene path is not a file: .*scene\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command reports stat failures as read errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-stat-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousStatSync = fs.statSync
  try {
    fs.writeFileSync(scenePath, '')
    Object.defineProperty(fs, 'statSync', {
      configurable: true,
      value: () => {
        throw new Error('stat failed')
      },
    })

    const stderr = await withProcessExitThrow(() => captureStderr(() => {
      assert.throws(
        () => {
          validateCommand().parse([scenePath], { from: 'user' })
        },
        { exitCode: 2 },
      )
    }))

    assert.equal(
      stderr,
      `[validate] failed to read ${path.resolve(scenePath)}: stat failed\n`,
    )
  } finally {
    Object.defineProperty(fs, 'statSync', {
      configurable: true,
      value: previousStatSync,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate command reports malformed scene files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-'))
  const scenePath = path.join(dir, 'malformed.hype')
  try {
    fs.writeFileSync(scenePath, 'not a yjs update')

    const stderr = await withProcessExitThrow(() => captureStderr(() => {
      assert.throws(
        () => {
          validateCommand().parse([scenePath], { from: 'user' })
        },
        { exitCode: 2 },
      )
    }))

    assert.match(stderr, /^\[validate\] .*malformed\.hype doesn't look like a valid \.hype file:/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
