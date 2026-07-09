// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  handleGetCapabilities,
  handleListKeyframeableProperties,
  MCP_TOOLS,
  QUERY_TOOLS,
  VALIDATION_TOOLS,
  type McpToolName,
  type QueryToolName,
  type ValidationToolName,
} from './tools/capabilities.js'
import { TOOLS } from './server.js'
import {
  NODE_KINDS,
  PATCH_OPERATION_TYPES,
  PROPERTY_IDS,
  type NodeKindJson,
  type PatchOperation,
  type PropertyIdJson,
} from '../scene/build.js'
import {
  RENDER_FORMATS,
  RENDER_QUALITIES,
  type RenderFormat,
  type RenderQuality,
} from '../renderOptions.js'
import { assertToolText } from '../testUtils/mcp.js'

type GetCapabilitiesToolPayload = {
  keyframeableProperties: readonly PropertyIdJson[]
  sceneExtension: '.hype'
  mcpTools: readonly McpToolName[]
  validation: {
    structuralSceneValidation: boolean
  }
  nodeKinds: readonly NodeKindJson[]
  patchOperations: readonly PatchOperation['op'][]
  queryTools: readonly QueryToolName[]
  validationTools: readonly ValidationToolName[]
  renderFormats: readonly RenderFormat[]
  renderQualities: readonly RenderQuality[]
  renderFileSceneInput: boolean
}

type KeyframeablePropertiesToolPayload = {
  keyframeableProperties: readonly PropertyIdJson[]
}

test('capability tools list the full supported keyframe property set', async () => {
  const capabilities = parseCapabilitiesJson(await handleGetCapabilities())
  const listed = parseKeyframeablePropertiesJson(await handleListKeyframeableProperties())

  assert.equal(capabilities.sceneExtension, '.hype')
  assert.deepEqual(capabilities.mcpTools, MCP_TOOLS)
  assert.deepEqual(capabilities.nodeKinds, NODE_KINDS)
  assert.deepEqual(capabilities.patchOperations, PATCH_OPERATION_TYPES)
  assert.deepEqual(capabilities.queryTools, [
    'list_layers',
    'get_layer',
    'list_tracks',
    'list_cameras',
  ])
  assert.deepEqual(capabilities.validation, {
    structuralSceneValidation: true,
  })
  assert.deepEqual(capabilities.validationTools, ['validate_scene'])
  assert.deepEqual(capabilities.renderFormats, RENDER_FORMATS)
  assert.deepEqual(capabilities.renderQualities, RENDER_QUALITIES)
  assert.equal(capabilities.renderFileSceneInput, true)
  assert.deepEqual(capabilities.keyframeableProperties, PROPERTY_IDS)
  assert.deepEqual(listed.keyframeableProperties, PROPERTY_IDS)
  const registeredToolNames = TOOLS.map((tool) => tool.name)
  assert.deepEqual(
    capabilities.mcpTools,
    registeredToolNames,
  )
  assert.equal(new Set(capabilities.mcpTools).size, capabilities.mcpTools.length)
  for (const toolName of [
    ...(capabilities.validationTools ?? []),
    ...(capabilities.queryTools ?? []),
  ]) {
    assert.ok(
      registeredToolNames.includes(toolName),
      `${toolName} should be a registered MCP tool`,
    )
  }
  assert.equal(
    new Set(capabilities.keyframeableProperties).size,
    PROPERTY_IDS.length,
  )
})

test('capability tool schemas accept no arguments', () => {
  const getCapabilities = TOOLS.find((tool) => tool.name === 'get_capabilities')
  const listKeyframeableProperties = TOOLS.find(
    (tool) => tool.name === 'list_keyframeable_properties',
  )

  assert.deepEqual(getCapabilities?.inputSchema, {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  })
  assert.deepEqual(listKeyframeableProperties?.inputSchema, {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  })
})

