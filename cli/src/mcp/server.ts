// SPDX-License-Identifier: Apache-2.0

/**
 * MCP server entry point. Speaks the Model Context Protocol over stdio so
 * AI coding agents (Claude Code, Codex, anything that consumes MCP) can
 * drive hyper-motion programmatically.
 *
 * Registered tools are declared in `TOOLS` below. They cover scene
 * authoring, inspection, patching, validation, querying, opening, rendering,
 * and capability discovery.
 *
 * The server is launched via `hypermotion serve --mcp` or the
 * `hypermotion-mcp` shim binary.
 *
 * To wire into Claude Code, the user runs:
 *
 *   claude mcp add -s user hypermotion -- hypermotion-mcp
 *
 * If the desktop app is installed somewhere non-standard, include
 * HYPERMOTION_APP_PATH in the registration environment.
 *
 * To wire into Codex CLI, they add to ~/.codex/config.toml:
 *
 *   [mcp_servers.hypermotion]
 *   command = "hypermotion-mcp"
 *
 *   [mcp_servers.hypermotion.env]
 *   HYPERMOTION_APP_PATH = "/Applications/hyper-motion.app/Contents/MacOS/hyper-motion"
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { handleRenderScene, renderSceneTool } from './tools/renderScene.js'
import { handleInfoScene, infoSceneTool } from './tools/infoScene.js'
import { handleCreateScene, createSceneTool } from './tools/createScene.js'
import { doctorTool, handleDoctor } from './tools/doctor.js'
import {
  getCapabilitiesTool,
  handleGetCapabilities,
  handleListKeyframeableProperties,
  listKeyframeablePropertiesTool,
} from './tools/capabilities.js'
import { handleInspectScene, inspectSceneTool } from './tools/inspectScene.js'
import { handlePatchScene, patchSceneTool } from './tools/patchScene.js'
import { handleOpenScene, openSceneTool } from './tools/openScene.js'
import { handleValidateScene, validateSceneTool } from './tools/validateScene.js'
import {
  getLayerTool,
  handleGetLayer,
  handleListCameras,
  handleListLayers,
  handleListTracks,
  listCamerasTool,
  listLayersTool,
  listTracksTool,
} from './tools/queryScene.js'
import { CLI_VERSION } from '../version.js'

const SERVER_NAME = 'hypermotion'

function textToolResult(text: string, isError?: boolean): CallToolResult {
  return {
    isError,
    content: [{ type: 'text', text }],
  }
}

export const TOOLS = [
  doctorTool,
  getCapabilitiesTool,
  createSceneTool,
  infoSceneTool,
  inspectSceneTool,
  patchSceneTool,
  validateSceneTool,
  listLayersTool,
  getLayerTool,
  listTracksTool,
  listCamerasTool,
  openSceneTool,
  renderSceneTool,
  listKeyframeablePropertiesTool,
] as const satisfies readonly Tool[]

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: CLI_VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    try {
      switch (name) {
        case 'doctor':
          return await handleDoctor(args ?? {})
        case 'get_capabilities':
          return await handleGetCapabilities(args ?? {})
        case 'render_scene':
          return await handleRenderScene(args ?? {})
        case 'info_scene':
          return await handleInfoScene(args ?? {})
        case 'create_scene':
          return await handleCreateScene(args ?? {})
        case 'inspect_scene':
          return await handleInspectScene(args ?? {})
        case 'patch_scene':
          return await handlePatchScene(args ?? {})
        case 'validate_scene':
          return await handleValidateScene(args ?? {})
        case 'list_layers':
          return await handleListLayers(args ?? {})
        case 'get_layer':
          return await handleGetLayer(args ?? {})
        case 'list_tracks':
          return await handleListTracks(args ?? {})
        case 'list_cameras':
          return await handleListCameras(args ?? {})
        case 'open_scene':
          return await handleOpenScene(args ?? {})
        case 'list_keyframeable_properties':
          return await handleListKeyframeableProperties(args ?? {})
        default:
          return textToolResult(`Unknown tool: ${name}`, true)
      }
    } catch (err) {
      return textToolResult(
        `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        true,
      )
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)

  // stderr is fine — MCP uses stdout for protocol traffic, stderr for logs.
  console.error(`[hypermotion-mcp] connected (${SERVER_NAME} ${CLI_VERSION}, ${TOOLS.length} tools)`)
}
