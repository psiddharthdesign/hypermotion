// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { handleRenderScene, renderSceneTool } from './tools/renderScene.js'

type JsonSchemaProperty = {
  type?: string
  enum?: string[]
  minimum?: number
  maximum?: number
  description?: string
}

test('render_scene input schema exposes fps bounds', () => {
  const fpsProperty = schemaProperty('fps')

  assert.equal(fpsProperty?.type, 'integer')
  assert.equal(fpsProperty?.minimum, 1)
  assert.equal(fpsProperty?.maximum, 120)
})

test('render_scene input schema exposes render preset enums', () => {
  const formatProperty = schemaProperty('format')
  const qualityProperty = schemaProperty('quality')

  assert.deepEqual(formatProperty?.enum, ['mp4', 'webm', 'gif'])
  assert.deepEqual(qualityProperty?.enum, ['comp', '720p', '2k', '4k'])
})

test('render_scene input schema exposes the optional scene path', () => {
  const sceneProperty = schemaProperty('scene')

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

test('render_scene reports missing scene files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleRenderScene({
      output: path.join(dir, 'out.mp4'),
      scene: missingScene,
    })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.equal(text, `render_scene: scene file not found: ${missingScene}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports scene directories as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.mkdirSync(scenePath)

  try {
    const result = await handleRenderScene({
      output: path.join(dir, 'out.mp4'),
      scene: scenePath,
    })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.equal(text, `render_scene: scene path is not a file: ${scenePath}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports scene stat failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-stat-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.writeFileSync(scenePath, '')
  const previousStatSync = fs.statSync

  try {
    Object.defineProperty(fs, 'statSync', {
      configurable: true,
      value: () => {
        throw new Error('stat failed')
      },
    })

    const result = await handleRenderScene({
      output: path.join(dir, 'out.mp4'),
      scene: scenePath,
    })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.equal(text, `render_scene: failed to read ${scenePath}: stat failed`)
  } finally {
    Object.defineProperty(fs, 'statSync', {
      configurable: true,
      value: previousStatSync,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function schemaProperty(name: string): JsonSchemaProperty | undefined {
  return renderSceneTool.inputSchema.properties?.[name] as
    | JsonSchemaProperty
    | undefined
}
