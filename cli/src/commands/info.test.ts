// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { infoCommand } from './info.js'
import { buildSceneBytes, type SceneSummary } from '../scene/build.js'

test('info command prints JSON scene summaries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-info-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.writeFileSync(
    scenePath,
    buildSceneBytes({
      meta: {
        name: 'Info JSON',
        duration: 1.5,
        frameRate: 24,
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

  let stdout = ''
  const write = process.stdout.write
  process.stdout.write = ((value: string | Uint8Array) => {
    stdout += value.toString()
    return true
  }) as typeof process.stdout.write
  try {
    await infoCommand()
      .exitOverride()
      .parseAsync([scenePath, '--json'], { from: 'user' })
  } finally {
    process.stdout.write = write
  }

  const summary = JSON.parse(stdout) as SceneSummary

  assert.equal(summary.meta.name, 'Info JSON')
  assert.deepEqual(summary.meta.canvas, { width: 320, height: 180 })
  assert.equal(summary.layerCount, 1)
  assert.equal(summary.root, 'root')
})
