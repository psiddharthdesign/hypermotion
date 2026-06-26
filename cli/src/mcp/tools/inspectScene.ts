// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import { inspectScene } from '../../scene/build.js'

const InspectInput = z.object({
  scene: z.string().describe('Path to a .hype scene file.'),
})

export const inspectSceneTool: Tool = {
  name: 'inspect_scene',
  description: 'Read a .hype file and return the full editable scene graph: meta, nodes, tracks, sections, root, active camera.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .hype scene file.' },
    },
    required: ['scene'],
  },
}

export async function handleInspectScene(args: Record<string, unknown>) {
  const parsed = InspectInput.parse(args)
  const bytes = fs.readFileSync(parsed.scene)
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(inspectScene(new Uint8Array(bytes)), null, 2),
      },
    ],
  }
}
