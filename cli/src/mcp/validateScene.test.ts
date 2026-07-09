// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
import { assertToolText } from '../testUtils/mcp.js'
import { handleValidateScene, validateSceneTool } from './tools/validateScene.js'
import type { ValidateSceneDeps } from './tools/validateScene.js'

function testDeps(overrides: Partial<ValidateSceneDeps>): ValidateSceneDeps {
  return {
    statSync: fs.statSync,
    readFileSync: fs.readFileSync,
    ...overrides,
  }
}

test('validate_scene input schema exposes required scene path', () => {
  assert.deepEqual(validateSceneTool.inputSchema, {
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

test('validate_scene description does not require absolute paths', () => {
  const description = validateSceneTool.description ?? ''
  assert.match(description, /Pass the path to the \.hype file\./)
  assert.doesNotMatch(description, /absolute path only/i)
})

test('validate_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleValidateScene({ scene: 42 })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^validate_scene: invalid arguments/)
})

test('validate_scene rejects unknown arguments as MCP errors', async () => {
  const result = await handleValidateScene({ scene: 'demo.hype', output: 'demo.json' })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^validate_scene: invalid arguments/)
})

test('validate_scene rejects blank schema scene paths as MCP errors', async () => {
  const result = await handleValidateScene({ scene: '' })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^validate_scene: invalid arguments/)
})

test('validate_scene rejects empty scene paths at schema validation', async () => {
  const result = await handleValidateScene({ scene: '   ' })

  assert.equal(result.isError, true)
  const text = assertToolText(result)
  assert.match(text, /^validate_scene: invalid arguments/)
  assert.match(text, /scene path is required/)
})

test('validate_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleValidateScene({ scene: missingScene })

    assert.equal(result.isError, true)
    assert.match(assertToolText(result), /^validate_scene: failed to read /)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene rejects directory inputs as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-dir-'))

  try {
    const result = await handleValidateScene({ scene: dir })

    assert.equal(result.isError, true)
    assert.equal(assertToolText(result), `validate_scene: scene path is not a file: ${dir}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene reports stat failures as read errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-stat-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    const result = await handleValidateScene(
      { scene: scenePath },
      testDeps({
        statSync: (statPath: fs.PathLike) => {
          if (statPath === scenePath) throw new Error('stat failed')
          return fs.statSync(statPath)
        },
      }),
    )

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `validate_scene: failed to read ${scenePath}: stat failed`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene reports read failures after stat succeeds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-read-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(scenePath, '')

    const result = await handleValidateScene(
      { scene: scenePath },
      testDeps({
        readFileSync: () => {
          throw new Error('read failed')
        },
      }),
    )

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `validate_scene: failed to read ${scenePath}: read failed`,
    )
  } finally {
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
    assert.match(
      assertToolText(result),
      /^validate_scene: .*malformed\.hype doesn't look like a valid \.hype file:/,
    )
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

    assert.equal(result.isError, undefined)
    assert.deepEqual(JSON.parse(assertToolText(result)), {
      ok: true,
      errors: [],
      warnings: [],
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene trims padded scene paths before reading', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-trimmed-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Trimmed MCP',
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

    const result = await handleValidateScene({ scene: `  ${scenePath}\n` })

    assert.equal(result.isError, undefined)
    assert.equal(JSON.parse(assertToolText(result)).ok, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('validate_scene resolves relative scene paths before reading', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-validate-relative-'))
  const scenePath = path.join(dir, 'scene.hype')
  const relativeScenePath = path.relative(process.cwd(), scenePath)
  const statPaths: string[] = []

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Validate Relative MCP',
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

    const result = await handleValidateScene(
      { scene: relativeScenePath },
      testDeps({
        statSync: (statPath) => {
          statPaths.push(String(statPath))
          return fs.statSync(statPath)
        },
      }),
    )

    assert.equal(result.isError, undefined)
    assert.deepEqual(statPaths, [scenePath])
    assert.equal(JSON.parse(assertToolText(result)).ok, true)
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

    assert.equal(result.isError, true)
    assert.deepEqual(JSON.parse(assertToolText(result)), {
      ok: false,
      errors: ['node root has missing child: missing-child'],
      warnings: [],
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

    assert.equal(result.isError, true)
    assert.deepEqual(JSON.parse(assertToolText(result)), {
      ok: false,
      errors: ['camera node camera must be scene-level with parent: null'],
      warnings: [],
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
