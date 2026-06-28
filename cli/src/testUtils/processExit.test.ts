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

test('withProcessExitThrow converts process.exit into a thrown error', async () => {
  await assert.rejects(
    withProcessExitThrow(() => {
      process.exit(2)
    }),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.equal((err as ProcessExitError).exitCode, 2)
      return true
    },
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
