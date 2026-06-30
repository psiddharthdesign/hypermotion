// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

type ToolTextContent = Extract<CallToolResult['content'][number], { type: 'text' }>

export function assertToolText(result: CallToolResult): string {
  const item = result.content[0]
  assert.ok(isToolTextContent(item))
  return item.text
}

function isToolTextContent(
  item: CallToolResult['content'][number] | undefined,
): item is ToolTextContent {
  return item?.type === 'text'
}
