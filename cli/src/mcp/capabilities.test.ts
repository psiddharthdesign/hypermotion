// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  handleGetCapabilities,
  handleListKeyframeableProperties,
} from './tools/capabilities.js'
import { NODE_KINDS, PATCH_OPERATION_TYPES, PROPERTY_IDS } from '../scene/build.js'

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
  assert.deepEqual(capabilities.keyframeableProperties, PROPERTY_IDS)
  assert.deepEqual(listed.keyframeableProperties, PROPERTY_IDS)
  assert.equal(
    new Set(capabilities.keyframeableProperties).size,
    PROPERTY_IDS.length,
  )
})

function parseToolJson(result: CallToolResult): {
  keyframeableProperties: string[]
  sceneExtension?: string
  validation?: {
    structuralSceneValidation: boolean
  }
  nodeKinds?: string[]
  patchOperations?: string[]
  queryTools?: string[]
  validationTools?: string[]
  renderFormats?: string[]
  renderQualities?: string[]
} {
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

  const rawNodeKinds = parsedObject.nodeKinds
  let nodeKinds: string[] | undefined
  if (rawNodeKinds !== undefined) {
    assertStringArray(rawNodeKinds)
    nodeKinds = rawNodeKinds
  }

  return {
    keyframeableProperties: properties,
    sceneExtension,
    validation,
    nodeKinds,
    patchOperations: optionalStringArray(parsedObject, 'patchOperations'),
    queryTools: optionalStringArray(parsedObject, 'queryTools'),
    validationTools: optionalStringArray(parsedObject, 'validationTools'),
    renderFormats: optionalStringArray(parsedObject, 'renderFormats'),
    renderQualities: optionalStringArray(parsedObject, 'renderQualities'),
  }
}

function optionalStringArray(parsed: Record<string, unknown>, key: string): string[] | undefined {
  const value = parsed[key]
  if (value === undefined) return undefined

  assertStringArray(value)
  return value
}

function assertStringArray(value: unknown): asserts value is string[] {
  assert.ok(Array.isArray(value))
  assert.ok(value.every((item) => typeof item === 'string'))
}
