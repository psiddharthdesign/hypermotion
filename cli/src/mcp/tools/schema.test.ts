// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_ARGS_TOOL_NAMES,
  EMPTY_OBJECT_INPUT_SCHEMA,
  rejectUnexpectedEmptyArgs,
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

test('rejectUnexpectedEmptyArgs allows null-prototype argument records', () => {
  const args = Object.create(null)
  assert.equal(rejectUnexpectedEmptyArgs('doctor', args), null)
})

test('rejectUnexpectedEmptyArgs rejects non-object arguments clearly', () => {
  class CustomArgs {}

  assert.equal(
    rejectUnexpectedEmptyArgs('doctor', []),
    'doctor: invalid arguments — Expected an object',
  )
  assert.equal(
    rejectUnexpectedEmptyArgs('doctor', null),
    'doctor: invalid arguments — Expected an object',
  )
  assert.equal(
    rejectUnexpectedEmptyArgs('doctor', new Date()),
    'doctor: invalid arguments — Expected an object',
  )
  assert.equal(
    rejectUnexpectedEmptyArgs('doctor', new CustomArgs()),
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

test('rejectUnexpectedEmptyArgs reports unexpected null-prototype keys', () => {
  const args = Object.assign(Object.create(null), {
    zeta: true,
    alpha: true,
  }) as Record<string, unknown>

  assert.equal(
    rejectUnexpectedEmptyArgs('list_keyframeable_properties', args),
    'list_keyframeable_properties: invalid arguments — Unrecognized key(s): alpha, zeta',
  )
})
