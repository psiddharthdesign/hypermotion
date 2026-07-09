// SPDX-License-Identifier: Apache-2.0

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { getDoctorReport } from '../../commands/doctor.js'
import {
  EMPTY_OBJECT_INPUT_SCHEMA,
  rejectUnexpectedEmptyArgs,
  type McpToolArgs,
} from './schema.js'

export const doctorTool: Tool = {
  name: 'doctor',
  description: 'Check hyper-motion CLI, desktop app, scene format, render, and MCP capabilities.',
  inputSchema: EMPTY_OBJECT_INPUT_SCHEMA,
}

export async function handleDoctor(args: McpToolArgs = {}): Promise<CallToolResult> {
  const invalidArgsMessage = rejectUnexpectedEmptyArgs('doctor', args)
  if (invalidArgsMessage !== null) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: invalidArgsMessage }],
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(await getDoctorReport(), null, 2),
      },
    ],
  }
}
