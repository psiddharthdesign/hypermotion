// SPDX-License-Identifier: Apache-2.0

/**
 * `info_scene` MCP tool.
 *
 * v0.1.0 status: returns a "not yet implemented" message. The
 * `.arnimotion` file format ships in v0.1.1 alongside the desktop app's
 * File → Save / Open, after which this tool reads scene metadata from
 * disk (canvas, duration, layer / track / chapter counts).
 *
 * The tool stays registered today so agents can discover its shape and
 * the planned roadmap — they get a clean structured error instead of an
 * "unknown tool" response.
 */

import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

const InfoInput = z.object({
  scene: z.string().describe('Path to a .arnimotion scene file (v0.1.1)'),
})

export const infoSceneTool: Tool = {
  name: 'info_scene',
  description:
    'Read a hyper-motion .arnimotion scene file and return a structured ' +
    'summary (canvas, duration, frame rate, layer count, track count, ' +
    'chapter count). Status: deferred to v0.1.1 — the .arnimotion file ' +
    'format ships then. Today the tool returns a structured "not yet" error.',
  inputSchema: {
    type: 'object',
    properties: {
      scene: { type: 'string', description: 'Path to a .arnimotion scene file (v0.1.1)' },
    },
    required: ['scene'],
  },
}

export async function handleInfoScene(args: Record<string, unknown>) {
  // Validate input shape so agents get a real error if they pass the
  // wrong fields, rather than an opaque "not yet" message.
  InfoInput.parse(args)

  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text:
          'info_scene is not yet implemented in v0.1.0. The .arnimotion ' +
          'file format and File → Save / Open in the desktop app ship in ' +
          'v0.1.1, after which this tool will read scene metadata. For now, ' +
          'use the render_scene tool to render the current desktop scene.',
      },
    ],
  }
}
