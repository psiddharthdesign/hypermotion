// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
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

test('inspect command reports missing scene files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-'))
  const scenePath = path.join(dir, 'missing.hype')
  const previousExit = process.exit
  try {
    process.exit = ((code?: number) => {
      throw Object.assign(new Error(`process.exit ${code ?? 0}`), { exitCode: code })
    }) as typeof process.exit

    const stderr = await captureStderr(async () => {
      assert.throws(
        () => {
          inspectCommand().parse([scenePath], { from: 'user' })
        },
        { exitCode: 2 },
      )
    })

    assert.match(stderr, /^\[inspect\] failed to read .*missing\.hype:/)
  } finally {
    process.exit = previousExit
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect command reports malformed scene files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-'))
  const scenePath = path.join(dir, 'broken.hype')
  const previousExit = process.exit
  try {
    fs.writeFileSync(scenePath, 'not a yjs update')
    process.exit = ((code?: number) => {
      throw Object.assign(new Error(`process.exit ${code ?? 0}`), { exitCode: code })
    }) as typeof process.exit

    const stderr = await captureStderr(async () => {
      assert.throws(
        () => {
          inspectCommand().parse([scenePath], { from: 'user' })
        },
        { exitCode: 2 },
      )
    })

    assert.match(stderr, /^\[inspect\] failed to inspect .*broken\.hype:/)
  } finally {
    process.exit = previousExit
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
