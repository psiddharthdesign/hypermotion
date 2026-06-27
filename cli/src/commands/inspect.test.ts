// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes } from '../scene/build.js'
import { captureStdout } from '../testUtils/stdout.js'
import { inspectCommand } from './inspect.js'

test('inspect command prints the editable scene graph as JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-inspect-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Inspect JSON',
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

    const stdout = await captureStdout(async () => {
      await inspectCommand()
        .exitOverride()
        .parseAsync([scenePath, '--json'], { from: 'user' })
    })

    const scene = JSON.parse(stdout) as {
      meta: { name?: string }
      nodes: Record<string, { kind?: string; text?: string }>
    }

    assert.equal(scene.meta.name, 'Inspect JSON')
    assert.equal(scene.nodes.root.kind, 'frame')
    assert.equal(scene.nodes.title.kind, 'text')
    assert.equal(scene.nodes.title.text, 'Inspectable')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
