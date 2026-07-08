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
      scene: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description: 'Absolute or relative path to a .hype scene file.',
      },
    },
    required: ['scene'],
    additionalProperties: false,
  })
})

test('open_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleOpenScene({ scene: 42 })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^open_scene: invalid arguments/)
})

test('open_scene rejects empty schema scene paths as MCP errors', async () => {
  const result = await handleOpenScene({ scene: '' })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^open_scene: invalid arguments/)
})

test('open_scene rejects unknown arguments as MCP errors', async () => {
  const result = await handleOpenScene({ scene: 'demo.hype', output: 'demo.mp4' })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^open_scene: invalid arguments/)
})

test('open_scene rejects empty scene paths as MCP errors', async () => {
  const result = await handleOpenScene({ scene: '   ' })

  assert.equal(result.isError, true)
  assert.equal(assertToolText(result), 'open_scene: scene path is required')
})

test('open_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleOpenScene({ scene: missingScene })

    assert.equal(result.isError, true)
    assert.equal(assertToolText(result), `open_scene: scene file not found: ${missingScene}`)
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
    assert.equal(assertToolText(result), `open_scene: scene path is not a file: ${sceneDir}`)
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

test('open_scene reports missing desktop apps as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-app-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.writeFileSync(scenePath, '')

  try {
    const result = await handleOpenScene(
      { scene: scenePath },
      {
        existsSync: fs.existsSync,
        statSync: fs.statSync,
        openScene: async () => false,
      },
    )

    assert.equal(result.isError, true)
    assert.equal(assertToolText(result), 'hyper-motion desktop app not found.')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open_scene reports opened scene paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-success-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.writeFileSync(scenePath, '')

  try {
    const result = await handleOpenScene(
      { scene: scenePath },
      {
        existsSync: fs.existsSync,
        statSync: fs.statSync,
        openScene: async () => true,
      },
    )

    assert.equal(result.isError, undefined)
    assert.equal(assertToolText(result), `Opened ${scenePath}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open_scene trims padded scene paths before opening', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-trimmed-'))
  const scenePath = path.join(dir, 'scene.hype')
  const openedPaths: string[] = []
  fs.writeFileSync(scenePath, '')

  try {
    const result = await handleOpenScene(
      { scene: ` ${scenePath} ` },
      {
        existsSync: fs.existsSync,
        statSync: fs.statSync,
        openScene: async (pathToOpen) => {
          openedPaths.push(pathToOpen)
          return true
        },
      },
    )

    assert.equal(result.isError, undefined)
    assert.deepEqual(openedPaths, [scenePath])
    assert.equal(assertToolText(result), `Opened ${scenePath}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('open_scene resolves relative scene paths before opening', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-open-relative-'))
  const scenePath = path.join(dir, 'scene.hype')
  const relativeScenePath = path.relative(process.cwd(), scenePath)
  const openedPaths: string[] = []
  fs.writeFileSync(scenePath, '')

  try {
    const result = await handleOpenScene(
      { scene: relativeScenePath },
      {
        existsSync: fs.existsSync,
        statSync: fs.statSync,
        openScene: async (pathToOpen) => {
          openedPaths.push(pathToOpen)
          return true
        },
      },
    )

    assert.equal(result.isError, undefined)
    assert.deepEqual(openedPaths, [scenePath])
    assert.equal(assertToolText(result), `Opened ${scenePath}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
