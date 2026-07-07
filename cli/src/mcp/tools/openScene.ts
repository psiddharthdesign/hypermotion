// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import fs from 'node:fs'
import path from 'node:path'
import { pushSceneToRunningApp } from '../../electron/live.js'

const OpenInput = z.object({
  scene: z.string().min(1).describe('Absolute or relative path to a .hype scene file.'),
})
type OpenInputData = z.infer<typeof OpenInput>
type OpenSceneDeps = {
  existsSync: typeof fs.existsSync
  statSync: typeof fs.statSync
  openScene: typeof pushSceneToRunningApp
}

const defaultDeps: OpenSceneDeps = {
  existsSync: fs.existsSync,
  statSync: fs.statSync,
  openScene: pushSceneToRunningApp,
}

export const openSceneTool: Tool = {
  name: 'open_scene',
  description: 'Open a .hype scene file in the hyper-motion desktop app.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description: 'Absolute or relative path to a .hype scene file.',
      },
    },
    required: ['scene'],
  },
}

export async function handleOpenScene(
  args: Record<string, unknown>,
  deps: OpenSceneDeps = defaultDeps,
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

  const input: OpenInputData = parsed.data
  const trimmedScene = input.scene.trim()
  if (!trimmedScene) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'open_scene: scene path is required' }],
    }
  }

  const scenePath = path.resolve(trimmedScene)
  if (!deps.existsSync(scenePath)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `open_scene: scene file not found: ${scenePath}` }],
    }
  }
  let stats: fs.Stats
  try {
    stats = deps.statSync(scenePath)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `open_scene: failed to read ${scenePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
  if (!stats.isFile()) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `open_scene: scene path is not a file: ${scenePath}` }],
    }
  }
  let opened: boolean
  try {
    opened = await deps.openScene(scenePath)
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `open_scene: failed to open ${scenePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }
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
