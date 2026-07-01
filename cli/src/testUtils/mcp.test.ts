// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { assertToolText } from './mcp.js'

test('assertToolText returns the first MCP text content item', () => {
  const result: CallToolResult = {
    content: [{ type: 'text', text: 'hello' }],
  }

  assert.equal(assertToolText(result), 'hello')
})

test('assertToolText reports missing text content clearly', () => {
  const result: CallToolResult = { content: [] }

  assert.throws(
    () => assertToolText(result),
    /expected first MCP content item to be text/,
  )
})
