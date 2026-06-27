// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
import { handleInspectScene, inspectSceneTool } from './tools/inspectScene.js'

test('inspect_scene input schema exposes required scene path', () => {
  assert.deepEqual(inspectSceneTool.inputSchema, {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .hype scene file.' },
    },
    required: ['scene'],
  })
})

test('inspect_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleInspectScene({ scene: 42 })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^inspect_scene: invalid arguments/)
})

test('inspect_scene reports missing files as MCP errors', async () => {
  const result = await handleInspectScene({ scene: '/tmp/hypermotion-missing-inspect-scene.hype' })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^inspect_scene: failed to read /)
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
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    const scene = JSON.parse(text) as {
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
