// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
import { assertToolText } from '../testUtils/mcp.js'
import { handleInspectScene, inspectSceneTool } from './tools/inspectScene.js'

test('inspect_scene input schema exposes required scene path', () => {
  assert.deepEqual(inspectSceneTool.inputSchema, {
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

test('inspect_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleInspectScene({ scene: 42 })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^inspect_scene: invalid arguments/)
})

test('inspect_scene rejects unknown arguments as MCP errors', async () => {
  const result = await handleInspectScene({ scene: '/tmp/scene.hype', extra: true })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^inspect_scene: invalid arguments/)
})

test('inspect_scene rejects blank schema scene paths as MCP errors', async () => {
  const result = await handleInspectScene({ scene: '' })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^inspect_scene: invalid arguments/)
})

test('inspect_scene rejects blank scene paths as MCP errors', async () => {
  const result = await handleInspectScene({ scene: '   ' })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^inspect_scene: invalid arguments/)
})

test('inspect_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-missing-'))
  const scenePath = path.join(dir, 'missing.hype')

  try {
    const result = await handleInspectScene({ scene: scenePath })

    assert.equal(result.isError, true)
    assert.match(assertToolText(result), /^inspect_scene: failed to read /)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect_scene rejects directory inputs as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-dir-'))

  try {
    const result = await handleInspectScene({ scene: dir })

    assert.equal(result.isError, true)
    assert.equal(assertToolText(result), `inspect_scene: scene path is not a file: ${dir}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect_scene reports malformed scene files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-mcp-'))
  const scenePath = path.join(dir, 'broken.hype')

  try {
    fs.writeFileSync(scenePath, 'not a yjs update')

    const result = await handleInspectScene({ scene: scenePath })

    assert.equal(result.isError, true)
    assert.match(assertToolText(result), new RegExp(`^inspect_scene: failed to inspect ${scenePath}:`))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect_scene returns editable scene JSON for readable scenes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-mcp-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Inspect MCP',
          canvas: { width: 320, height: 180 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: ['title'],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          title: {
            id: 'title',
            kind: 'text',
            parent: 'root',
            text: 'Inspectable',
            fontFamily: 'Inter',
            fontSize: 24,
          },
        },
      }),
    )

    const result = await handleInspectScene({ scene: scenePath })

    assert.equal(result.isError, undefined)
    const scene = JSON.parse(assertToolText(result)) as {
      meta: { name?: string }
      nodes: Record<string, { kind?: string; text?: string }>
    }

    assert.equal(scene.meta.name, 'Inspect MCP')
    assert.equal(scene.nodes.root.kind, 'frame')
    assert.equal(scene.nodes.title.kind, 'text')
    assert.equal(scene.nodes.title.text, 'Inspectable')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('inspect_scene trims padded scene paths before reading', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-trimmed-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Trimmed Inspect MCP',
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

    const result = await handleInspectScene({ scene: `  ${scenePath}\n` })

    assert.equal(result.isError, undefined)
    const scene = JSON.parse(assertToolText(result)) as { meta: { name?: string } }
    assert.equal(scene.meta.name, 'Trimmed Inspect MCP')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
