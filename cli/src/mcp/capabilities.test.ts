// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  handleGetCapabilities,
  handleListKeyframeableProperties,
} from './tools/capabilities.js'
import { PROPERTY_IDS } from '../scene/build.js'

test('capability tools list the full supported keyframe property set', async () => {
  const capabilities = parseToolJson(await handleGetCapabilities())
  const listed = parseToolJson(await handleListKeyframeableProperties())

  assert.deepEqual(capabilities.keyframeableProperties, PROPERTY_IDS)
  assert.deepEqual(listed.keyframeableProperties, PROPERTY_IDS)
  assert.equal(
    new Set(capabilities.keyframeableProperties).size,
    PROPERTY_IDS.length,
  )
})

function parseToolJson(result: {
  content: Array<{ type: 'text'; text: string }>
}): { keyframeableProperties: string[] } {
  const parsed: unknown = JSON.parse(result.content[0]?.text ?? '{}')
  assert.equal(typeof parsed, 'object')
  assert.notEqual(parsed, null)

  const properties = (parsed as { keyframeableProperties?: unknown }).keyframeableProperties
  assert.ok(Array.isArray(properties))
  assert.ok(properties.every((propertyId) => typeof propertyId === 'string'))

  return { keyframeableProperties: properties }
}
