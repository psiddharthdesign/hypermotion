// SPDX-License-Identifier: Apache-2.0

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export type McpToolArgs = Readonly<Record<string, unknown>>
export type StringSchemaProperty = {
  readonly type: 'string'
  readonly minLength?: number
  readonly pattern?: string
  readonly description: string
}
export type BooleanSchemaProperty = {
  readonly type: 'boolean'
  readonly description: string
  readonly default: boolean
}
export type EnumStringSchemaProperty<Value extends string> = StringSchemaProperty & {
  readonly enum: readonly Value[]
}
export type IntegerSchemaProperty = {
  readonly type: 'integer'
  readonly minimum: number
  readonly maximum: number
  readonly description: string
}

export const EMPTY_ARGS_TOOL_NAMES = [
  'doctor',
  'get_capabilities',
  'list_keyframeable_properties',
] as const
export type EmptyArgsToolName = (typeof EMPTY_ARGS_TOOL_NAMES)[number]

export const EMPTY_OBJECT_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const satisfies Tool['inputSchema']

export function rejectUnexpectedEmptyArgs(
  toolName: EmptyArgsToolName,
  args: unknown,
): string | null {
  if (!isPlainObject(args)) {
    return `${toolName}: invalid arguments — Expected an object`
  }
  const keys = Object.keys(args).sort()
  if (keys.length === 0) return null
  return `${toolName}: invalid arguments — Unrecognized key(s): ${keys.join(', ')}`
}

function isPlainObject(value: unknown): value is McpToolArgs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
