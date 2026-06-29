// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { driveHeadlessRender } from './driver.js'

test('driveHeadlessRender passes saved scene paths and clears stale files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')
  const scenePath = path.join(dir, 'scene with spaces.hype')

  fs.writeFileSync(outputPath, 'stale output')
  fs.writeFileSync(`${outputPath}.done`, 'stale sentinel')
  fs.writeFileSync(`${outputPath}.error`, 'stale error')
  fs.writeFileSync(scenePath, 'fake scene')
  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const sceneArg = process.argv.find((arg) => arg.startsWith('--scene='));",
      "const out = outArg?.slice('--out='.length);",
      "const scene = sceneArg?.slice('--scene='.length);",
      "if (!out || !scene) process.exit(2);",
      "fs.writeFileSync(out, scene);",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: scene.length }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await driveHeadlessRender({
      appPath,
      outputPath,
      format: 'mp4',
      quality: 'comp',
      fps: 30,
      scenePath,
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), scenePath)
    assert.equal(fs.existsSync(`${outputPath}.done`), false)
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender surfaces plain-text error sentinels', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "await import('node:fs').then((fs) => fs.writeFileSync(`${out}.error`, 'encoder failed before JSON'))",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /encoder failed before JSON/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender surfaces JSON error sentinel messages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.error`, JSON.stringify({ message: 'encoder reported JSON failure' }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /encoder reported JSON failure/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
