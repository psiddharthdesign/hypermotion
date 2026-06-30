// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertToolText } from '../testUtils/mcp.js'
import { handleOpenScene, openSceneTool } from './tools/openScene.js'

test('open_scene input schema exposes required scene path', () => {
  assert.deepEqual(openSceneTool.inputSchema, {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .hype scene file.' },
    },
    required: ['scene'],
  })
})

test('open_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleOpenScene({ scene: 42 })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^open_scene: invalid arguments/)
})

test('open_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleOpenScene({ scene: missingScene })

    assert.equal(result.isError, true)
    assert.equal(assertToolText(result), `Scene file not found: ${missingScene}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open_scene reports directories as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-dir-'))
  const sceneDir = path.join(dir, 'scene.hype')
  fs.mkdirSync(sceneDir)

  try {
    const result = await handleOpenScene({ scene: sceneDir })

    assert.equal(result.isError, true)
    assert.equal(assertToolText(result), `Scene path is not a file: ${sceneDir}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open_scene reports stat failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-stat-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.writeFileSync(scenePath, '')

  try {
    const result = await handleOpenScene(
      { scene: scenePath },
      {
        existsSync: fs.existsSync,
        statSync: () => {
          throw new Error('stat failed')
        },
        openScene: async () => true,
      },
    )

    assert.equal(result.isError, true)
    assert.equal(assertToolText(result), `open_scene: failed to read ${scenePath}: stat failed`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open_scene reports desktop launch failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-launch-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.writeFileSync(scenePath, '')

  try {
    const result = await handleOpenScene(
      { scene: scenePath },
      {
        existsSync: fs.existsSync,
        statSync: fs.statSync,
        openScene: async () => {
          throw new Error('launch failed')
        },
      },
    )

    assert.equal(result.isError, true)
    assert.equal(assertToolText(result), `open_scene: failed to open ${scenePath}: launch failed`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
