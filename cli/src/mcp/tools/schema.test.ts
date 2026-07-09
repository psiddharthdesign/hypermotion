// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_ARGS_TOOL_NAMES,
  EMPTY_OBJECT_INPUT_SCHEMA,
  rejectUnexpectedEmptyArgs,
  type McpToolArgs,
} from './schema.js'

test('EMPTY_ARGS_TOOL_NAMES lists tools handled by the empty-args helper', () => {
  assert.deepEqual(EMPTY_ARGS_TOOL_NAMES, [
    'doctor',
    'get_capabilities',
    'list_keyframeable_properties',
  ])
})

test('EMPTY_OBJECT_INPUT_SCHEMA rejects extra MCP arguments', () => {
  assert.deepEqual(EMPTY_OBJECT_INPUT_SCHEMA, {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  })
})

test('rejectUnexpectedEmptyArgs allows empty argument objects', () => {
  assert.equal(rejectUnexpectedEmptyArgs('doctor', {}), null)
})

test('rejectUnexpectedEmptyArgs rejects non-object arguments clearly', () => {
  assert.equal(
    rejectUnexpectedEmptyArgs('doctor', [] as unknown as McpToolArgs),
    'doctor: invalid arguments — Expected an object',
  )
  assert.equal(
    rejectUnexpectedEmptyArgs('doctor', null as unknown as McpToolArgs),
    'doctor: invalid arguments — Expected an object',
  )
})

test('rejectUnexpectedEmptyArgs reports unexpected keys deterministically', () => {
  assert.equal(
    rejectUnexpectedEmptyArgs('get_capabilities', {
      zeta: true,
      alpha: true,
    }),
    'get_capabilities: invalid arguments — Unrecognized key(s): alpha, zeta',
  )
})
