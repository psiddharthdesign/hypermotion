// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
import { handleValidateScene } from './tools/validateScene.js'

test('validate_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleValidateScene({ scene: 42 })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^validate_scene: invalid arguments/)
})

test('validate_scene reports missing files as MCP errors', async () => {
  const result = await handleValidateScene({ scene: '/tmp/hypermotion-missing-scene.hype' })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^validate_scene: failed to read /)
})

test('validate_scene returns validation JSON for readable scenes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-mcp-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate MCP',
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

    const result = await handleValidateScene({ scene: scenePath })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''

    assert.equal(result.isError, undefined)
    assert.deepEqual(JSON.parse(text), {
      ok: true,
      errors: [],
      warnings: ['scene.activeCameraId is missing'],
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
