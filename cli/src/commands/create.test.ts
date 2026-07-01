// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCommand } from './create.js'
import { readSceneSummary } from '../scene/build.js'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr, captureStdout } from '../testUtils/stdout.js'

test('create command makes nested output directories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-create-'))
  const sourcePath = path.join(dir, 'scene.json')
  const scenePath = path.join(dir, 'nested', 'scene.hype')
  try {
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({
        meta: {
          name: 'Nested Create',
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
      await createCommand()
        .exitOverride()
        .parseAsync([scenePath, '--from', sourcePath], { from: 'user' })
    })

    const summary = readSceneSummary(fs.readFileSync(scenePath))

    assert.match(
      stdout,
      new RegExp(`^Wrote ${escapeRegExp(scenePath)} \\(.*1 layer, 0 tracks\\)$`, 'm'),
    )
    assert.equal(summary.meta.name, 'Nested Create')
    assert.deepEqual(summary.meta.canvas, { width: 320, height: 180 })
    assert.equal(summary.root, 'root')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create command reports authored layer and track counts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-create-'))
  const sourcePath = path.join(dir, 'scene.json')
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({
        nodes: {
          oldName: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          newName: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
        tracks: {
          oldName: {
            id: 'fade-root',
            nodeId: 'root',
            propertyId: 'appearance.opacity',
            keyframes: [
              { id: 'fade-start', time: 0, value: 0 },
              { id: 'fade-end', time: 0.2, value: 1 },
            ],
          },
          newerName: {
            id: 'fade-root',
            nodeId: 'root',
            propertyId: 'appearance.opacity',
            keyframes: [],
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await createCommand()
        .exitOverride()
        .parseAsync([scenePath, '--from', sourcePath], { from: 'user' })
    })

    const summary = readSceneSummary(fs.readFileSync(scenePath))

    assert.match(
      stdout,
      new RegExp(`^Wrote ${escapeRegExp(scenePath)} \\(.*1 layer, 1 track\\)$`, 'm'),
    )
    assert.equal(summary.layerCount, 1)
    assert.equal(summary.trackCount, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create command trims padded output paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-create-trimmed-output-'))
  const sourcePath = path.join(dir, 'scene.json')
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({
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

    await captureStdout(async () => {
      await createCommand()
        .exitOverride()
        .parseAsync([` ${scenePath} `, '--from', sourcePath], { from: 'user' })
    })

    assert.equal(fs.existsSync(scenePath), true)
    assert.equal(fs.existsSync(path.join(dir, ` ${path.basename(scenePath)} `)), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('create command rejects top-level JSON arrays', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-create-'))
  const sourcePath = path.join(dir, 'scene.json')
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(sourcePath, '[]')

    const stderr = await withProcessExitThrow(async () => {
      return captureStderr(async () => {
        await assert.rejects(
          createCommand()
            .parseAsync([scenePath, '--from', sourcePath], { from: 'user' }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(
      stderr,
      /^\[create\] scene JSON must be an object at the top level\.$/m,
    )
    assert.equal(fs.existsSync(scenePath), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create command rejects top-level JSON null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-create-'))
  const sourcePath = path.join(dir, 'scene.json')
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(sourcePath, 'null')

    const stderr = await withProcessExitThrow(async () => {
      return captureStderr(async () => {
        await assert.rejects(
          createCommand()
            .parseAsync([scenePath, '--from', sourcePath], { from: 'user' }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(
      stderr,
      /^\[create\] scene JSON must be an object at the top level\.$/m,
    )
    assert.equal(fs.existsSync(scenePath), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create command rejects top-level primitive JSON values', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-create-'))
  const sourcePath = path.join(dir, 'scene.json')
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(sourcePath, '"scene"')

    const stderr = await withProcessExitThrow(async () => {
      return captureStderr(async () => {
        await assert.rejects(
          createCommand()
            .parseAsync([scenePath, '--from', sourcePath], { from: 'user' }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(
      stderr,
      /^\[create\] scene JSON must be an object at the top level\.$/m,
    )
    assert.equal(fs.existsSync(scenePath), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
