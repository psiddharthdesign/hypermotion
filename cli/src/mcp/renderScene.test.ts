// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { withEnvVar } from '../testUtils/env.js'
import { assertToolText } from '../testUtils/mcp.js'
import { handleRenderScene, renderSceneTool } from './tools/renderScene.js'

type JsonSchemaProperty = {
  type?: string
  enum?: string[]
  minimum?: number
  maximum?: number
  description?: string
}

test('render_scene input schema exposes fps bounds', () => {
  const fpsProperty = schemaProperty('fps')

  assert.equal(fpsProperty?.type, 'integer')
  assert.equal(fpsProperty?.minimum, 1)
  assert.equal(fpsProperty?.maximum, 120)
})

test('render_scene input schema exposes render preset enums', () => {
  const formatProperty = schemaProperty('format')
  const qualityProperty = schemaProperty('quality')

  assert.deepEqual(formatProperty?.enum, ['mp4', 'webm', 'gif'])
  assert.deepEqual(qualityProperty?.enum, ['comp', '720p', '2k', '4k'])
})

test('render_scene input schema exposes the optional scene path', () => {
  const sceneProperty = schemaProperty('scene')

  assert.equal(sceneProperty?.type, 'string')
  assert.match(String(sceneProperty?.description), /\.hype scene file/)
})

test('render_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleRenderScene({
    output: 'demo.mp4',
    fps: 0,
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^render_scene: invalid arguments/)
})

test('render_scene rejects fractional fps values as MCP errors', async () => {
  const result = await handleRenderScene({
    output: 'demo.mp4',
    fps: 30.5,
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^render_scene: invalid arguments/)
  assert.match(assertToolText(result), /Expected integer/)
})

test('render_scene reports missing scene files as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-missing-'))
  const missingScene = path.join(dir, 'scene.hype')

  try {
    const result = await handleRenderScene({
      output: path.join(dir, 'out.mp4'),
      scene: missingScene,
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: scene file not found: ${missingScene}`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports scene directories as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.mkdirSync(scenePath)

  try {
    const result = await handleRenderScene({
      output: path.join(dir, 'out.mp4'),
      scene: scenePath,
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: scene path is not a file: ${scenePath}`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports scene stat failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-stat-'))
  const scenePath = path.join(dir, 'scene.hype')
  fs.writeFileSync(scenePath, '')
  const previousStatSync = fs.statSync

  try {
    Object.defineProperty(fs, 'statSync', {
      configurable: true,
      value: () => {
        throw new Error('stat failed')
      },
    })

    const result = await handleRenderScene({
      output: path.join(dir, 'out.mp4'),
      scene: scenePath,
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: failed to read ${scenePath}: stat failed`,
    )
  } finally {
    Object.defineProperty(fs, 'statSync', {
      configurable: true,
      value: previousStatSync,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports output parent files before locating the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-parent-'))
  const parentPath = path.join(dir, 'exports')
  fs.writeFileSync(parentPath, 'not a directory')

  try {
    const result = await handleRenderScene({
      output: path.join(parentPath, 'out.mp4'),
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: output directory is not a directory: ${parentPath}`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports output directory stat failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-stat-'))
  const outDir = path.join(dir, 'exports')
  fs.mkdirSync(outDir)
  const previousStatSync = fs.statSync

  try {
    Object.defineProperty(fs, 'statSync', {
      configurable: true,
      value: (targetPath: fs.PathLike) => {
        if (targetPath === outDir) throw new Error('stat failed')
        return previousStatSync(targetPath)
      },
    })

    const result = await handleRenderScene({
      output: path.join(outDir, 'out.mp4'),
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: failed to read output directory ${outDir}: stat failed`,
    )
  } finally {
    Object.defineProperty(fs, 'statSync', {
      configurable: true,
      value: previousStatSync,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports output directory creation failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-mkdir-'))
  const outDir = path.join(dir, 'exports')
  const previousMkdirSync = fs.mkdirSync

  try {
    Object.defineProperty(fs, 'mkdirSync', {
      configurable: true,
      value: (targetPath: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
        if (targetPath === outDir) throw new Error('mkdir failed')
        return previousMkdirSync(targetPath, options)
      },
    })

    const result = await handleRenderScene({
      output: path.join(outDir, 'out.mp4'),
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      'render_scene: failed to create output directory: mkdir failed',
    )
  } finally {
    Object.defineProperty(fs, 'mkdirSync', {
      configurable: true,
      value: previousMkdirSync,
    })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene normalizes padded format and quality values', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-normalize-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.webm')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const formatArg = process.argv.find((arg) => arg === '--format=webm');",
      "const qualityArg = process.argv.find((arg) => arg === '--quality=4k');",
      "const out = outArg?.slice('--out='.length);",
      "if (!out || !formatArg || !qualityArg) process.exit(2);",
      "fs.writeFileSync(out, 'ok');",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 2 }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    const result = await withEnvVar('HYPERMOTION_APP_PATH', appPath, () =>
      handleRenderScene({
        output: outputPath,
        format: ' WEBM ',
        quality: ' 4K ',
      }),
    )

    assert.equal(result.isError, undefined)
    assert.equal(
      assertToolText(result),
      `Rendered current desktop scene → ${outputPath} (webm · 4k · 30fps)`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene normalizes padded scene paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-scene-normalize-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')
  const scenePath = path.join(dir, 'scene.hype')

  fs.writeFileSync(scenePath, '')
  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const sceneArg = process.argv.find((arg) => arg.startsWith('--scene='));",
      "const out = outArg?.slice('--out='.length);",
      "const scene = sceneArg?.slice('--scene='.length);",
      `if (!out || scene !== ${JSON.stringify(scenePath)}) process.exit(2);`,
      "fs.writeFileSync(out, 'ok');",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 2 }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    const result = await withEnvVar('HYPERMOTION_APP_PATH', appPath, () =>
      handleRenderScene({
        output: outputPath,
        scene: ` ${scenePath} `,
      }),
    )

    assert.equal(result.isError, undefined)
    assert.equal(
      assertToolText(result),
      `Rendered ${scenePath} → ${outputPath} (mp4 · comp · 30fps)`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports desktop driver failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-fail-'))
  const appPath = path.join(dir, 'hyper-motion')

  try {
    fs.writeFileSync(appPath, '#!/bin/sh\nprintf "render failed\\n" >&2\nexit 2\n')
    fs.chmodSync(appPath, 0o755)

    const result = await withEnvVar('HYPERMOTION_APP_PATH', appPath, () =>
      handleRenderScene({
        output: path.join(dir, 'out.mp4'),
      }),
    )

    assert.equal(result.isError, true)
    assert.match(assertToolText(result), /^render_scene: failed: Desktop app exited with code 2/)
    assert.match(assertToolText(result), /render failed/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function schemaProperty(name: string): JsonSchemaProperty | undefined {
  return renderSceneTool.inputSchema.properties?.[name] as
    | JsonSchemaProperty
    | undefined
}
