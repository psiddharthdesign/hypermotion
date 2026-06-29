// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { driveHeadlessRender } from './driver.js'

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
