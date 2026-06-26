// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { handleOpenScene } from './tools/openScene.js'

test('open_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleOpenScene({ scene: missingScene })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.equal(text, `Scene file not found: ${missingScene}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
