// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
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

export async function handleValidateScene(args: Record<string, unknown>) {
  const parsed = ValidateInput.parse(args)
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(validateScene(new Uint8Array(fs.readFileSync(parsed.scene))), null, 2),
      },
    ],
  }
}
