// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCommand } from './create.js'
import { readSceneSummary } from '../scene/build.js'
import { captureStdout } from '../testUtils/stdout.js'

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

    assert.match(stdout, /^Wrote .+scene\.hype \(.*1 layer, 0 tracks\)$/m)
    assert.equal(summary.meta.name, 'Nested Create')
    assert.deepEqual(summary.meta.canvas, { width: 320, height: 180 })
    assert.equal(summary.root, 'root')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
