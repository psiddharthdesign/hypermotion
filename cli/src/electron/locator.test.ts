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
