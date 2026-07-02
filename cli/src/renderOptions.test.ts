// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  inferRenderFormatFromPath,
  isRenderFormat,
  isRenderQuality,
  RENDER_FORMATS,
  RENDER_QUALITIES,
} from './renderOptions.js'

test('render option guards accept supported values only', () => {
  for (const format of RENDER_FORMATS) {
    assert.equal(isRenderFormat(format), true)
  }
  assert.equal(isRenderFormat('mov'), false)
  assert.equal(isRenderFormat('MP4'), false)
  assert.equal(isRenderFormat(undefined), false)
  assert.equal(isRenderFormat(60), false)

  for (const quality of RENDER_QUALITIES) {
    assert.equal(isRenderQuality(quality), true)
  }
  assert.equal(isRenderQuality('1080p'), false)
  assert.equal(isRenderQuality('4K'), false)
  assert.equal(isRenderQuality(undefined), false)
  assert.equal(isRenderQuality(60), false)
})

test('inferRenderFormatFromPath uses supported file extensions', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mp4'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.webm'), 'webm')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.gif'), 'gif')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.final.mp4'), 'mp4')
})

test('inferRenderFormatFromPath ignores extensions in parent directories', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/exports.webm/demo'), 'mp4')
})

test('inferRenderFormatFromPath normalizes extension casing', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.WEBM'), 'webm')
})

test('inferRenderFormatFromPath recognizes extension-only output filenames', () => {
  assert.equal(inferRenderFormatFromPath('.gif'), 'gif')
  assert.equal(inferRenderFormatFromPath('/tmp/.WEBM'), 'webm')
  assert.equal(inferRenderFormatFromPath('.mov'), 'mp4')
})

test('inferRenderFormatFromPath trims surrounding whitespace', () => {
  assert.equal(inferRenderFormatFromPath(' /tmp/demo.gif '), 'gif')
})

test('inferRenderFormatFromPath ignores URL-style suffixes', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.gif?download=1'), 'gif')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.webm#preview'), 'webm')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mp4?download=1#preview'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.webm#preview?download=1'), 'webm')
  assert.equal(inferRenderFormatFromPath(' /tmp/demo.webm?download=1 '), 'webm')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.GIF?download=1'), 'gif')
  assert.equal(inferRenderFormatFromPath('/tmp/demo?format=gif'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo?format=gif.mp4'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo#preview.webm'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo#preview.webm?download=1'), 'mp4')
})

test('inferRenderFormatFromPath falls back to mp4 for unknown extensions', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/demo.mov'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo'), 'mp4')
  assert.equal(inferRenderFormatFromPath('/tmp/demo.'), 'mp4')
  assert.equal(inferRenderFormatFromPath('   '), 'mp4')
  assert.equal(inferRenderFormatFromPath('?download=1'), 'mp4')
  assert.equal(inferRenderFormatFromPath('#preview'), 'mp4')
})
