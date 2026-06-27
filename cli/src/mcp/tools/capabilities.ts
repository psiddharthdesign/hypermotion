// SPDX-License-Identifier: Apache-2.0

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { PROPERTY_IDS } from '../../scene/build.js'

type McpTextResult = {
  content: Array<{ type: 'text'; text: string }>
}

type CapabilitiesPayload = {
  sceneExtension: '.hype'
  nodeKinds: string[]
  patchOperations: string[]
  validation: {
    structuralSceneValidation: boolean
  }
  queryTools: string[]
  renderFormats: Array<'mp4' | 'webm' | 'gif'>
  renderQualities: Array<'comp' | '720p' | '2k' | '4k'>
  keyframeableProperties: readonly string[]
}

type KeyframeablePropertiesPayload = {
  keyframeableProperties: readonly string[]
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

export async function handleGetCapabilities(): Promise<McpTextResult> {
  const payload: CapabilitiesPayload = {
    sceneExtension: '.hype',
    nodeKinds: ['frame', 'rect', 'ellipse', 'text', 'image', 'video', 'audio', 'component', 'instance', 'camera'],
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

export async function handleListKeyframeableProperties(): Promise<McpTextResult> {
  const payload: KeyframeablePropertiesPayload = { keyframeableProperties: PROPERTY_IDS }
  return text(payload)
}

function text(value: unknown): McpTextResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  }
}
