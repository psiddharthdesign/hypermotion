// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { handleInfoScene } from './tools/infoScene.js'

test('info_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleInfoScene({ scene: missingScene })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, /^info_scene: failed to read /)
    assert.match(text, /hypermotion-missing-/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
