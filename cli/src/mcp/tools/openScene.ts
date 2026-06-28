// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { pushSceneToRunningApp } from '../../electron/live.js'

const OpenInput = z.object({
  scene: z.string().describe('Path to a .hype scene file.'),
})

export const openSceneTool: Tool = {
  name: 'open_scene',
  description: 'Open a .hype scene file in the hyper-motion desktop app.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .hype scene file.' },
    },
    required: ['scene'],
  },
}

export async function handleOpenScene(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = OpenInput.safeParse(args)
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `open_scene: invalid arguments — ${parsed.error.message}`,
        },
      ],
    }
  }

  const scenePath = path.resolve(parsed.data.scene)
  if (!fs.existsSync(scenePath)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Scene file not found: ${scenePath}` }],
    }
  }
  if (!fs.statSync(scenePath).isFile()) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Scene path is not a file: ${scenePath}` }],
    }
  }
  const opened = await pushSceneToRunningApp(scenePath)
  if (!opened) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'hyper-motion desktop app not found.' }],
    }
  }
  return {
    content: [{ type: 'text' as const, text: `Opened ${scenePath}` }],
  }
}
