// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { locateDesktopApp } from '../electron/locator.js'

export function openCommand(): Command {
  return new Command('open')
    .description('Open a .hype scene file in the hyper-motion desktop app.')
    .argument('<scene>', 'Path to a .hype scene file')
    .action(async (scene: string) => {
      const scenePath = path.resolve(scene)
      if (!fs.existsSync(scenePath)) {
        console.error(`[open] scene file not found: ${scenePath}`)
        process.exit(2)
      }
      const appPath = await locateDesktopApp()
      if (!appPath) {
        console.error('[open] hyper-motion desktop app not found.')
        process.exit(1)
      }
      const child = spawn(appPath, [scenePath], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      console.log(`Opened ${scenePath}`)
    })
}
