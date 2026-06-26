// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import fs from 'node:fs'
import { inspectScene } from '../scene/build.js'

export function inspectCommand(): Command {
  return new Command('inspect')
    .description('Print the full editable scene graph for a .hype file.')
    .argument('<scene>', 'Path to a .hype scene file')
    .option('--json', 'Output JSON (default)', true)
    .action((scenePath: string) => {
      let bytes: Buffer
      try {
        bytes = fs.readFileSync(scenePath)
      } catch (err) {
        console.error(`[inspect] failed to read ${scenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
      try {
        process.stdout.write(JSON.stringify(inspectScene(new Uint8Array(bytes)), null, 2) + '\n')
      } catch (err) {
        console.error(`[inspect] failed to inspect ${scenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
    })
}
