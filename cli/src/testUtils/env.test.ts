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

test('withEnvVar restores existing empty string values', async () => {
  const name = 'HYPERMOTION_TEST_ENV_EMPTY'
  process.env[name] = ''

  try {
    await withEnvVar(name, 'during', () => {
      assert.equal(process.env[name], 'during')
    })

    assert.equal(process.env[name], '')
  } finally {
    delete process.env[name]
  }
})

test('withEnvVar removes variables that were originally unset', async () => {
  const name = 'HYPERMOTION_TEST_ENV_UNSET'
  delete process.env[name]

  await withEnvVar(name, 'during', () => {
    assert.equal(process.env[name], 'during')
  })

  assert.equal(process.env[name], undefined)
})

test('withEnvVar can temporarily unset an existing variable', async () => {
  const name = 'HYPERMOTION_TEST_ENV_TEMP_UNSET'
  process.env[name] = 'before'

  try {
    await withEnvVar(name, undefined, () => {
      assert.equal(process.env[name], undefined)
    })

    assert.equal(process.env[name], 'before')
  } finally {
    delete process.env[name]
  }
})

test('withEnvVar restores temporarily unset variables after callback failures', async () => {
  const name = 'HYPERMOTION_TEST_ENV_TEMP_UNSET_THROW'
  process.env[name] = 'before'

  try {
    await assert.rejects(
      withEnvVar(name, undefined, () => {
        assert.equal(process.env[name], undefined)
        throw new Error('callback failed')
      }),
      /callback failed/,
    )

    assert.equal(process.env[name], 'before')
  } finally {
    delete process.env[name]
  }
})

test('withEnvVar restores values after async callbacks', async () => {
  const name = 'HYPERMOTION_TEST_ENV_ASYNC'
  process.env[name] = 'before'

  try {
    await withEnvVar(name, 'during', async () => {
      await Promise.resolve()
      assert.equal(process.env[name], 'during')
    })

    assert.equal(process.env[name], 'before')
  } finally {
    delete process.env[name]
  }
})

test('withEnvVar returns sync callback values', async () => {
  const name = 'HYPERMOTION_TEST_ENV_SYNC_RETURN'
  delete process.env[name]

  const value = await withEnvVar(name, 'during', () => process.env[name])

  assert.equal(value, 'during')
  assert.equal(process.env[name], undefined)
})

test('withEnvVar returns async callback values', async () => {
  const name = 'HYPERMOTION_TEST_ENV_ASYNC_RETURN'
  delete process.env[name]

  const value = await withEnvVar(name, 'during', async () => {
    await Promise.resolve()
    return process.env[name]
  })

  assert.equal(value, 'during')
  assert.equal(process.env[name], undefined)
})

test('withEnvVar restores values after async callback failures', async () => {
  const name = 'HYPERMOTION_TEST_ENV_ASYNC_THROW'
  process.env[name] = 'before'

  try {
    await assert.rejects(
      withEnvVar(name, 'during', async () => {
        assert.equal(process.env[name], 'during')
        throw new Error('callback failed')
      }),
      /callback failed/,
    )

    assert.equal(process.env[name], 'before')
  } finally {
    delete process.env[name]
  }
})

test('withEnvVar restores values after sync callback failures', async () => {
  const name = 'HYPERMOTION_TEST_ENV_SYNC_THROW'
  process.env[name] = 'before'

  try {
    await assert.rejects(
      withEnvVar(name, 'during', () => {
        assert.equal(process.env[name], 'during')
        throw new Error('callback failed')
      }),
      /callback failed/,
    )

    assert.equal(process.env[name], 'before')
  } finally {
    delete process.env[name]
  }
})
