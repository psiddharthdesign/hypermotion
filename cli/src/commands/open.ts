// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { locateDesktopApp } from '../electron/locator.js'

interface OpenCommandDeps {
  locateApp: typeof locateDesktopApp
  spawnApp: (
    command: string,
    args: string[],
    options: { detached: true; stdio: 'ignore' },
  ) => Pick<ChildProcess, 'unref'>
}

const defaultDeps: OpenCommandDeps = {
  locateApp: locateDesktopApp,
  spawnApp: spawn,
}

export function openCommand(deps: OpenCommandDeps = defaultDeps): Command {
  return new Command('open')
    .description('Open a .hype scene file in the hyper-motion desktop app.')
    .argument('<scene>', 'Path to a .hype scene file')
    .action(async (scene: string) => {
      const scenePath = path.resolve(scene)
      if (!fs.existsSync(scenePath)) {
        console.error(`[open] scene file not found: ${scenePath}`)
        process.exit(2)
      }
      if (!fs.statSync(scenePath).isFile()) {
        console.error(`[open] scene path is not a file: ${scenePath}`)
        process.exit(2)
      }
      const appPath = await deps.locateApp()
      if (!appPath) {
        console.error('[open] hyper-motion desktop app not found.')
        process.exit(1)
      }
      const child = deps.spawnApp(appPath, [scenePath], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      console.log(`Opened ${scenePath}`)
    })
}
