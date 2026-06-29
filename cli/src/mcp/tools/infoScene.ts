// SPDX-License-Identifier: Apache-2.0

/**
 * `info_scene` MCP tool — read a `.hype` file and return a structured
 * summary (canvas, duration, frame rate, layer/track/section/keyframe
 * counts). Used by AI agents to inspect a scene before deciding what
 * to render or modify.
 */

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import { readSceneSummary, type SceneSummary } from '../../scene/build.js'

const InfoInput = z.object({
  scene: z.string().describe('Path to a .hype scene file'),
})
type InfoInputData = z.infer<typeof InfoInput>

export const infoSceneTool: Tool = {
  name: 'info_scene',
  description:
    'Read a hyper-motion .hype scene file and return a structured summary ' +
    '(canvas size, duration, frame rate, layer count, track count, section ' +
    'count, keyframe count). Pass the absolute path to the .hype file.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .hype scene file' },
    },
    required: ['scene'],
  },
}

export async function handleInfoScene(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = InfoInput.safeParse(args)
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `info_scene: invalid arguments — ${parsed.error.message}`,
        },
      ],
    }
  }

  const input: InfoInputData = parsed.data
  const scenePath = input.scene
  let bytes: Buffer
  try {
    bytes = fs.readFileSync(scenePath)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `info_scene: failed to read ${scenePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  let summary: SceneSummary
  try {
    summary = readSceneSummary(new Uint8Array(bytes))
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `info_scene: ${scenePath} is not a valid .hype file: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  // Return the summary as JSON text so MCP clients can either display
  // it directly or parse it before deciding what to render next.
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(summary, null, 2),
      },
    ],
  }
}
