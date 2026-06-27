// SPDX-License-Identifier: Apache-2.0

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { NODE_KINDS, PROPERTY_IDS } from '../../scene/build.js'

type CapabilitiesPayload = {
  sceneExtension: '.hype'
  nodeKinds: typeof NODE_KINDS
  patchOperations: string[]
  validation: {
    structuralSceneValidation: boolean
  }
  queryTools: string[]
  renderFormats: string[]
  renderQualities: string[]
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
    nodeKinds: NODE_KINDS,
    patchOperations: [
      'setMeta',
      'setRoot',
      'setActiveCameraId',
      'createNode',
      'deleteNode',
      'setNode',
      'setNodeProperty',
      'appendChild',
      'moveChild',
      'setTrack',
      'deleteTrack',
      'setSection',
      'deleteSection',
    ],
    validation: {
      structuralSceneValidation: true,
    },
    queryTools: ['list_layers', 'get_layer', 'list_tracks', 'list_cameras'],
    renderFormats: ['mp4', 'webm', 'gif'],
    renderQualities: ['comp', '720p', '2k', '4k'],
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
