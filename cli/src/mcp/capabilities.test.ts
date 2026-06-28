// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  handleGetCapabilities,
  handleListKeyframeableProperties,
} from './tools/capabilities.js'
import {
  NODE_KINDS,
  PATCH_OPERATION_TYPES,
  PROPERTY_IDS,
  type NodeKindJson,
  type PatchOperation,
  type PropertyIdJson,
} from '../scene/build.js'

type CapabilitiesToolPayload = {
  keyframeableProperties: readonly PropertyIdJson[]
  sceneExtension?: string
  validation?: {
    structuralSceneValidation: boolean
  }
  nodeKinds?: readonly NodeKindJson[]
  patchOperations?: readonly PatchOperation['op'][]
  queryTools?: readonly string[]
  validationTools?: readonly string[]
  renderFormats?: readonly string[]
  renderQualities?: readonly string[]
  renderFileSceneInput?: boolean
}

test('capability tools list the full supported keyframe property set', async () => {
  const capabilities = parseToolJson(await handleGetCapabilities())
  const listed = parseToolJson(await handleListKeyframeableProperties())

  assert.equal(capabilities.sceneExtension, '.hype')
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
  assert.deepEqual(capabilities.renderFormats, ['mp4', 'webm', 'gif'])
  assert.deepEqual(capabilities.renderQualities, ['comp', '720p', '2k', '4k'])
  assert.equal(capabilities.renderFileSceneInput, true)
  assert.deepEqual(capabilities.keyframeableProperties, PROPERTY_IDS)
  assert.deepEqual(listed.keyframeableProperties, PROPERTY_IDS)
  assert.equal(
    new Set(capabilities.keyframeableProperties).size,
    PROPERTY_IDS.length,
  )
})

function parseToolJson(result: CallToolResult): CapabilitiesToolPayload {
  const item = result.content[0]
  assert.equal(item?.type, 'text')

  const parsed: unknown = JSON.parse(item.text)
  assert.equal(typeof parsed, 'object')
  assert.notEqual(parsed, null)
  const parsedObject = parsed as Record<string, unknown>

  const rawSceneExtension = parsedObject.sceneExtension
  let sceneExtension: string | undefined
  if (rawSceneExtension !== undefined) {
    assert.ok(typeof rawSceneExtension === 'string')
    sceneExtension = rawSceneExtension
  }

  const rawValidation = parsedObject.validation
  let validation:
    | {
        structuralSceneValidation: boolean
      }
    | undefined
  if (rawValidation !== undefined) {
    assert.equal(typeof rawValidation, 'object')
    assert.notEqual(rawValidation, null)
    const validationObject = rawValidation as Record<string, unknown>
    const structuralSceneValidation = validationObject.structuralSceneValidation
    assert.ok(typeof structuralSceneValidation === 'boolean')
    validation = {
      structuralSceneValidation,
    }
  }

  const properties = parsedObject.keyframeableProperties
  assertStringArray(properties)
  const keyframeableProperties = properties as readonly PropertyIdJson[]

  const rawNodeKinds = parsedObject.nodeKinds
  let nodeKinds: readonly NodeKindJson[] | undefined
  if (rawNodeKinds !== undefined) {
    assertStringArray(rawNodeKinds)
    nodeKinds = rawNodeKinds as readonly NodeKindJson[]
  }

  return {
    keyframeableProperties,
    sceneExtension,
    validation,
    nodeKinds,
    patchOperations: optionalStringArray(parsedObject, 'patchOperations') as
      | readonly PatchOperation['op'][]
      | undefined,
    queryTools: optionalStringArray(parsedObject, 'queryTools'),
    validationTools: optionalStringArray(parsedObject, 'validationTools'),
    renderFormats: optionalStringArray(parsedObject, 'renderFormats'),
    renderQualities: optionalStringArray(parsedObject, 'renderQualities'),
    renderFileSceneInput: optionalBoolean(parsedObject, 'renderFileSceneInput'),
  }
}

function optionalStringArray(parsed: Record<string, unknown>, key: string): string[] | undefined {
  const value = parsed[key]
  if (value === undefined) return undefined

  assertStringArray(value)
  return value
}

function optionalBoolean(parsed: Record<string, unknown>, key: string): boolean | undefined {
  const value = parsed[key]
  if (value === undefined) return undefined

  assert.ok(typeof value === 'boolean')
  return value
}

function assertStringArray(value: unknown): asserts value is string[] {
  assert.ok(Array.isArray(value))
  assert.ok(value.every((item) => typeof item === 'string'))
}
