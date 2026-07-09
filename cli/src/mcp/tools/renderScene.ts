// SPDX-License-Identifier: Apache-2.0

/**
 * `render_scene` MCP tool.
 *
 * Renders the user's current desktop scene to MP4 / WebM / GIF by
 * driving the installed desktop app. A .hype scene path renders that saved
 * scene instead of the current desktop scene.
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
import {
  RENDER_FORMATS,
  RENDER_QUALITIES,
  inferRenderFormatFromPath,
} from '../../renderOptions.js'
import type { RenderFormat, RenderQuality } from '../../renderOptions.js'
import type { McpToolArgs } from './schema.js'

const RenderInput = z.object({
  output: z
    .string()
    .trim()
    .min(1, 'output path is required')
    .describe('Absolute or relative path where the rendered file should be written'),
  format: z
    .preprocess(normalizeStringOption, z.enum(RENDER_FORMATS))
    .optional()
    .describe('Output format. Defaults to inferred from the output file extension.'),
  quality: z
    .preprocess(normalizeStringOption, z.enum(RENDER_QUALITIES))
    .optional()
    .describe('Output resolution preset. `comp` matches the scene canvas size (fastest). Default: comp.'),
  fps: z.number().int().positive().max(120).optional().describe('Frame rate. Default: 30.'),
  scene: z
    .string()
    .trim()
    .min(1, 'scene path is required')
    .optional()
    .describe(
      'Path to a .hype scene file to render instead of the current desktop scene.',
    ),
}).strict()
type RenderInputData = z.infer<typeof RenderInput>
type StringSchemaProperty = {
  readonly type: 'string'
  readonly minLength?: number
  readonly pattern?: string
  readonly description: string
}
type EnumStringSchemaProperty<Value extends string> = StringSchemaProperty & {
  readonly enum: readonly Value[]
}
type IntegerSchemaProperty = {
  readonly type: 'integer'
  readonly minimum: number
  readonly maximum: number
  readonly description: string
}
export type RenderSceneDeps = {
  existsSync: typeof fs.existsSync
  statSync: (path: fs.PathLike) => fs.Stats
  mkdirSync: (
    path: fs.PathLike,
    options?: fs.MakeDirectoryOptions,
  ) => string | undefined | void
  locateApp: typeof locateDesktopApp
  render: typeof driveHeadlessRender
}

const defaultDeps: RenderSceneDeps = {
  existsSync: fs.existsSync,
  statSync: fs.statSync,
  mkdirSync: fs.mkdirSync,
  locateApp: locateDesktopApp,
  render: driveHeadlessRender,
}

const OUTPUT_PATH_PROPERTY: StringSchemaProperty = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
  description: 'Absolute or relative output file path.',
}

const FORMAT_PROPERTY: EnumStringSchemaProperty<RenderFormat> = {
  type: 'string',
  enum: RENDER_FORMATS,
  description: 'Output format. Defaults to inferred from the output extension.',
}

const QUALITY_PROPERTY: EnumStringSchemaProperty<RenderQuality> = {
  type: 'string',
  enum: RENDER_QUALITIES,
  description: 'Resolution preset. `comp` matches scene canvas size. Default: comp.',
}

const FPS_PROPERTY: IntegerSchemaProperty = {
  type: 'integer',
  minimum: 1,
  maximum: 120,
  description: 'Frame rate (1–120). Default: 30.',
}

const SCENE_PATH_PROPERTY: StringSchemaProperty = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
  description:
    'Absolute or relative path to a .hype scene file to render instead of the current desktop scene.',
}

function normalizeStringOption(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value
}

export const renderSceneTool: Tool = {
  name: 'render_scene',
  description:
    'Render the current scene loaded in the desktop app to MP4, WebM, or GIF. ' +
    'A `scene` path renders a saved .hype file instead. Drives the installed ' +
    'desktop app under the hood.',
  inputSchema: {
    type: 'object',
    properties: {
      output: OUTPUT_PATH_PROPERTY,
      format: FORMAT_PROPERTY,
      quality: QUALITY_PROPERTY,
      fps: FPS_PROPERTY,
      scene: SCENE_PATH_PROPERTY,
    },
    required: ['output'],
    additionalProperties: false,
  },
}

export async function handleRenderScene(
  args: McpToolArgs,
  deps: RenderSceneDeps = defaultDeps,
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

  const input: RenderInputData = parsed.data
  const outputPath = path.resolve(input.output)
  const sceneInput = input.scene
  const scenePath = sceneInput ? path.resolve(sceneInput) : undefined
  const format = input.format ?? inferRenderFormatFromPath(outputPath)
  const quality = input.quality ?? 'comp'
  const fps = input.fps ?? 30

  if (scenePath && !deps.existsSync(scenePath)) {
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
  if (scenePath) {
    let stats: fs.Stats
    try {
      stats = deps.statSync(scenePath)
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `render_scene: failed to read ${scenePath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      }
    }
    if (!stats.isFile()) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `render_scene: scene path is not a file: ${scenePath}`,
          },
        ],
      }
    }
  }

  const outDir = path.dirname(outputPath)
  if (deps.existsSync(outputPath)) {
    let stats: fs.Stats
    try {
      stats = deps.statSync(outputPath)
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `render_scene: failed to inspect output path ${outputPath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      }
    }
    if (stats.isDirectory()) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `render_scene: output path is a directory: ${outputPath}`,
          },
        ],
      }
    }
  }

  if (deps.existsSync(outDir)) {
    let stats: fs.Stats
    try {
      stats = deps.statSync(outDir)
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `render_scene: failed to read output directory ${outDir}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      }
    }
    if (!stats.isDirectory()) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `render_scene: output directory is not a directory: ${outDir}`,
          },
        ],
      }
    }
  }

  if (!deps.existsSync(outDir)) {
    try {
      deps.mkdirSync(outDir, { recursive: true })
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `render_scene: failed to create output directory ${outDir}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      }
    }
  }

  const appPath = await deps.locateApp()
  if (!appPath) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text:
            'hyper-motion desktop app not found. Install it from ' +
            'https://github.com/psiddharthdesign/hypermotion/releases and try again.',
        },
      ],
    }
  }

  try {
    await deps.render({
      appPath,
      outputPath,
      format,
      quality,
      fps,
      scenePath,
    })
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `render_scene: failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `Rendered ${scenePath ?? 'current desktop scene'} → ${outputPath} (${format} · ${quality} · ${fps}fps)`,
      },
    ],
  }
}