test('capability tools reject unknown arguments as MCP errors', async () => {
  const capabilities = await handleGetCapabilities({ output: 'capabilities.json' })
  const keyframeable = await handleListKeyframeableProperties({ property: 'opacity' })

  assert.equal(capabilities.isError, true)
  assert.match(assertToolText(capabilities), /^get_capabilities: invalid arguments/)
  assert.match(assertToolText(capabilities), /Unrecognized key/)
  assert.equal(keyframeable.isError, true)
  assert.match(assertToolText(keyframeable), /^list_keyframeable_properties: invalid arguments/)
  assert.match(assertToolText(keyframeable), /Unrecognized key/)
})

test('get_capabilities description mentions agent-facing capability groups', () => {
  const getCapabilities = TOOLS.find((tool) => tool.name === 'get_capabilities')
  const description = getCapabilities?.description ?? ''

  assert.match(description, /render formats\/qualities/)
  assert.match(description, /saved-scene render support/)
  assert.match(description, /validation\/query tools/)
  assert.match(description, /keyframeable properties/)
})

function parseCapabilitiesJson(result: CallToolResult): GetCapabilitiesToolPayload {
  const parsed: unknown = JSON.parse(assertToolText(result))
  assertRecord(parsed)
  const parsedObject = parsed

  const rawSceneExtension = parsedObject.sceneExtension
  assert.equal(rawSceneExtension, '.hype')
  const sceneExtension = rawSceneExtension

  const rawValidation = parsedObject.validation
  assertRecord(rawValidation)
  const validationObject = rawValidation
  const structuralSceneValidation = validationObject.structuralSceneValidation
  assert.ok(typeof structuralSceneValidation === 'boolean')
  const validation = {
    structuralSceneValidation,
  }

  const keyframeableProperties = requiredKnownStringArray(
    parsedObject,
    'keyframeableProperties',
    PROPERTY_IDS,
  )

  const nodeKinds = requiredKnownStringArray(parsedObject, 'nodeKinds', NODE_KINDS)

  return {
    keyframeableProperties,
    sceneExtension,
    mcpTools: requiredKnownStringArray(parsedObject, 'mcpTools', MCP_TOOLS),
    validation,
    nodeKinds,
    patchOperations: requiredKnownStringArray(
      parsedObject,
      'patchOperations',
      PATCH_OPERATION_TYPES,
    ),
    queryTools: requiredKnownStringArray(parsedObject, 'queryTools', QUERY_TOOLS),
    validationTools: requiredKnownStringArray(
      parsedObject,
      'validationTools',
      VALIDATION_TOOLS,
    ),
    renderFormats: requiredKnownStringArray(parsedObject, 'renderFormats', RENDER_FORMATS),
    renderQualities: requiredKnownStringArray(
      parsedObject,
      'renderQualities',
      RENDER_QUALITIES,
    ),
    renderFileSceneInput: requiredBoolean(parsedObject, 'renderFileSceneInput'),
  }
}

function parseKeyframeablePropertiesJson(
  result: CallToolResult,
): KeyframeablePropertiesToolPayload {
  const parsed: unknown = JSON.parse(assertToolText(result))
  assertRecord(parsed)
  const parsedObject = parsed
  const keyframeableProperties = requiredKnownStringArray(
    parsedObject,
    'keyframeableProperties',
    PROPERTY_IDS,
  )

  return { keyframeableProperties }
}

function requiredKnownStringArray<const Value extends string>(
  parsed: Record<string, unknown>,
  key: string,
  knownValues: readonly Value[],
): readonly Value[] {
  const values = requiredStringArray(parsed, key)
  const knownValueSet: ReadonlySet<string> = new Set(knownValues)
  assert.ok(
    values.every((value) => knownValueSet.has(value)),
    `${key} includes an unknown value`,
  )
  return values as readonly Value[]
}

function requiredStringArray(parsed: Record<string, unknown>, key: string): readonly string[] {
  const value = parsed[key]
  assertStringArray(value)
  return value
}

function requiredBoolean(parsed: Record<string, unknown>, key: string): boolean {
  const value = parsed[key]
  assert.ok(typeof value === 'boolean')
  return value
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
}

function assertStringArray(value: unknown): asserts value is readonly string[] {
  assert.ok(Array.isArray(value))
  assert.ok(value.every((item) => typeof item === 'string'))
}
