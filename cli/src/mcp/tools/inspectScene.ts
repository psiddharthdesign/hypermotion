// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { inspectScene } from '../../scene/build.js'

const InspectInput = z.object({
  scene: z.string().trim().min(1, 'scene path is required').describe('Path to a .hype scene file.'),
})
type InspectInputData = z.infer<typeof InspectInput>

export const inspectSceneTool: Tool = {
  name: 'inspect_scene',
  description: 'Read a .hype file and return the full editable scene graph: meta, nodes, tracks, sections, root, active camera.',
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
  const trimmedScene = input.scene.trim()
  if (!trimmedScene) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'inspect_scene: scene path is required' }],
    }
  }

  const scenePath = path.resolve(trimmedScene)
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
          text: `inspect_scene: failed to read ${scenePath}: ${
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
          text: `inspect_scene: scene path is not a file: ${scenePath}`,
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
          text: `inspect_scene: failed to read ${scenePath}: ${
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
          text: `inspect_scene: failed to inspect ${scenePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
}
