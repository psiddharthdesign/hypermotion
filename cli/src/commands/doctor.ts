// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import os from 'node:os'
import { locateDesktopApp } from '../electron/locator.js'
import { MCP_TOOLS } from '../mcp/tools/capabilities.js'
import { RENDER_FORMATS, RENDER_QUALITIES } from '../renderOptions.js'
import { CLI_VERSION } from '../version.js'

export interface DoctorReport {
  ok: boolean
  cliVersion: string
  platform: NodeJS.Platform
  desktopApp: {
    found: boolean
    path: string | null
  }
  sceneFormat: {
    extension: string
    encoding: string
  }
  commands: string[]
  mcpTools: string[]
  render: {
    formats: string[]
    qualities: string[]
    fileSceneInput: boolean
  }
}

type DoctorCommandOptions = {
  json?: boolean
}

export async function getDoctorReport(): Promise<DoctorReport> {
  const appPath = await locateDesktopApp()
  return {
    ok: Boolean(appPath),
    cliVersion: CLI_VERSION,
    platform: os.platform(),
    desktopApp: {
      found: Boolean(appPath),
      path: appPath,
    },
    sceneFormat: {
      extension: '.hype',
      encoding: 'Y.encodeStateAsUpdate',
    },
    commands: [
      'create',
      'info',
      'inspect',
      'patch',
      'validate',
      'open',
      'render',
      'doctor',
      'serve --mcp',
    ],
    mcpTools: [...MCP_TOOLS],
    render: {
      formats: [...RENDER_FORMATS],
      qualities: [...RENDER_QUALITIES],
      fileSceneInput: true,
    },
  }
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Check hyper-motion CLI, desktop app, and agent tool capabilities.')
    .option('--json', 'Output the report as JSON')
    .action(async (options: DoctorCommandOptions) => {
      const report = await getDoctorReport()
      if (options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n')
        return
      }
      console.log(`CLI: ${report.cliVersion}`)
      console.log(`Platform: ${report.platform}`)
      console.log(`Desktop app: ${report.desktopApp.found ? report.desktopApp.path : 'not found'}`)
      console.log(`Scene format: ${report.sceneFormat.extension}`)
      if (!report.ok) process.exitCode = 1
    })
}
