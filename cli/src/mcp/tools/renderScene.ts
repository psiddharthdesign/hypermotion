// SPDX-License-Identifier: Apache-2.0

/**
 * `render_scene` MCP tool.
 *
 * Renders the user's CURRENT hyper-motion scene (whatever was last
 * persisted to IndexedDB by the desktop app) to MP4 / WebM / GIF by
 * driving the installed desktop app. `scene` is accepted for forward
 * compatibility with file-based rendering, but is ignored today.
 *
 * Returns the absolute output path on success, or a descriptive error
 * if the app isn't installed or the render fails.
 */

import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import path from 'node:path'
import fs from 'node:fs'
import { locateDesktopApp } from '../../electron/locator.js'
import { driveHeadlessRender } from '../../electron/driver.js'

const RenderInput = z.object({
  output: z.string().describe('Absolute or relative path where the rendered file should be written'),
  format: z
    .enum(['mp4', 'webm', 'gif'])
    .optional()
    .describe('Output format. Defaults to inferred from the output file extension.'),
  quality: z
    .enum(['comp', '720p', '2k', '4k'])
    .optional()
    .describe('Output resolution preset. `comp` matches the scene canvas size (fastest). Default: comp.'),
  fps: z.number().int().positive().max(120).optional().describe('Frame rate. Default: 30.'),
  scene: z
    .string()
    .optional()
    .describe(
      'Path to a .hype scene file. Reserved for file-based headless rendering; ' +
        'currently ignored — the desktop app\'s current scene is rendered.',
    ),
})

export const renderSceneTool: Tool = {
  name: 'render_scene',
  description:
    "Render the user's current hyper-motion scene (whatever's loaded in " +
    'the desktop app right now) to MP4, WebM, or GIF. Drives the installed ' +
    'desktop app under the hood — returns a clean error if the app is not ' +
    'installed. The optional `scene` path is reserved for future file-based ' +
    'rendering and is ignored today.',
  inputSchema: {
    type: 'object',
    properties: {
      output: { type: 'string', description: 'Output file path' },
      format: {
        type: 'string',
        enum: ['mp4', 'webm', 'gif'],
        description: 'Output format. Defaults to inferred from the output extension.',
      },
      quality: {
        type: 'string',
        enum: ['comp', '720p', '2k', '4k'],
        description: 'Resolution preset. `comp` matches scene canvas size. Default: comp.',
      },
      fps: { type: 'number', description: 'Frame rate (1–120). Default: 30.' },
      scene: {
        type: 'string',
        description: 'Path to a .hype file (reserved for file-based headless rendering; ignored today).',
      },
    },
    required: ['output'],
  },
}

export async function handleRenderScene(args: Record<string, unknown>) {
  const parsed = RenderInput.parse(args)

  const outputPath = path.resolve(parsed.output)
  const format = parsed.format ?? inferFormat(outputPath)
  const quality = parsed.quality ?? 'comp'
  const fps = parsed.fps ?? 30

  const appPath = await locateDesktopApp()
  if (!appPath) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text:
            'hyper-motion desktop app not found. Install it from ' +
            'https://hypermotion.app and try again.',
        },
      ],
    }
  }

  const outDir = path.dirname(outputPath)
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  await driveHeadlessRender({
    appPath,
    outputPath,
    format,
    quality,
    fps,
    scenePath: parsed.scene,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text:
          `Rendered current desktop scene → ${outputPath} (${format} · ${quality} · ${fps}fps)` +
          (parsed.scene ? `\nNote: ignored scene path ${parsed.scene}` : ''),
      },
    ],
  }
}

function inferFormat(outPath: string): 'mp4' | 'webm' | 'gif' {
  const ext = path.extname(outPath).toLowerCase().slice(1)
  if (ext === 'mp4' || ext === 'webm' || ext === 'gif') return ext
  return 'mp4'
}
