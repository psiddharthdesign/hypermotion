// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import { inspectScene } from '../../scene/build.js'

const InspectInput = z.object({
  scene: z.string().describe('Path to a .hype scene file.'),
})
type InspectInputData = z.infer<typeof InspectInput>

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

export async function handleInspectScene(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = InspectInput.safeParse(args)
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `inspect_scene: invalid arguments — ${parsed.error.message}`,
        },
      ],
    }
  }

  const input: InspectInputData = parsed.data
  let bytes: Buffer
  let stat: fs.Stats
  try {
    stat = fs.statSync(input.scene)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `inspect_scene: failed to read ${input.scene}: ${
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
          text: `inspect_scene: scene path is not a file: ${input.scene}`,
        },
      ],
    }
  }
  try {
    bytes = fs.readFileSync(input.scene)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `inspect_scene: failed to read ${input.scene}: ${
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
          text: JSON.stringify(inspectScene(new Uint8Array(bytes)), null, 2),
        },
      ],
    }
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `inspect_scene: failed to inspect ${input.scene}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
}
