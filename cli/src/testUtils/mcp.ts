// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function assertToolText(result: CallToolResult): string {
  const item = result.content[0]
  assert.equal(item?.type, 'text')
  return item.text
}
