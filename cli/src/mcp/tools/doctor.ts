// SPDX-License-Identifier: Apache-2.0

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { getDoctorReport } from '../../commands/doctor.js'

export const doctorTool: Tool = {
  name: 'doctor',
  description: 'Check hyper-motion CLI, desktop app, scene format, render, and MCP capabilities.',
  inputSchema: { type: 'object', properties: {} },
}

export async function handleDoctor(): Promise<CallToolResult> {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(await getDoctorReport(), null, 2),
      },
    ],
  }
}
