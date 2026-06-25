// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { infoCommand } from './info.js'
import { buildSceneBytes, type SceneSummary } from '../scene/build.js'

test('info command prints JSON scene summaries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-info-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Info JSON',
          duration: 1.5,
          frameRate: 24,
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

    let stdout = ''
    const write = process.stdout.write
    process.stdout.write = ((value: string | Uint8Array) => {
      stdout += value.toString()
      return true
    }) as typeof process.stdout.write
    try {
      await infoCommand()
        .exitOverride()
        .parseAsync([scenePath, '--json'], { from: 'user' })
    } finally {
      process.stdout.write = write
    }

    const summary = JSON.parse(stdout) as SceneSummary

    assert.equal(summary.meta.name, 'Info JSON')
    assert.deepEqual(summary.meta.canvas, { width: 320, height: 180 })
    assert.equal(summary.layerCount, 1)
    assert.equal(summary.root, 'root')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('info command prints human-readable scene summaries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-info-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'Info Text',
          duration: 2,
          frameRate: 30,
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
          camera: {
            id: 'camera',
            kind: 'camera',
            parent: null,
            transform: {
              x: 320,
              y: 180,
              z: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
            },
          },
        },
      }),
    )

    let stdout = ''
    const write = process.stdout.write
    process.stdout.write = ((value: string | Uint8Array) => {
      stdout += value.toString()
      return true
    }) as typeof process.stdout.write
    try {
      await infoCommand().exitOverride().parseAsync([scenePath], {
        from: 'user',
      })
    } finally {
      process.stdout.write = write
    }

    assert.match(stdout, /^Scene: Info Text$/m)
    assert.match(stdout, /^  Canvas:    640 × 360$/m)
    assert.match(stdout, /^  Duration:  2s @ 30fps$/m)
    assert.match(stdout, /^  Layers:    2$/m)
    assert.match(stdout, /^  Root id:   root$/m)
    assert.match(stdout, /^  Camera id: camera$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
