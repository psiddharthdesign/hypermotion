// SPDX-License-Identifier: Apache-2.0

import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { applyScenePatch, type ScenePatch, type PatchOperation } from '../scene/build.js'

interface PatchCommandOptions {
  from: string
  output?: string
}

export function patchCommand(): Command {
  return new Command('patch')
    .description('Apply targeted JSON patch operations to a .hype scene file.')
    .argument('<scene>', 'Path to the input .hype scene file')
    .requiredOption('-f, --from <json>', 'Patch JSON file. Use "-" to read from stdin.')
    .option('-o, --output <path>', 'Path to write. Defaults to overwriting <scene>.')
    .action(async (scenePath: string, options: PatchCommandOptions) => {
      const trimmedScenePath = scenePath.trim()
      if (!trimmedScenePath) {
        console.error('[patch] scene path is required')
        process.exit(2)
      }

      const resolvedScenePath = path.resolve(trimmedScenePath)
      const trimmedOutputPath = options.output?.trim()
      const output = path.resolve(trimmedOutputPath || trimmedScenePath)
      let sceneBytes: Buffer
      let stats: fs.Stats
      try {
        stats = fs.statSync(resolvedScenePath)
      } catch (err) {
        console.error(`[patch] failed to read ${resolvedScenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
      if (!stats.isFile()) {
        console.error(`[patch] scene path is not a file: ${resolvedScenePath}`)
        process.exit(2)
      }
      try {
        sceneBytes = fs.readFileSync(resolvedScenePath)
      } catch (err) {
        console.error(`[patch] failed to read ${resolvedScenePath}: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }

      let patch: unknown
      try {
        const raw = options.from === '-' ? await readStdin() : fs.readFileSync(options.from, 'utf-8')
        patch = JSON.parse(raw)
      } catch (err) {
        console.error(`[patch] failed to read patch: ${err instanceof Error ? err.message : err}`)
        process.exit(2)
      }
      if (typeof patch !== 'object' || patch == null) {
        console.error('[patch] patch JSON must be an array or object at the top level.')
        process.exit(2)
      }

      let next: Uint8Array
      try {
        next = applyScenePatch(new Uint8Array(sceneBytes), patch as ScenePatch | PatchOperation[])
      } catch (err) {
        console.error(`[patch] failed to apply patch: ${err instanceof Error ? err.message : err}`)
        process.exit(1)
      }

      fs.mkdirSync(path.dirname(output), { recursive: true })
      fs.writeFileSync(output, Buffer.from(next))
      console.log(`Patched ${resolvedScenePath} → ${output}`)
    })
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk: string) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}
