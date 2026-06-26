// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import fs from 'node:fs'
import { validateScene } from '../scene/build.js'

type ValidateCommandOptions = {
  json?: boolean
}

export function validateCommand(): Command {
  return new Command('validate')
    .description('Validate a .hype scene file for agent-editable structural consistency.')
    .argument('<scene>', 'Path to a .hype scene file')
    .option('--json', 'Output validation result as JSON')
    .action((scenePath: string, options: ValidateCommandOptions) => {
      let result: ReturnType<typeof validateScene>
      try {
        result = validateScene(new Uint8Array(fs.readFileSync(scenePath)))
      } catch (err) {
        console.error(`[validate] failed to read ${scenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else {
        console.log(result.ok ? 'Scene is valid' : 'Scene is invalid')
        for (const error of result.errors) console.log(`error: ${error}`)
        for (const warning of result.warnings) console.log(`warning: ${warning}`)
      }
      if (!result.ok) process.exitCode = 1
    })
}
