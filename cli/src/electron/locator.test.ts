// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { locateDesktopApp } from './locator.js'
import { captureStderr } from '../testUtils/stdout.js'

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-locator-missing-'))
  const missingPath = path.join(dir, 'hyper-motion')

  try {
    process.env.HYPERMOTION_APP_PATH = missingPath

    const stderr = await captureStderr(async () => {
      assert.equal(await locateDesktopApp(), null)
    })

    assert.match(stderr, /HYPERMOTION_APP_PATH is set/)
    assert.equal(stderr.includes(missingPath), true)
  } finally {
    if (previousOverride === undefined) {
      delete process.env.HYPERMOTION_APP_PATH
    } else {
      process.env.HYPERMOTION_APP_PATH = previousOverride
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('locator treats an empty HYPERMOTION_APP_PATH as unset', async () => {
  const previousOverride = process.env.HYPERMOTION_APP_PATH

  try {
    process.env.HYPERMOTION_APP_PATH = ''
    let locatedPath: string | null = null

    const stderr = await captureStderr(async () => {
      locatedPath = await locateDesktopApp()
    })

    assert.equal(stderr, '')
    if (locatedPath !== null) {
      assert.equal(fs.existsSync(locatedPath), true)
    }
  } finally {
    if (previousOverride === undefined) {
      delete process.env.HYPERMOTION_APP_PATH
    } else {
      process.env.HYPERMOTION_APP_PATH = previousOverride
    }
  }
})
