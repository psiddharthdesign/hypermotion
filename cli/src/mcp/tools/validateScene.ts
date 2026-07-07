// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import { validateScene, type SceneValidationResult } from '../../scene/build.js'

const ValidateInput = z.object({
  scene: z.string().trim().min(1, 'scene path is required').describe('Path to a .hype scene file.'),
})
type ValidateInputData = z.infer<typeof ValidateInput>

export const validateSceneTool: Tool = {
  name: 'validate_scene',
  description: 'Validate a .hype scene for structural consistency after agent edits.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description: 'Path to a .hype scene file.',
      },
    },
    required: ['scene'],
  },
}

export async function handleValidateScene(
  args: Record<string, unknown>,
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
  const scenePath = input.scene.trim()
  if (!scenePath) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'validate_scene: scene path is required' }],
    }
  }
  let bytes: Buffer
  let stat: fs.Stats
  try {
    stat = fs.statSync(scenePath)
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
    bytes = fs.readFileSync(scenePath)
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
