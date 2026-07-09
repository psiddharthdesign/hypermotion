// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { assertToolText } from './mcp.js'

test('assertToolText returns the only MCP text content item', () => {
  const result: CallToolResult = {
    content: [{ type: 'text', text: 'hello' }],
  }

  assert.equal(assertToolText(result), 'hello')
})

test('assertToolText rejects extra content items', () => {
  const result: CallToolResult = {
    content: [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'extra' },
    ],
  }

  assert.throws(
    () => assertToolText(result),
    /expected exactly one MCP content item/,
  )
})

test('assertToolText reports missing text content clearly', () => {
  const result: CallToolResult = { content: [] }

  assert.throws(
    () => assertToolText(result),
    /expected exactly one MCP content item/,
  )
})

test('assertToolText rejects missing content arrays clearly', () => {
  const result = {} as unknown as CallToolResult

  assert.throws(
    () => assertToolText(result),
    /expected MCP content to be an array/,
  )
})

test('assertToolText rejects undefined content items', () => {
  const result = {
    content: [undefined],
  } as unknown as CallToolResult

  assert.throws(
    () => assertToolText(result),
    /expected first MCP content item to be text/,
  )
})

test('assertToolText rejects non-text first content items', () => {
  const result: CallToolResult = {
    content: [{ type: 'image', data: 'base64-png', mimeType: 'image/png' }],
  }

  assert.throws(
    () => assertToolText(result),
    /expected first MCP content item to be text/,
  )
})

test('assertToolText rejects malformed text payloads', () => {
  const result = {
    content: [{ type: 'text', text: undefined }],
  } as unknown as CallToolResult

  assert.throws(
    () => assertToolText(result),
    /expected MCP text content to be a string/,
  )
})
