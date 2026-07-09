// SPDX-License-Identifier: Apache-2.0

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export type McpToolArgs = Record<string, unknown>

export const EMPTY_OBJECT_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const satisfies Tool['inputSchema']

export function rejectUnexpectedEmptyArgs(
  toolName: string,
  args: McpToolArgs,
): string | null {
  const keys = Object.keys(args)
  if (keys.length === 0) return null
  return `${toolName}: invalid arguments — Unrecognized key(s): ${keys.join(', ')}`
}
