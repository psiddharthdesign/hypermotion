// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  DEFAULT_RENDER_FPS,
  RENDER_FORMATS,
  RENDER_QUALITIES,
} from '../renderOptions.js'
import { withEnvVar } from '../testUtils/env.js'
import { assertToolText } from '../testUtils/mcp.js'
import { handleRenderScene, renderSceneTool } from './tools/renderScene.js'
import type { RenderSceneDeps } from './tools/renderScene.js'

type JsonSchemaProperty = {
  readonly type?: string
  readonly enum?: readonly string[]
  readonly minLength?: number
  readonly pattern?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly description?: string
}

test('render_scene input schema exposes fps bounds', () => {
  const fpsProperty = schemaProperty('fps')

  assert.equal(fpsProperty?.type, 'integer')
  assert.equal(fpsProperty?.minimum, 1)
  assert.equal(fpsProperty?.maximum, 120)
  assert.match(String(fpsProperty?.description), /Default: 60\./)
})

test('render_scene input schema documents relative output paths', () => {
  const outputProperty = schemaProperty('output')

  assert.equal(outputProperty?.type, 'string')
  assert.equal(outputProperty?.minLength, 1)
  assert.equal(outputProperty?.pattern, '\\S')
  assert.match(String(outputProperty?.description), /relative output file path/)
})

test('render_scene input schema requires only the output path', () => {
  assert.deepEqual(renderSceneTool.inputSchema.required, ['output'])
  assert.equal(renderSceneTool.inputSchema.additionalProperties, false)
})

test('render_scene input schema exposes render preset enums', () => {
  const formatProperty = schemaProperty('format')
  const qualityProperty = schemaProperty('quality')

  assert.equal(formatProperty?.type, 'string')
  assert.equal(qualityProperty?.type, 'string')
  assert.deepEqual(formatProperty?.enum, [...RENDER_FORMATS])
  assert.deepEqual(qualityProperty?.enum, [...RENDER_QUALITIES])
})

test('render_scene input schema exposes the optional scene path', () => {
  const sceneProperty = schemaProperty('scene')

  assert.equal(sceneProperty?.type, 'string')
  assert.equal(sceneProperty?.minLength, 1)
  assert.equal(sceneProperty?.pattern, '\\S')
  assert.match(String(sceneProperty?.description), /\.hype scene file/)
  assert.match(String(sceneProperty?.description), /relative path/)
})

test('render_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleRenderScene({
    output: 'demo.mp4',
    fps: 0,
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^render_scene: invalid arguments/)
})

