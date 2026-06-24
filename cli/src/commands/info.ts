// SPDX-License-Identifier: Apache-2.0

/**
 * `hypermotion info <scene>` — read a `.hype` scene file and print a
 * summary of its meta, layer, track, section, keyframe, root, and
 * active camera fields.
 *
 * No desktop app required — the CLI parses `.hype` bytes directly.
 */

import { Command } from 'commander'
import fs from 'node:fs'
import { readSceneSummary } from '../scene/build.js'

export function infoCommand(): Command {
  return new Command('info')
    .description('Read a .hype scene file and print a summary.')
    .argument('<scene>', 'Path to a .hype scene file')
    .option('--json', 'Output the summary as JSON for scripting')
    .action((scenePath: string, options: { json?: boolean }) => {
      let bytes: Buffer
      try {
        bytes = fs.readFileSync(scenePath)
      } catch (err) {
        console.error(
          `[info] failed to read ${scenePath}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }

      let summary: ReturnType<typeof readSceneSummary>
      try {
        summary = readSceneSummary(new Uint8Array(bytes))
      } catch (err) {
        console.error(
          `[info] ${scenePath} doesn't look like a valid .hype file: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }

      if (options.json) {
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
        return
      }

      const m = summary.meta as Record<string, unknown>
      const canvas = (m.canvas ?? { width: '?', height: '?' }) as {
        width: number | string
        height: number | string
      }
      const name = (m.name as string | undefined) ?? '(unnamed)'
      const duration = (m.duration as number | undefined) ?? 0
      const frameRate = (m.frameRate as number | undefined) ?? 60

      console.log(`Scene: ${name}`)
      console.log(`  Canvas:    ${canvas.width} × ${canvas.height}`)
      console.log(`  Duration:  ${duration}s @ ${frameRate}fps`)
      console.log(`  Layers:    ${summary.layerCount}`)
      console.log(`  Tracks:    ${summary.trackCount}`)
      console.log(`  Sections:  ${summary.sectionCount}`)
      console.log(`  Keyframes: ${summary.keyframeCount}`)
      if (summary.root) console.log(`  Root id:   ${summary.root}`)
      if (summary.activeCameraId)
        console.log(`  Camera id: ${summary.activeCameraId}`)
    })
}
