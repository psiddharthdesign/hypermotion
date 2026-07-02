// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSceneBytes, readSceneSummary } from '../scene/build.js'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr, captureStdout } from '../testUtils/stdout.js'
import { patchCommand } from './patch.js'

test('patch command writes alternate output files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-patch-'))
  const scenePath = path.join(dir, 'scene.hype')
  const patchPath = path.join(dir, 'patch.json')
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
    fs.writeFileSync(
      patchPath,
      JSON.stringify({ ops: [{ op: 'setMeta', patch: { name: 'Patched' } }] }),
    )

    const stdout = await captureStdout(async () => {
      await patchCommand()
        .exitOverride()
        .parseAsync([scenePath, '--from', patchPath, '--output', outputPath], {
          from: 'user',
        })
    })

    assert.match(stdout, /^Patched .*scene\.hype → .*patched\.hype$/m)
    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'Original')
    assert.equal(readSceneSummary(fs.readFileSync(outputPath)).meta.name, 'Patched')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('patch command overwrites the input scene by default', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-patch-'))
  const scenePath = path.join(dir, 'scene.hype')
  const patchPath = path.join(dir, 'patch.json')

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
    fs.writeFileSync(
      patchPath,
      JSON.stringify({ ops: [{ op: 'setMeta', patch: { name: 'After' } }] }),
    )

    const stdout = await captureStdout(async () => {
      await patchCommand().exitOverride().parseAsync([scenePath, '--from', patchPath], {
        from: 'user',
      })
    })

    assert.match(stdout, /^Patched .*scene\.hype → .*scene\.hype$/m)
    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'After')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('patch command trims padded scene paths before reading', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-patch-trimmed-'))
  const scenePath = path.join(dir, 'scene.hype')
  const patchPath = path.join(dir, 'patch.json')

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
    fs.writeFileSync(
      patchPath,
      JSON.stringify({ ops: [{ op: 'setMeta', patch: { name: 'Trimmed' } }] }),
    )

    await patchCommand()
      .exitOverride()
      .parseAsync([`  ${scenePath}\n`, '--from', patchPath], {
        from: 'user',
      })

    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'Trimmed')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('patch command rejects blank scene paths before reading patch JSON', async () => {
  const stderr = await withProcessExitThrow(() => captureStderr(() => {
    return assert.rejects(
      patchCommand().parseAsync(['   ', '--from', 'missing.json'], { from: 'user' }),
      { exitCode: 2 },
    )
  }))

  assert.equal(stderr, '[patch] scene path is required\n')
})

test('patch command reports directories before reading scene bytes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-patch-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  const patchPath = path.join(dir, 'patch.json')
  fs.mkdirSync(scenePath)
  fs.writeFileSync(
    patchPath,
    JSON.stringify({ ops: [{ op: 'setMeta', patch: { name: 'Patched' } }] }),
  )

  try {
    const stderr = await withProcessExitThrow(() => captureStderr(() => {
      return assert.rejects(
        patchCommand().parseAsync([scenePath, '--from', patchPath], { from: 'user' }),
        { exitCode: 2 },
      )
    }))

    assert.match(stderr, /^\[patch\] scene path is not a file: .*scene\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('patch command rejects top-level primitive JSON values', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-patch-primitive-'))
  const scenePath = path.join(dir, 'scene.hype')
  const patchPath = path.join(dir, 'patch.json')

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
    fs.writeFileSync(patchPath, '"patch"')

    const stderr = await withProcessExitThrow(() => captureStderr(() => {
      return assert.rejects(
        patchCommand().parseAsync([scenePath, '--from', patchPath], { from: 'user' }),
        { exitCode: 2 },
      )
    }))

    assert.match(
      stderr,
      /^\[patch\] patch JSON must be an array or object at the top level\.$/m,
    )
    assert.equal(readSceneSummary(fs.readFileSync(scenePath)).meta.name, 'Original')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
