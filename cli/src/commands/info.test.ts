// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { infoCommand } from './info.js'
import { buildSceneBytes, type SceneSummary } from '../scene/build.js'
import { captureStdout } from '../testUtils/stdout.js'

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
          camera: {
            id: 'camera',
            kind: 'camera',
            parent: null,
            transform: {
              x: 160,
              y: 90,
              z: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
            },
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await infoCommand()
        .exitOverride()
        .parseAsync([scenePath, '--json'], { from: 'user' })
    })

    const summary = JSON.parse(stdout) as SceneSummary

    assert.equal(summary.meta.name, 'Info JSON')
    assert.deepEqual(summary.meta.canvas, { width: 320, height: 180 })
    assert.equal(summary.layerCount, 2)
    assert.equal(summary.root, 'root')
    assert.equal(summary.activeCameraId, 'camera')
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
        tracks: {
          fade: {
            id: 'fade',
            nodeId: 'root',
            propertyId: 'appearance.opacity',
            keyframes: [
              { id: 'fade-start', time: 0, value: 0 },
              { id: 'fade-end', time: 1, value: 1 },
            ],
          },
        },
        sections: {
          intro: {
            id: 'intro',
            name: 'Intro',
            start: 0,
            end: 2,
            color: '#60a5fa',
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await infoCommand().exitOverride().parseAsync([scenePath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Scene: Info Text$/m)
    assert.match(stdout, /^ {2}Canvas: {4}640 × 360$/m)
    assert.match(stdout, /^ {2}Duration: {2}2s @ 30fps$/m)
    assert.match(stdout, /^ {2}Layers: {4}2$/m)
    assert.match(stdout, /^ {2}Tracks: {4}1$/m)
    assert.match(stdout, /^ {2}Sections: {2}1$/m)
    assert.match(stdout, /^ {2}Keyframes: 2$/m)
    assert.match(stdout, /^ {2}Root id: {3}root$/m)
    assert.match(stdout, /^ {2}Camera id: camera$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('info command omits camera line when no active camera exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-info-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    fs.writeFileSync(
      scenePath,
      buildSceneBytes({
        meta: {
          name: 'No Camera',
          canvas: { width: 400, height: 300 },
        },
        nodes: {
          root: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 400, height: 300 },
            layout: { mode: 'none' },
          },
        },
      }),
    )

    const stdout = await captureStdout(async () => {
      await infoCommand().exitOverride().parseAsync([scenePath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Scene: No Camera$/m)
    assert.match(stdout, /^ {2}Root id: {3}root$/m)
    assert.doesNotMatch(stdout, /^ {2}Camera id:/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
