// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { withEnvVar } from './env.js'

test('withEnvVar restores values after sync callbacks', async () => {
  const name = 'HYPERMOTION_TEST_ENV_SYNC'
  process.env[name] = 'before'

  try {
    await withEnvVar(name, 'during', () => {
      assert.equal(process.env[name], 'during')
    })

    assert.equal(process.env[name], 'before')
  } finally {
    delete process.env[name]
  }
})
