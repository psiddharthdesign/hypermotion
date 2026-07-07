// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes, readSceneSummary } from '../scene/build.js'
import { handlePatchScene, patchSceneTool } from './tools/patchScene.js'

test('patch_scene input schema exposes required scene and patch', () => {
  assert.deepEqual(patchSceneTool.inputSchema, {
    type: 'object',
    properties: {
      scene: { type: 'string', minLength: 1, description: 'Path to the input .hype scene file.' },
      output: { type: 'string', description: 'Path to write. Defaults to overwriting scene.' },
      patch: { description: 'Patch as { ops: [...] }, an operation array, or a JSON string.' },
      applyLive: {
        type: 'boolean',
        description: 'Push the patched scene into the running desktop app. Defaults to true.',
      },
    },
    required: ['scene', 'patch'],
  })
})

test('patch_scene reports invalid arguments as MCP errors', async () => {
  const result = await handlePatchScene({ scene: 42, patch: [] })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^patch_scene: invalid arguments/)
})

test('patch_scene rejects blank scene paths as MCP errors', async () => {
  const result = await handlePatchScene({ scene: '   ', patch: [] })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^patch_scene: invalid arguments/)
  assert.match(text, /scene path is required/)
})

test('patch_scene reports malformed JSON patches as MCP errors', async () => {
  const result = await handlePatchScene({ scene: 'scene.hype', patch: '{bad json' })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^patch_scene: failed to parse patch JSON:/)
})

test('patch_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-patch-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handlePatchScene({
      scene: missingScene,
      patch: { ops: [{ op: 'setMeta', patch: { name: 'Patched' } }] },
    })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, new RegExp(`^patch_scene: failed to read ${escapeRegExp(missingScene)}:`))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('patch_scene reports invalid patch operations as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-patch-invalid-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Original',
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

    const result = await handlePatchScene({
      scene: scenePath,
      applyLive: false,
      patch: { ops: [{ op: 'setNode', nodeId: 'missing', patch: { kind: 'text' } }] },
    })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, /^patch_scene: failed to apply patch: node does not exist: missing$/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('patch_scene writes alternate output without applying live', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-patch-'))
  const scenePath = path.join(dir, 'scene.hype')
  const outputPath = path.join(dir, 'patched.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Original',
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

    const result = await handlePatchScene({
      scene: scenePath,
      output: outputPath,
      applyLive: false,
      patch: {
        ops: [{ op: 'setMeta', patch: { name: 'Patched' } }],
      },
    })

    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, new RegExp(`^Patched ${escapeRegExp(scenePath)} → ${escapeRegExp(outputPath)}$`))
    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'Original')
    assert.equal(readSceneSummary(fs.readFileSync(outputPath)).meta.name, 'Patched')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('patch_scene overwrites the input scene by default without applying live', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-patch-in-place-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Before',
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

    const result = await handlePatchScene({
      scene: scenePath,
      applyLive: false,
      patch: {
        ops: [{ op: 'setMeta', patch: { name: 'After' } }],
      },
    })

    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, new RegExp(`^Patched ${escapeRegExp(scenePath)} → ${escapeRegExp(scenePath)}$`))
    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'After')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
