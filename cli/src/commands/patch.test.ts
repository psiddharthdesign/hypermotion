// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes, readSceneSummary } from '../scene/build.js'
import { captureStdout } from '../testUtils/stdout.js'
import { patchCommand } from './patch.js'

test('patch command writes alternate output files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-patch-'))
  const scenePath = path.join(dir, 'scene.hype')
  const patchPath = path.join(dir, 'patch.json')
  const outputPath = path.join(dir, 'patched.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Original',
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
    fs.writeFileSync(
      patchPath,
      JSON.stringify({ ops: [{ op: 'setMeta', patch: { name: 'Patched' } }] }),
    )

    const stdout = await captureStdout(async () => {
      await patchCommand()
        .exitOverride()
        .parseAsync([scenePath, '--from', patchPath, '--output', outputPath], {
          from: 'user',
        })
    })

    assert.match(stdout, /^Patched .*scene\.hype → .*patched\.hype$/m)
    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'Original')
    assert.equal(readSceneSummary(fs.readFileSync(outputPath)).meta.name, 'Patched')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('patch command overwrites the input scene by default', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-patch-'))
  const scenePath = path.join(dir, 'scene.hype')
  const patchPath = path.join(dir, 'patch.json')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Before',
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
    fs.writeFileSync(
      patchPath,
      JSON.stringify({ ops: [{ op: 'setMeta', patch: { name: 'After' } }] }),
    )

    const stdout = await captureStdout(async () => {
      await patchCommand().exitOverride().parseAsync([scenePath, '--from', patchPath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Patched .*scene\.hype → .*scene\.hype$/m)
    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'After')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
