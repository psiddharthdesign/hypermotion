// SPDX-License-Identifier: Apache-2.0

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { NODE_KINDS, PATCH_OPERATION_TYPES, PROPERTY_IDS } from '../../scene/build.js'
import { RENDER_FORMATS, RENDER_QUALITIES } from '../../renderOptions.js'
import {
  EMPTY_OBJECT_INPUT_SCHEMA,
  rejectUnexpectedEmptyArgs,
  type McpToolArgs,
} from './schema.js'

export const MCP_TOOLS = [
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
  'list_scenes',
  'get_sequence',
  'open_scene',
  'render_scene',
  'list_keyframeable_properties',
] as const
export type McpToolName = (typeof MCP_TOOLS)[number]

export const VALIDATION_TOOLS = ['validate_scene'] as const satisfies readonly McpToolName[]
export type ValidationToolName = (typeof VALIDATION_TOOLS)[number]
export const QUERY_TOOLS = [
  'list_layers',
  'get_layer',
  'list_tracks',
  'list_cameras',
  'list_scenes',
  'get_sequence',
] as const satisfies readonly McpToolName[]
export type QueryToolName = (typeof QUERY_TOOLS)[number]

type CapabilitiesPayload = {
  readonly sceneExtension: '.hype'
  readonly mcpTools: readonly McpToolName[]
  readonly nodeKinds: typeof NODE_KINDS
  readonly patchOperations: typeof PATCH_OPERATION_TYPES
  readonly validation: {
    readonly structuralSceneValidation: boolean
  }
  readonly cameraSupport: {
    readonly multipleCameras: boolean
    readonly explicitOwnership: boolean
    readonly defaultCamera: boolean
    readonly timedHardCuts: boolean
  }
  readonly sequenceSupport: {
    readonly schemaVersion: 2
    readonly multipleScenes: boolean
    readonly reusableSceneOccurrences: boolean
    readonly compositionWorkAreas: boolean
    readonly occurrenceTrimming: boolean
    readonly occurrenceMasterAudioMute: boolean
    readonly transitionWeightedMasterAudioMute: boolean
    readonly masterOwnedSoundtracks: boolean
    readonly sceneAudioOverlays: boolean
    readonly translatedSceneMasterAudio: boolean
    readonly sceneExportMasterAudioParity: boolean
    readonly projectedSceneBeatGuides: boolean
    readonly transitions: readonly ['cut', 'crossfade']
    readonly frameAlignedMasterTimeline: boolean
  }
  readonly validationTools: typeof VALIDATION_TOOLS
  readonly queryTools: typeof QUERY_TOOLS
  readonly renderFormats: typeof RENDER_FORMATS
  readonly renderQualities: typeof RENDER_QUALITIES
  readonly renderFileSceneInput: boolean
  readonly keyframeableProperties: typeof PROPERTY_IDS
}

type KeyframeablePropertiesPayload = {
  readonly keyframeableProperties: typeof PROPERTY_IDS
}

type CapabilityToolPayload = CapabilitiesPayload | KeyframeablePropertiesPayload

export const getCapabilitiesTool: Tool = {
  name: 'get_capabilities',
  description:
    'Return supported scene node kinds, multi-camera/cut features, multi-scene sequence features, patch operations, render formats/qualities, saved-scene render support, validation/query tools, and keyframeable properties.',
  inputSchema: EMPTY_OBJECT_INPUT_SCHEMA,
}

export const listKeyframeablePropertiesTool: Tool = {
  name: 'list_keyframeable_properties',
  description: 'Return property ids that can be animated with tracks/keyframes.',
  inputSchema: EMPTY_OBJECT_INPUT_SCHEMA,
}

export async function handleGetCapabilities(args: McpToolArgs = {}): Promise<CallToolResult> {
  const invalidArgsMessage = rejectUnexpectedEmptyArgs('get_capabilities', args)
  if (invalidArgsMessage !== null) return text(invalidArgsMessage, true)

  const payload: CapabilitiesPayload = {
    sceneExtension: '.hype',
    mcpTools: MCP_TOOLS,
    nodeKinds: NODE_KINDS,
    patchOperations: PATCH_OPERATION_TYPES,
    validation: {
      structuralSceneValidation: true,
    },
    cameraSupport: {
      multipleCameras: true,
      explicitOwnership: true,
      defaultCamera: true,
      timedHardCuts: true,
    },
    sequenceSupport: {
      schemaVersion: 2,
      multipleScenes: true,
      reusableSceneOccurrences: true,
      compositionWorkAreas: true,
      occurrenceTrimming: true,
      occurrenceMasterAudioMute: true,
      transitionWeightedMasterAudioMute: true,
      masterOwnedSoundtracks: true,
      sceneAudioOverlays: true,
      translatedSceneMasterAudio: true,
      sceneExportMasterAudioParity: true,
      projectedSceneBeatGuides: true,
      transitions: ['cut', 'crossfade'],
      frameAlignedMasterTimeline: true,
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

export async function handleListKeyframeableProperties(
  args: McpToolArgs = {},
): Promise<CallToolResult> {
  const invalidArgsMessage = rejectUnexpectedEmptyArgs('list_keyframeable_properties', args)
  if (invalidArgsMessage !== null) return text(invalidArgsMessage, true)

  const payload: KeyframeablePropertiesPayload = {
    keyframeableProperties: PROPERTY_IDS,
  }

  return text(payload)
}

function text(value: CapabilityToolPayload | string, isError?: boolean): CallToolResult {
  return {
    isError,
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}
