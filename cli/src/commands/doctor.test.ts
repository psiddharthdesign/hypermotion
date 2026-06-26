// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import { getDoctorReport } from './doctor.js'

test('doctor report lists supported commands and MCP tools once', async () => {
  const previousAppPath = process.env.HYPERMOTION_APP_PATH
  process.env.HYPERMOTION_APP_PATH = '/tmp/hypermotion-doctor-missing-app'

  try {
    const report = await getDoctorReport()

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
  }
})
