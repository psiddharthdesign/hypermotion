// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { validateScene, type SceneValidationResult } from '../scene/build.js'

type ValidateCommandOptions = {
  json?: boolean
}

export function validateCommand(): Command {
  return new Command('validate')
    .description('Validate a .hype scene file for agent-editable structural consistency.')
    .argument('<scene>', 'Path to a .hype scene file')
    .option('--json', 'Output validation result as JSON')
    .action((scenePath: string, options: ValidateCommandOptions) => {
      const trimmedScenePath = scenePath.trim()
      if (!trimmedScenePath) {
        console.error('[validate] scene path is required')
        process.exit(2)
      }

      const resolvedScenePath = path.resolve(trimmedScenePath)
      let bytes: Buffer
      let result: SceneValidationResult
      let stats: fs.Stats
      try {
        stats = fs.statSync(resolvedScenePath)
      } catch (err) {
        console.error(
          `[validate] failed to read ${resolvedScenePath}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }
      if (!stats.isFile()) {
        console.error(`[validate] scene path is not a file: ${resolvedScenePath}`)
        process.exit(2)
      }
      try {
        bytes = fs.readFileSync(resolvedScenePath)
      } catch (err) {
        console.error(
          `[validate] failed to read ${resolvedScenePath}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }
      try {
        result = validateScene(new Uint8Array(bytes))
      } catch (err) {
        console.error(
          `[validate] ${resolvedScenePath} doesn't look like a valid .hype file: ${
            err instanceof Error ? err.message : err
          }`,
        )
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
