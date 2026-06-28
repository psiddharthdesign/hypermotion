// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes, type SceneSummary } from '../scene/build.js'
import { handleInfoScene, infoSceneTool } from './tools/infoScene.js'

test('info_scene input schema exposes required scene path', () => {
  assert.deepEqual(infoSceneTool.inputSchema, {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .hype scene file' },
    },
    required: ['scene'],
  })
})

test('info_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleInfoScene({ scene: 42 })

  assert.equal(result.isError, true)
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /^info_scene: invalid arguments/)
})

test('info_scene returns a structured scene summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-info-scene-'))
  const scenePath = path.join(dir, 'scene.hype')

  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'MCP Info',
          duration: 1.25,
          frameRate: 24,
          canvas: { width: 640, height: 360 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 640, height: 360 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const result = await handleInfoScene({ scene: scenePath })

    assert.equal(result.isError, undefined)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    const summary = JSON.parse(text) as SceneSummary

    assert.equal(summary.meta.name, 'MCP Info')
    assert.deepEqual(summary.meta.canvas, { width: 640, height: 360 })
    assert.equal(summary.layerCount, 1)
    assert.equal(summary.root, 'root')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('info_scene reports missing files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleInfoScene({ scene: missingScene })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, /^info_scene: failed to read /)
    assert.match(text, /hypermotion-missing-/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('info_scene reports malformed scene files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-info-malformed-'))
  const scenePath = path.join(dir, 'malformed.hype')

  try {
    fs.writeFileSync(scenePath, 'not a yjs update')

    const result = await handleInfoScene({ scene: scenePath })

    assert.equal(result.isError, true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    assert.match(text, /^info_scene: .*malformed\.hype is not a valid \.hype file:/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
