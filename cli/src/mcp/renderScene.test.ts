// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { handleRenderScene, renderSceneTool } from './tools/renderScene.js'

test('render_scene input schema exposes fps bounds', () => {
  const fpsProperty = renderSceneTool.inputSchema.properties?.fps as
    | Record<string, unknown>
    | undefined

  assert.equal(fpsProperty?.type, 'integer')
  assert.equal(fpsProperty?.minimum, 1)
  assert.equal(fpsProperty?.maximum, 120)
})

test('render_scene input schema exposes render preset enums', () => {
  const formatProperty = renderSceneTool.inputSchema.properties?.format as
    | Record<string, unknown>
    | undefined
  const qualityProperty = renderSceneTool.inputSchema.properties?.quality as
    | Record<string, unknown>
    | undefined

  assert.deepEqual(formatProperty?.enum, ['mp4', 'webm', 'gif'])
  assert.deepEqual(qualityProperty?.enum, ['comp', '720p', '2k', '4k'])
})

test('render_scene input schema exposes the optional scene path', () => {
  const sceneProperty = renderSceneTool.inputSchema.properties?.scene as
    | Record<string, unknown>
    | undefined

  assert.equal(sceneProperty?.type, 'string')
  assert.match(String(sceneProperty?.description), /\.hype scene file/)
})

test('render_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleRenderScene({
    output: 'demo.mp4',
    fps: 0,
  })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^render_scene: invalid arguments/)
})
