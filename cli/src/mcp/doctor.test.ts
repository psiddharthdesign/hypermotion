// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { DoctorReport } from '../commands/doctor.js'
import { withEnvVar } from '../testUtils/env.js'
import { assertToolText } from '../testUtils/mcp.js'
import { captureStderr } from '../testUtils/stdout.js'
import { doctorTool, handleDoctor } from './tools/doctor.js'

test('doctor input schema accepts no arguments', () => {
  assert.deepEqual(doctorTool.inputSchema, {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  })
})

test('doctor rejects unknown arguments as MCP errors', async () => {
  const result = await handleDoctor({ verbose: true })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^doctor: invalid arguments/)
  assert.match(assertToolText(result), /Unrecognized key/)
})

test('doctor returns the report as MCP JSON content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-doctor-missing-'))
  try {
    const state: { result?: Awaited<ReturnType<typeof handleDoctor>> } = {}
    const stderr = await captureStderr(() =>
      withEnvVar('HYPERMOTION_APP_PATH', path.join(dir, 'hyper-motion'), async () => {
        state.result = await handleDoctor()
      }),
    )

    assert.match(stderr, /HYPERMOTION_APP_PATH is set/)
    const { result } = state
    if (result === undefined) throw new Error('doctor result was not produced')
    assert.equal(result.isError, undefined)
    const report = JSON.parse(assertToolText(result)) as DoctorReport

    assert.equal(report.ok, false)
    assert.equal(report.desktopApp.found, false)
    assert.equal(report.desktopApp.path, null)
    assert.ok(report.mcpTools.includes('doctor'))
    assert.ok(report.commands.includes('doctor'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
