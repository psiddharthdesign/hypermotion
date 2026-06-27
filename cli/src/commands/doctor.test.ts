// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { captureStderr } from '../testUtils/stdout.js'
import { getDoctorReport } from './doctor.js'

test('doctor report lists supported commands and MCP tools once', async () => {
  const previousAppPath = process.env.HYPERMOTION_APP_PATH
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-doctor-missing-'))
  process.env.HYPERMOTION_APP_PATH = path.join(dir, 'hyper-motion')

  try {
    const state: { report?: Awaited<ReturnType<typeof getDoctorReport>> } = {}
    const stderr = await captureStderr(async () => {
      state.report = await getDoctorReport()
    })

    assert.match(stderr, /HYPERMOTION_APP_PATH is set/)
    const { report } = state
    if (report === undefined) throw new Error('doctor report was not produced')
    assert.equal(report.ok, false)
    assert.equal(new Set(report.commands).size, report.commands.length)
    assert.equal(new Set(report.mcpTools).size, report.mcpTools.length)
    assert.ok(report.commands.includes('doctor'))
    assert.ok(report.commands.includes('serve --mcp'))
    assert.ok(report.mcpTools.includes('doctor'))
    assert.ok(report.mcpTools.includes('get_capabilities'))
    assert.ok(report.mcpTools.includes('render_scene'))
    assert.equal(report.render.fileSceneInput, true)
  } finally {
    if (previousAppPath === undefined) {
      delete process.env.HYPERMOTION_APP_PATH
    } else {
      process.env.HYPERMOTION_APP_PATH = previousAppPath
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
