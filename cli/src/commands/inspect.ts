// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { inspectScene } from '../scene/build.js'

type InspectCommandOptions = {
  json: boolean
}

export function inspectCommand(): Command {
  return new Command('inspect')
    .description('Print the full editable scene graph for a .hype file.')
    .argument('<scene>', 'Path to a .hype scene file')
    .option('--json', 'Output JSON (default)', true)
    .action((scenePath: string, _options: InspectCommandOptions) => {
      const resolvedScenePath = path.resolve(scenePath)
      let bytes: Buffer
      let stat: fs.Stats
      try {
        stat = fs.statSync(resolvedScenePath)
      } catch (err) {
        console.error(`[inspect] failed to read ${resolvedScenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
      if (!stat.isFile()) {
        console.error(`[inspect] scene path is not a file: ${resolvedScenePath}`)
        process.exit(2)
      }
      try {
        bytes = fs.readFileSync(resolvedScenePath)
      } catch (err) {
        console.error(`[inspect] failed to read ${resolvedScenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
      try {
        process.stdout.write(JSON.stringify(inspectScene(new Uint8Array(bytes)), null, 2) + '\n')
      } catch (err) {
        console.error(`[inspect] failed to inspect ${resolvedScenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
    })
}
