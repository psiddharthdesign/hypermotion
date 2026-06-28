// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import { validateScene } from '../../scene/build.js'

const ValidateInput = z.object({
  scene: z.string().describe('Path to a .hype scene file.'),
})

export const validateSceneTool: Tool = {
  name: 'validate_scene',
  description: 'Validate a .hype scene for structural consistency after agent edits.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .hype scene file.' },
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

  let bytes: Buffer
  try {
    bytes = fs.readFileSync(parsed.data.scene)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `validate_scene: failed to read ${parsed.data.scene}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  try {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(validateScene(new Uint8Array(bytes)), null, 2),
        },
      ],
    }
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `validate_scene: ${parsed.data.scene} doesn't look like a valid .hype file: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
}
