// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import test from 'node:test'
import type { DoctorReport } from '../commands/doctor.js'
import { captureStderr } from '../testUtils/stdout.js'
import { doctorTool, handleDoctor } from './tools/doctor.js'

test('doctor input schema accepts no arguments', () => {
  assert.deepEqual(doctorTool.inputSchema, {
    type: 'object',
    properties: {},
  })
})

test('doctor returns the report as MCP JSON content', async () => {
  const previousAppPath = process.env.HYPERMOTION_APP_PATH
  process.env.HYPERMOTION_APP_PATH = '/tmp/hypermotion-mcp-doctor-missing-app'

  try {
    const state: { result?: Awaited<ReturnType<typeof handleDoctor>> } = {}
    const stderr = await captureStderr(async () => {
      state.result = await handleDoctor()
    })

    assert.match(stderr, /HYPERMOTION_APP_PATH is set/)
    const { result } = state
    if (result === undefined) throw new Error('doctor result was not produced')
    assert.equal(result.isError, undefined)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    const report = JSON.parse(text) as DoctorReport

    assert.equal(report.ok, false)
    assert.equal(report.desktopApp.found, false)
    assert.equal(report.desktopApp.path, null)
    assert.ok(report.mcpTools.includes('doctor'))
    assert.ok(report.commands.includes('doctor'))
  } finally {
    if (previousAppPath === undefined) {
      delete process.env.HYPERMOTION_APP_PATH
    } else {
      process.env.HYPERMOTION_APP_PATH = previousAppPath
    }
  }
})
