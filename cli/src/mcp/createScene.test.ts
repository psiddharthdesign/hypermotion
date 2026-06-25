// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readSceneSummary } from '../scene/build.js'
import { handleCreateScene } from './tools/createScene.js'

test('create_scene reports persisted layer and track counts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-create-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    const result = await handleCreateScene({
      output: scenePath,
      scene: {
        nodes: {
          aliasA: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          aliasB: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
        tracks: {
          aliasA: {
            id: 'fade-root',
            nodeId: 'root',
            propertyId: 'appearance.opacity',
            keyframes: [
              { id: 'fade-start', time: 0, value: 0 },
              { id: 'fade-end', time: 0.2, value: 1 },
            ],
          },
          aliasB: {
            id: 'fade-root',
            nodeId: 'root',
            propertyId: 'appearance.opacity',
            keyframes: [],
          },
        },
      },
    })

    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    const summary = readSceneSummary(fs.readFileSync(scenePath))

    assert.equal(result.isError, undefined)
    assert.match(text, /1 layer, 1 track/)
    assert.equal(summary.layerCount, 1)
    assert.equal(summary.trackCount, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
