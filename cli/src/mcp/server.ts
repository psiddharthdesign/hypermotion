// SPDX-License-Identifier: Apache-2.0

/**
 * MCP server entry point. Speaks the Model Context Protocol over stdio so
 * AI coding agents (Claude Code, Codex, anything that consumes MCP) can
 * drive hyper-motion programmatically.
 *
 * Registered tools:
 *
 *   - `render_scene` — render the current desktop scene to MP4 / WebM / GIF.
 *                      Internally shells out to the installed desktop app.
 *   - `info_scene`   — read a scene file, return metadata (canvas size,
 *                      duration, layer count, track count).
 *
 * The server is launched via `hypermotion serve --mcp` or the
 * `hypermotion-mcp` shim binary.
 *
 * To wire into Claude Code, the user runs:
 *
 *   claude mcp add hypermotion -- hypermotion-mcp
 *
 * To wire into Codex CLI, they add to ~/.codex/config.toml:
 *
 *   [mcp_servers.hypermotion]
 *   command = "hypermotion-mcp"
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { handleRenderScene, renderSceneTool } from './tools/renderScene.js'
import { handleInfoScene, infoSceneTool } from './tools/infoScene.js'
import { handleCreateScene, createSceneTool } from './tools/createScene.js'

const SERVER_NAME = 'hypermotion'
const SERVER_VERSION = '0.1.2'

const TOOLS: Tool[] = [createSceneTool, renderSceneTool, infoSceneTool]

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    try {
      switch (name) {
        case 'render_scene':
          return await handleRenderScene(args ?? {})
        case 'info_scene':
          return await handleInfoScene(args ?? {})
        case 'create_scene':
          return await handleCreateScene(args ?? {})
        default:
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          }
      }
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)

  // stderr is fine — MCP uses stdout for protocol traffic, stderr for logs.
  console.error(`[hypermotion-mcp] connected (${SERVER_NAME} ${SERVER_VERSION}, ${TOOLS.length} tools)`)
}
