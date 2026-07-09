// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { rejectUnexpectedEmptyArgs } from './schema.js'

test('rejectUnexpectedEmptyArgs allows empty argument objects', () => {
  assert.equal(rejectUnexpectedEmptyArgs('doctor', {}), null)
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
