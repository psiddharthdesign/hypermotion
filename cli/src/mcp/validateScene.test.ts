// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
import { handleValidateScene, validateSceneTool } from './tools/validateScene.js'

test('validate_scene input schema exposes required scene path', () => {
  assert.deepEqual(validateSceneTool.inputSchema, {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .hype scene file.' },
    },
    required: ['scene'],
  })
})

test('validate_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleValidateScene({ scene: 42 })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^validate_scene: invalid arguments/)
})

test('validate_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleValidateScene({ scene: missingScene })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, /^validate_scene: failed to read /)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene rejects directory inputs as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-dir-'))

  try {
    const result = await handleValidateScene({ scene: dir })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.equal(text, `validate_scene: scene path is not a file: ${dir}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene reports read failures after stat succeeds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-read-'))
  const scenePath = path.join(dir, 'scene.hype')
  const previousReadFileSync = fs.readFileSync

  try {
    fs.writeFileSync(scenePath, '')
    Object.defineProperty(fs, 'readFileSync', {
      configurable: true,
      value: () => {
        throw new Error('read failed')
      },
    })

    const result = await handleValidateScene({ scene: scenePath })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.equal(text, `validate_scene: failed to read ${scenePath}: read failed`)
  } finally {
    Object.defineProperty(fs, 'readFileSync', {
      configurable: true,
      value: previousReadFileSync,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene reports malformed scene files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-malformed-'))
  const scenePath = path.join(dir, 'malformed.hype')

  try {
    fs.writeFileSync(scenePath, 'not a yjs update')

    const result = await handleValidateScene({ scene: scenePath })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, /^validate_scene: .*malformed\.hype doesn't look like a valid \.hype file:/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
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

test('validate_scene marks structurally invalid scenes as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-invalid-'))
  const scenePath = path.join(dir, 'invalid.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Invalid MCP',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: ['missing-child'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const result = await handleValidateScene({ scene: scenePath })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''

    assert.equal(result.isError, true)
    assert.deepEqual(JSON.parse(text), {
      ok: false,
      errors: ['node root has missing child: missing-child'],
      warnings: ['scene.activeCameraId is missing'],
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene rejects nested camera nodes as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-camera-'))
  const scenePath = path.join(dir, 'nested-camera.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Nested Camera MCP',
          canvas: { width: 320, height: 180 },
        },
        activeCameraId: 'camera',
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: ['camera'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          camera: {
            id: 'camera',
            kind: 'camera',
            parent: 'root',
            transform: { x: 160, y: 90, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          },
        },
      }),
    )

    const result = await handleValidateScene({ scene: scenePath })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''

    assert.equal(result.isError, true)
    assert.deepEqual(JSON.parse(text), {
      ok: false,
      errors: ['camera node camera must be scene-level with parent: null'],
      warnings: [],
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
