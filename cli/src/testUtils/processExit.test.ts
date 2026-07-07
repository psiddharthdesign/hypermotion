// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { type ProcessExitError, withProcessExitThrow } from './processExit.js'

test('withProcessExitThrow restores process.exit after sync callbacks', async () => {
  const previousExit = process.exit

  await withProcessExitThrow(() => {
    assert.notEqual(process.exit, previousExit)
  })

  assert.equal(process.exit, previousExit)
})

test('withProcessExitThrow restores process.exit after async callbacks', async () => {
  const previousExit = process.exit

  await withProcessExitThrow(async () => {
    await Promise.resolve()
    assert.notEqual(process.exit, previousExit)
  })

  assert.equal(process.exit, previousExit)
})

test('withProcessExitThrow restores process.exit after async callback failures', async () => {
  const previousExit = process.exit

  await assert.rejects(
    withProcessExitThrow(async () => {
      assert.notEqual(process.exit, previousExit)
      throw new Error('callback failed')
    }),
    /callback failed/,
  )

  assert.equal(process.exit, previousExit)
})

test('withProcessExitThrow restores process.exit after sync callback failures', async () => {
  const previousExit = process.exit

  await assert.rejects(
    withProcessExitThrow(() => {
      assert.notEqual(process.exit, previousExit)
      throw new Error('callback failed')
    }),
    /callback failed/,
  )

  assert.equal(process.exit, previousExit)
})

test('withProcessExitThrow returns sync callback values', async () => {
  const value = await withProcessExitThrow(() => 'render complete')

  assert.equal(value, 'render complete')
})

test('withProcessExitThrow returns async callback values', async () => {
  const value = await withProcessExitThrow(async () => {
    await Promise.resolve()
    return 'render complete'
  })

  assert.equal(value, 'render complete')
})

test('withProcessExitThrow converts process.exit into a thrown error', async () => {
  await assert.rejects(
    withProcessExitThrow(() => {
      process.exit(2)
    }),
    (err: unknown) => {
      assertProcessExitError(err)
      assert.equal(err.exitCode, 2)
      return true
    },
  )
})

test('withProcessExitThrow restores process.exit after process.exit throws', async () => {
  const previousExit = process.exit

  await assert.rejects(
    withProcessExitThrow(() => {
      process.exit(2)
    }),
    { exitCode: 2 },
  )

  assert.equal(process.exit, previousExit)
})

test('withProcessExitThrow preserves string exit codes', async () => {
  await assert.rejects(
    withProcessExitThrow(() => {
      process.exit('1')
    }),
    { exitCode: '1' },
  )
})

test('withProcessExitThrow treats process.exit without a code as success', async () => {
  await assert.rejects(
    withProcessExitThrow(() => {
      process.exit()
    }),
    { exitCode: 0 },
  )
})

test('withProcessExitThrow treats null process.exit codes as success', async () => {
  await assert.rejects(
    withProcessExitThrow(() => {
      process.exit(null)
    }),
    { exitCode: 0 },
  )
})

function assertProcessExitError(err: unknown): asserts err is ProcessExitError {
  assert.ok(err instanceof Error)
  assert.ok('exitCode' in err)
  assert.ok(
    typeof err.exitCode === 'number' ||
      typeof err.exitCode === 'string',
  )
}
