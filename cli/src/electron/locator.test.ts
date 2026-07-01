// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { locateDesktopApp } from './locator.js'
import { withEnvVar } from '../testUtils/env.js'
import { captureStderr } from '../testUtils/stdout.js'

test('locator returns an existing HYPERMOTION_APP_PATH override', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-locator-'))
  const appPath = path.join(dir, 'hyper-motion')

  try {
    fs.writeFileSync(appPath, '')

    await withEnvVar('HYPERMOTION_APP_PATH', appPath, async () => {
      assert.equal(await locateDesktopApp(), appPath)
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('locator trims whitespace around HYPERMOTION_APP_PATH overrides', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-locator-spaces-'))
  const appPath = path.join(dir, 'hyper-motion')

  try {
    fs.writeFileSync(appPath, '')

    await withEnvVar('HYPERMOTION_APP_PATH', `  ${appPath}  `, async () => {
      assert.equal(await locateDesktopApp(), appPath)
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('locator rejects a missing HYPERMOTION_APP_PATH override', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-locator-missing-'))
  const missingPath = path.join(dir, 'hyper-motion')

  try {
    const stderr = await captureStderr(() =>
      withEnvVar('HYPERMOTION_APP_PATH', missingPath, async () => {
        assert.equal(await locateDesktopApp(), null)
      }),
    )

    assert.match(stderr, /HYPERMOTION_APP_PATH is set/)
    assert.equal(stderr.includes(missingPath), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('locator rejects a directory HYPERMOTION_APP_PATH override', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-locator-dir-'))

  try {
    const stderr = await captureStderr(() =>
      withEnvVar('HYPERMOTION_APP_PATH', dir, async () => {
        assert.equal(await locateDesktopApp(), null)
      }),
    )

    assert.match(stderr, /HYPERMOTION_APP_PATH is set/)
    assert.equal(stderr.includes(dir), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('locator treats an empty HYPERMOTION_APP_PATH as unset', async () => {
  let locatedPath: string | null = null

  const stderr = await captureStderr(() =>
    withEnvVar('HYPERMOTION_APP_PATH', '', async () => {
      locatedPath = await locateDesktopApp()
    }),
  )

  assert.equal(stderr, '')
  if (locatedPath !== null) {
    assert.equal(fs.existsSync(locatedPath), true)
  }
})

test('locator treats a whitespace-only HYPERMOTION_APP_PATH as unset', async () => {
  let locatedPath: string | null = null

  const stderr = await captureStderr(() =>
    withEnvVar('HYPERMOTION_APP_PATH', '   ', async () => {
      locatedPath = await locateDesktopApp()
    }),
  )

  assert.equal(stderr, '')
  if (locatedPath !== null) {
    assert.equal(fs.existsSync(locatedPath), true)
  }
})