test('render_scene rejects unknown arguments as MCP errors', async () => {
  const result = await handleRenderScene({
    output: 'demo.mp4',
    chapter: 1,
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^render_scene: invalid arguments/)
  assert.match(assertToolText(result), /Unrecognized key/)
})

test('render_scene rejects empty output paths as MCP errors', async () => {
  const result = await handleRenderScene({
    output: '   ',
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^render_scene: invalid arguments/)
  assert.match(assertToolText(result), /output path is required/)
})

test('render_scene rejects empty scene paths as MCP errors', async () => {
  const result = await handleRenderScene({
    output: 'demo.mp4',
    scene: '   ',
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^render_scene: invalid arguments/)
  assert.match(assertToolText(result), /scene path is required/)
})

test('render_scene rejects empty format and quality values as MCP errors', async () => {
  const result = await handleRenderScene({
    output: 'demo.mp4',
    format: '   ',
    quality: '   ',
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^render_scene: invalid arguments/)
  assert.match(assertToolText(result), /Invalid enum value/)
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

  try {
    const result = await handleRenderScene(
      {
        output: path.join(dir, 'out.mp4'),
        scene: scenePath,
      },
      testDeps({
        statSync: () => {
          throw new Error('stat failed')
        },
      }),
    )

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: failed to read ${scenePath}: stat failed`,
    )
  } finally {
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

test('render_scene reports output path stat failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-file-stat-'))
  const outputPath = path.join(dir, 'out.mp4')
  fs.writeFileSync(outputPath, 'existing output')

  try {
    const result = await handleRenderScene(
      {
        output: outputPath,
      },
      testDeps({
        statSync: (targetPath: fs.PathLike) => {
          if (targetPath === outputPath) throw new Error('stat failed')
          return fs.statSync(targetPath)
        },
      }),
    )

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: failed to inspect output path ${outputPath}: stat failed`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports output directory stat failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-stat-'))
  const outDir = path.join(dir, 'exports')
  fs.mkdirSync(outDir)

  try {
    const result = await handleRenderScene(
      {
        output: path.join(outDir, 'out.mp4'),
      },
      testDeps({
        statSync: (targetPath: fs.PathLike) => {
          if (targetPath === outDir) throw new Error('stat failed')
          return fs.statSync(targetPath)
        },
      }),
    )

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: failed to read output directory ${outDir}: stat failed`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports output directory creation failures as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-mkdir-'))
  const outDir = path.join(dir, 'exports')

  try {
    const result = await handleRenderScene(
      {
        output: path.join(outDir, 'out.mp4'),
      },
      testDeps({
        mkdirSync: (targetPath: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
          if (targetPath === outDir) throw new Error('mkdir failed')
          return fs.mkdirSync(targetPath, options)
        },
      }),
    )

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: failed to create output directory ${outDir}: mkdir failed`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene reports directory output paths before locating the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-dir-'))
  const outputPath = path.join(dir, 'out.mp4')
  fs.mkdirSync(outputPath)

  try {
    const result = await handleRenderScene({
      output: outputPath,
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `render_scene: output path is a directory: ${outputPath}`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene creates missing output directories before rendering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-create-'))
  const outDir = path.join(dir, 'exports', 'nested')
  const outputPath = path.join(outDir, 'out.gif')
  let renderedOutputPath: string | null = null
  let renderedFps: number | null = null

  try {
    const result = await handleRenderScene(
      {
        output: outputPath,
      },
      testDeps({
        locateApp: async () => '/tmp/hyper-motion',
        render: async (req) => {
          renderedOutputPath = req.outputPath
          renderedFps = req.fps
        },
      }),
    )

    assert.equal(result.isError, undefined)
    assert.equal(fs.statSync(outDir).isDirectory(), true)
    assert.equal(renderedOutputPath, outputPath)
    assert.equal(DEFAULT_RENDER_FPS, 60)
    assert.equal(renderedFps, DEFAULT_RENDER_FPS)
    assert.equal(
      assertToolText(result),
      `Rendered current desktop scene → ${outputPath} (gif · comp · 60fps)`,
    )
  } finally {
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
      `Rendered current desktop scene → ${outputPath} (webm · 4k · 60fps)`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene normalizes padded output paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-output-normalize-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      `if (out !== ${JSON.stringify(outputPath)}) process.exit(2);`,
      "fs.writeFileSync(out, 'ok');",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 2 }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    const result = await withEnvVar('HYPERMOTION_APP_PATH', appPath, () =>
      handleRenderScene({
        output: ` ${outputPath} `,
      }),
    )

    assert.equal(result.isError, undefined)
    assert.equal(
      assertToolText(result),
      `Rendered current desktop scene → ${outputPath} (mp4 · comp · 60fps)`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render_scene normalizes padded scene paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-scene-normalize-'))
  const outputPath = path.join(dir, 'out.mp4')
  const scenePath = path.join(dir, 'scene.hype')
  let renderedScenePath: string | undefined

  fs.writeFileSync(scenePath, '')

  try {
    const result = await handleRenderScene(
      {
        output: outputPath,
        scene: ` ${scenePath} `,
      },
      testDeps({
        locateApp: async () => '/tmp/hyper-motion',
        render: async (req) => {
          renderedScenePath = req.scenePath
        },
      }),
    )

    assert.equal(result.isError, undefined)
    assert.equal(renderedScenePath, scenePath)
    assert.equal(
      assertToolText(result),
      `Rendered ${scenePath} → ${outputPath} (mp4 · comp · 60fps)`,
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

test('render_scene reports the releases page when the desktop app is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-missing-app-'))

  try {
    const result = await handleRenderScene(
      {
        output: path.join(dir, 'out.mp4'),
      },
      testDeps({ locateApp: async () => null }),
    )

    assert.equal(result.isError, true)
    assert.match(
      assertToolText(result),
      /^hyper-motion desktop app not found\. Install it from /,
    )
    assert.match(
      assertToolText(result),
      /https:\/\/github\.com\/psiddharthdesign\/hypermotion\/releases/,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function schemaProperty(name: string): JsonSchemaProperty | undefined {
  return renderSceneTool.inputSchema.properties?.[name] as
    | JsonSchemaProperty
    | undefined
}

function testDeps(overrides: Partial<RenderSceneDeps>): RenderSceneDeps {
  return {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    mkdirSync: fs.mkdirSync,
    locateApp: async () => null,
    render: async () => {},
    ...overrides,
  }
}
