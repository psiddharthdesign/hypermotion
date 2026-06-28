// SPDX-License-Identifier: Apache-2.0

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { NODE_KINDS, PATCH_OPERATION_TYPES, PROPERTY_IDS } from '../../scene/build.js'

const VALIDATION_TOOLS = ['validate_scene'] as const
const QUERY_TOOLS = ['list_layers', 'get_layer', 'list_tracks', 'list_cameras'] as const
const MCP_TOOLS = [
  'doctor',
  'get_capabilities',
  'create_scene',
  'info_scene',
  'inspect_scene',
  'patch_scene',
  'validate_scene',
  'list_layers',
  'get_layer',
  'list_tracks',
  'list_cameras',
  'open_scene',
  'render_scene',
  'list_keyframeable_properties',
] as const
const RENDER_FORMATS = ['mp4', 'webm', 'gif'] as const
const RENDER_QUALITIES = ['comp', '720p', '2k', '4k'] as const

type CapabilitiesPayload = {
  sceneExtension: '.hype'
  mcpTools: typeof MCP_TOOLS
  nodeKinds: typeof NODE_KINDS
  patchOperations: typeof PATCH_OPERATION_TYPES
  validation: {
    structuralSceneValidation: boolean
  }
  validationTools: typeof VALIDATION_TOOLS
  queryTools: typeof QUERY_TOOLS
  renderFormats: typeof RENDER_FORMATS
  renderQualities: typeof RENDER_QUALITIES
  renderFileSceneInput: boolean
  keyframeableProperties: typeof PROPERTY_IDS
}

type KeyframeablePropertiesPayload = {
  keyframeableProperties: typeof PROPERTY_IDS
}

export const getCapabilitiesTool: Tool = {
  name: 'get_capabilities',
  description: 'Return supported scene node kinds, patch operations, render formats, and keyframeable properties.',
  inputSchema: { type: 'object', properties: {} },
}

export const listKeyframeablePropertiesTool: Tool = {
  name: 'list_keyframeable_properties',
  description: 'Return property ids that can be animated with tracks/keyframes.',
  inputSchema: { type: 'object', properties: {} },
}

export async function handleGetCapabilities(): Promise<CallToolResult> {
  const payload: CapabilitiesPayload = {
    sceneExtension: '.hype',
    mcpTools: MCP_TOOLS,
    nodeKinds: NODE_KINDS,
    patchOperations: PATCH_OPERATION_TYPES,
    validation: {
      structuralSceneValidation: true,
    },
    validationTools: VALIDATION_TOOLS,
    queryTools: QUERY_TOOLS,
    renderFormats: RENDER_FORMATS,
    renderQualities: RENDER_QUALITIES,
    renderFileSceneInput: true,
    keyframeableProperties: PROPERTY_IDS,
  }

  return text(payload)
}

export async function handleListKeyframeableProperties(): Promise<CallToolResult> {
  const payload: KeyframeablePropertiesPayload = {
    keyframeableProperties: PROPERTY_IDS,
  }

  return text(payload)
}

function text(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}
