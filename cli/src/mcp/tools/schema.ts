// SPDX-License-Identifier: Apache-2.0

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const EMPTY_OBJECT_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
} as const satisfies Tool['inputSchema']
