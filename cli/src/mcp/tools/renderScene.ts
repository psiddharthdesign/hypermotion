// SPDX-License-Identifier: Apache-2.0

/**
 * `render_scene` MCP tool.
 *
 * Renders the user's current desktop scene to MP4 / WebM / GIF by
 * driving the installed desktop app. A .hype scene path is accepted and
 * forwarded to desktop builds that support file-based rendering.
 *
 * Returns the absolute output path on success, or a descriptive error
 * if the app isn't installed or the render fails.
 */

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
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
      'Path to a .hype scene file. Forwarded to compatible desktop builds for file-based rendering.',
    ),
})

export const renderSceneTool: Tool = {
  name: 'render_scene',
  description:
    'Render the current scene loaded in the desktop app to MP4, WebM, or GIF. ' +
    'A `scene` path is forwarded to compatible desktop builds for file-based ' +
    'rendering. Drives the installed desktop app under the hood.',
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
      fps: {
        type: 'integer',
        minimum: 1,
        maximum: 120,
        description: 'Frame rate (1–120). Default: 30.',
      },
      scene: {
        type: 'string',
        description:
          'Path to a .hype scene file. Forwarded to compatible desktop builds for file-based rendering.',
      },
    },
    required: ['output'],
  },
}

export async function handleRenderScene(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = RenderInput.safeParse(args)
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `render_scene: invalid arguments — ${parsed.error.message}`,
        },
      ],
    }
  }

  const outputPath = path.resolve(parsed.data.output)
  const scenePath = parsed.data.scene ? path.resolve(parsed.data.scene) : undefined
  const format = parsed.data.format ?? inferFormat(outputPath)
  const quality = parsed.data.quality ?? 'comp'
  const fps = parsed.data.fps ?? 30

  if (scenePath && !fs.existsSync(scenePath)) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `render_scene: scene file not found: ${scenePath}`,
        },
      ],
    }
  }

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
    scenePath,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: `Rendered ${scenePath ?? 'current desktop scene'} → ${outputPath} (${format} · ${quality} · ${fps}fps)`,
      },
    ],
  }
}

function inferFormat(outPath: string): 'mp4' | 'webm' | 'gif' {
  const ext = path.extname(outPath).toLowerCase().slice(1)
  if (ext === 'mp4' || ext === 'webm' || ext === 'gif') return ext
  return 'mp4'
}
