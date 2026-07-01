// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { inferRenderFormatFromPath } from './renderOptions.js'

test('inferRenderFormatFromPath uses supported file extensions', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mp4'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.webm'), 'webm')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.gif'), 'gif')
})

test('inferRenderFormatFromPath normalizes extension casing', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.WEBM'), 'webm')
})

test('inferRenderFormatFromPath falls back to mp4 for unknown extensions', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mov'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.'), 'mp4')
})
