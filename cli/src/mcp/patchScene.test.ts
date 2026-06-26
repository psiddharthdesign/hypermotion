// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes, readSceneSummary } from '../scene/build.js'
import { handlePatchScene } from './tools/patchScene.js'

test('patch_scene writes alternate output without applying live', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-patch-'))
  const scenePath = path.join(dir, 'scene.hype')
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

    const result = await handlePatchScene({
      scene: scenePath,
      output: outputPath,
      applyLive: false,
      patch: {
        ops: [{ op: 'setMeta', patch: { name: 'Patched' } }],
      },
    })

    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, new RegExp(`^Patched ${escapeRegExp(scenePath)} → ${escapeRegExp(outputPath)}$`))
    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'Original')
    assert.equal(readSceneSummary(fs.readFileSync(outputPath)).meta.name, 'Patched')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
