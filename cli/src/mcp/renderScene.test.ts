// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { handleRenderScene } from './tools/renderScene.js'

test('render_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleRenderScene({
    output: 'demo.mp4',
    fps: 0,
  })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^render_scene: invalid arguments/)
})
