// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  handleGetCapabilities,
  handleListKeyframeableProperties,
} from './tools/capabilities.js'

test('capability tools list the full supported keyframe property set', async () => {
  const expected = [
    'transform.anchorX',
    'transform.anchorY',
    'transform.anchorZ',
    'camera.focusX',
    'camera.focusY',
    'camera.iso',
    'appearance.cornerRadii',
    'appearance.cornerRadii.tl',
    'appearance.cornerRadii.tr',
    'appearance.cornerRadii.br',
    'appearance.cornerRadii.bl',
    'appearance.fill',
  ]

  const capabilities = parseToolJson(await handleGetCapabilities())
  const listed = parseToolJson(await handleListKeyframeableProperties())

  for (const propertyId of expected) {
    assert.ok(
      capabilities.keyframeableProperties.includes(propertyId),
      `get_capabilities omitted ${propertyId}`,
    )
    assert.ok(
      listed.keyframeableProperties.includes(propertyId),
      `list_keyframeable_properties omitted ${propertyId}`,
    )
  }
})

function parseToolJson(result: {
  content: Array<{ type: 'text'; text: string }>
}): { keyframeableProperties: string[] } {
  return JSON.parse(result.content[0]?.text ?? '{}') as {
    keyframeableProperties: string[]
  }
}
