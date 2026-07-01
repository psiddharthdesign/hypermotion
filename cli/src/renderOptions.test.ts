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
  assert.equal(isRenderFormat(undefined), false)
  assert.equal(isRenderFormat(60), false)

  assert.equal(isRenderQuality('comp'), true)
  assert.equal(isRenderQuality('720p'), true)
  assert.equal(isRenderQuality('2k'), true)
  assert.equal(isRenderQuality('4k'), true)
  assert.equal(isRenderQuality('1080p'), false)
  assert.equal(isRenderQuality(undefined), false)
  assert.equal(isRenderQuality(60), false)
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

test('inferRenderFormatFromPath trims surrounding whitespace', () => {
  assert.equal(inferRenderFormatFromPath(' /tmp/demo.gif '), 'gif')
})

test('inferRenderFormatFromPath ignores URL-style suffixes', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.gif?download=1'), 'gif')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.webm#preview'), 'webm')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mp4?download=1#preview'), 'mp4')
})

test('inferRenderFormatFromPath falls back to mp4 for unknown extensions', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mov'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.'), 'mp4')
})
