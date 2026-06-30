// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { captureStderr, captureStdout } from './stdout.js'

test('captureStdout decodes Uint8Array chunks as text', async () => {
  const output = await captureStdout(() => {
    process.stdout.write(new TextEncoder().encode('render complete'))
  })

  assert.equal(output, 'render complete')
})

test('captureStderr decodes Uint8Array chunks as text', async () => {
  const output = await captureStderr(() => {
    process.stderr.write(new TextEncoder().encode('render failed'))
  })

  assert.equal(output, 'render failed')
})

test('captureStdout honors string chunk encodings', async () => {
  const output = await captureStdout(() => {
    process.stdout.write('cmVuZGVyIGNvbXBsZXRl', 'base64')
  })

  assert.equal(output, 'render complete')
})

test('captureStderr honors string chunk encodings', async () => {
  const output = await captureStderr(() => {
    process.stderr.write('cmVuZGVyIGZhaWxlZA==', 'base64')
  })

  assert.equal(output, 'render failed')
})

test('captureStdout honors binary chunk encodings', async () => {
  const output = await captureStdout(() => {
    process.stdout.write(Buffer.from('render complete'), 'hex')
  })

  assert.equal(output, '72656e64657220636f6d706c657465')
})

test('captureStderr honors binary chunk encodings', async () => {
  const output = await captureStderr(() => {
    process.stderr.write(Buffer.from('render failed'), 'hex')
  })

  assert.equal(output, '72656e646572206661696c6564')
})

test('captureStdout invokes write callbacks', async () => {
  let callbackCalled = false

  const output = await captureStdout(() => {
    process.stdout.write('render complete', () => {
      callbackCalled = true
    })
  })

  assert.equal(output, 'render complete')
  assert.equal(callbackCalled, true)
})

test('captureStderr invokes write callbacks', async () => {
  let callbackCalled = false

  const output = await captureStderr(() => {
    process.stderr.write('render failed', () => {
      callbackCalled = true
    })
  })

  assert.equal(output, 'render failed')
  assert.equal(callbackCalled, true)
})

test('captureStdout restores the writer after sync callbacks', async () => {
  const originalWrite = process.stdout.write

  await captureStdout(() => {
    process.stdout.write('render complete')
  })

  assert.equal(process.stdout.write, originalWrite)
})

test('captureStderr restores the writer after sync callbacks', async () => {
  const originalWrite = process.stderr.write

  await captureStderr(() => {
    process.stderr.write('render failed')
  })

  assert.equal(process.stderr.write, originalWrite)
})

test('captureStdout restores the writer after async callbacks', async () => {
  const originalWrite = process.stdout.write

  await captureStdout(async () => {
    process.stdout.write('render complete')
    await Promise.resolve()
  })

  assert.equal(process.stdout.write, originalWrite)
})

test('captureStderr restores the writer after async callbacks', async () => {
  const originalWrite = process.stderr.write

  await captureStderr(async () => {
    process.stderr.write('render failed')
    await Promise.resolve()
  })

  assert.equal(process.stderr.write, originalWrite)
})

test('captureStdout restores the writer when the callback throws', async () => {
  const originalWrite = process.stdout.write

  await assert.rejects(
    captureStdout(() => {
      throw new Error('boom')
    }),
    /boom/,
  )

  assert.equal(process.stdout.write, originalWrite)
})

test('captureStdout restores the writer when async callbacks reject', async () => {
  const originalWrite = process.stdout.write

  await assert.rejects(
    captureStdout(async () => {
      await Promise.resolve()
      throw new Error('boom')
    }),
    /boom/,
  )

  assert.equal(process.stdout.write, originalWrite)
})

test('captureStderr restores the writer when the callback throws', async () => {
  const originalWrite = process.stderr.write

  await assert.rejects(
    captureStderr(() => {
      throw new Error('boom')
    }),
    /boom/,
  )

  assert.equal(process.stderr.write, originalWrite)
})

test('captureStderr restores the writer when async callbacks reject', async () => {
  const originalWrite = process.stderr.write

  await assert.rejects(
    captureStderr(async () => {
      await Promise.resolve()
      throw new Error('boom')
    }),
    /boom/,
  )

  assert.equal(process.stderr.write, originalWrite)
})
