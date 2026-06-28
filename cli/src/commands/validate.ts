// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import fs from 'node:fs'
import { validateScene, type SceneValidationResult } from '../scene/build.js'

export function validateCommand(): Command {
  return new Command('validate')
    .description('Validate a .hype scene file for agent-editable structural consistency.')
    .argument('<scene>', 'Path to a .hype scene file')
    .option('--json', 'Output validation result as JSON')
    .action((scenePath: string, options: { json?: boolean }) => {
      let bytes: Buffer
      let result: SceneValidationResult
      try {
        bytes = fs.readFileSync(scenePath)
      } catch (err) {
        console.error(`[validate] failed to read ${scenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
      try {
        result = validateScene(new Uint8Array(bytes))
      } catch (err) {
        console.error(`[validate] ${scenePath} doesn't look like a valid .hype file: ${err instanceof Error ? err.message : err}`)
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
