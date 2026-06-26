// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
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
