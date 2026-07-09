// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { validateScene, type SceneValidationResult } from '../../scene/build.js'
import type { McpToolArgs } from './schema.js'

const SCENE_PATH_DESCRIPTION = 'Absolute or relative path to a .hype scene file.'
const SCENE_PATH_PROPERTY = {
  type: 'string',
  minLength: 1,
  pattern: '\\S',
  description: SCENE_PATH_DESCRIPTION,
} as const

const ValidateInput = z.object({
  scene: z.string().trim().min(1, 'scene path is required').describe(SCENE_PATH_DESCRIPTION),
}).strict()
type ValidateInputData = z.infer<typeof ValidateInput>
type ToolInputSchema = Tool['inputSchema']

export type ValidateSceneDeps = {
  statSync: (path: fs.PathLike) => fs.Stats
  readFileSync: (path: fs.PathOrFileDescriptor) => Buffer
}

const defaultDeps: ValidateSceneDeps = {
  statSync: fs.statSync,
  readFileSync: fs.readFileSync,
}

export const validateSceneTool: Tool = {
  name: 'validate_scene',
  description:
    'Validate a .hype scene for structural consistency after agent edits. Pass the path to the .hype file.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: SCENE_PATH_PROPERTY,
    },
    required: ['scene'],
    additionalProperties: false,
  } satisfies ToolInputSchema,
}

export async function handleValidateScene(
  args: McpToolArgs,
  deps: ValidateSceneDeps = defaultDeps,
): Promise<CallToolResult> {
  const parsed = ValidateInput.safeParse(args)
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `validate_scene: invalid arguments — ${parsed.error.message}`,
        },
      ],
    }
  }

  const input: ValidateInputData = parsed.data
  const trimmedScenePath = input.scene.trim()
  if (!trimmedScenePath) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'validate_scene: scene path is required' }],
    }
  }
  const scenePath = path.resolve(trimmedScenePath)
  let bytes: Buffer
  let stat: fs.Stats
  try {
    stat = deps.statSync(scenePath)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `validate_scene: failed to read ${scenePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
  if (!stat.isFile()) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `validate_scene: scene path is not a file: ${scenePath}`,
        },
      ],
    }
  }
  try {
    bytes = deps.readFileSync(scenePath)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `validate_scene: failed to read ${scenePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  try {
    const result: SceneValidationResult = validateScene(new Uint8Array(bytes))
    return {
      isError: result.ok ? undefined : true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `validate_scene: ${scenePath} doesn't look like a valid .hype file: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
}
