// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  inferRenderFormatFromPath,
  isRenderFormat,
  isRenderQuality,
} from './renderOptions.js'

test('render option guards accept supported values only', () => {
  assert.equal(isRenderFormat('mp4'), true)
  assert.equal(isRenderFormat('webm'), true)
  assert.equal(isRenderFormat('gif'), true)
  assert.equal(isRenderFormat('mov'), false)

  assert.equal(isRenderQuality('comp'), true)
  assert.equal(isRenderQuality('720p'), true)
  assert.equal(isRenderQuality('2k'), true)
  assert.equal(isRenderQuality('4k'), true)
  assert.equal(isRenderQuality('1080p'), false)
})

test('inferRenderFormatFromPath uses supported file extensions', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mp4'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.webm'), 'webm')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.gif'), 'gif')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.final.mp4'), 'mp4')
})

test('inferRenderFormatFromPath normalizes extension casing', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.WEBM'), 'webm')
})

test('inferRenderFormatFromPath falls back to mp4 for unknown extensions', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mov'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.'), 'mp4')
})
