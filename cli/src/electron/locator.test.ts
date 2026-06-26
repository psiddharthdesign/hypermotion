// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { locateDesktopApp } from './locator.js'

test('locator returns an existing HYPERMOTION_APP_PATH override', async () => {
  const previousOverride = process.env.HYPERMOTION_APP_PATH
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-locator-'))
  const appPath = path.join(dir, 'hyper-motion')

  try {
    fs.writeFileSync(appPath, '')
    process.env.HYPERMOTION_APP_PATH = appPath

    assert.equal(await locateDesktopApp(), appPath)
  } finally {
    if (previousOverride === undefined) {
      delete process.env.HYPERMOTION_APP_PATH
    } else {
      process.env.HYPERMOTION_APP_PATH = previousOverride
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('locator rejects a missing HYPERMOTION_APP_PATH override', async () => {
  const previousOverride = process.env.HYPERMOTION_APP_PATH
  const previousConsoleError = console.error
  const missingPath = path.join(os.tmpdir(), `hypermotion-missing-${process.pid}`)
  const messages: unknown[] = []

  try {
    process.env.HYPERMOTION_APP_PATH = missingPath
    console.error = (...args: unknown[]) => {
      messages.push(...args)
    }

    assert.equal(await locateDesktopApp(), null)
    assert.equal(messages.length, 1)
    assert.match(String(messages[0]), /HYPERMOTION_APP_PATH is set/)
    assert.match(String(messages[0]), new RegExp(missingPath.replaceAll('\\', '\\\\')))
  } finally {
    console.error = previousConsoleError
    if (previousOverride === undefined) {
      delete process.env.HYPERMOTION_APP_PATH
    } else {
      process.env.HYPERMOTION_APP_PATH = previousOverride
    }
  }
})
