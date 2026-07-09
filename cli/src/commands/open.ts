// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import { spawn } from 'node:child_process'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { locateDesktopApp } from '../electron/locator.js'

type OpenSpawnOptions = Readonly<Pick<SpawnOptions, 'detached' | 'stdio'>>

export interface OpenCommandDeps {
  readonly locateApp: typeof locateDesktopApp
  readonly existsSync: typeof fs.existsSync
  readonly statSync: typeof fs.statSync
  readonly spawnApp: (
    command: string,
    args: string[],
    options: OpenSpawnOptions,
  ) => Pick<ChildProcess, 'unref'>
}

const defaultDeps: OpenCommandDeps = {
  locateApp: locateDesktopApp,
  existsSync: fs.existsSync,
  statSync: fs.statSync,
  spawnApp: spawn,
}

export function openCommand(deps: Partial<OpenCommandDeps> = {}): Command {
  const commandDeps = { ...defaultDeps, ...deps }
  return new Command('open')
    .description('Open a .hype scene file in the hyper-motion desktop app.')
    .argument('<scene>', 'Path to a .hype scene file')
    .action(async (scene: string) => {
      const trimmedScenePath = scene.trim()
      if (!trimmedScenePath) {
        console.error('[open] scene path is required')
        process.exit(2)
      }

      const scenePath = path.resolve(trimmedScenePath)
      if (!commandDeps.existsSync(scenePath)) {
        console.error(`[open] scene file not found: ${scenePath}`)
        process.exit(2)
      }
      let stats: fs.Stats
      try {
        stats = commandDeps.statSync(scenePath)
      } catch (err) {
        console.error(
          `[open] failed to read ${scenePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        process.exit(2)
      }
      if (!stats.isFile()) {
        console.error(`[open] scene path is not a file: ${scenePath}`)
        process.exit(2)
      }
      const appPath = await commandDeps.locateApp()
      if (!appPath) {
        console.error('[open] hyper-motion desktop app not found.')
        process.exit(1)
      }
      let child: Pick<ChildProcess, 'unref'>
      try {
        child = commandDeps.spawnApp(appPath, [scenePath], {
          detached: true,
          stdio: 'ignore',
        })
      } catch (err) {
        console.error(
          `[open] failed to open ${scenePath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        process.exit(1)
      }
      child.unref()
      console.log(`Opened ${scenePath}`)
    })
}
