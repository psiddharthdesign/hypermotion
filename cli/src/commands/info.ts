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
import path from 'node:path'
import { readSceneSummary, type SceneSummary } from '../scene/build.js'

type InfoCommandOptions = {
  readonly json?: boolean
}

type PrintableCanvas = {
  readonly width: number | '?'
  readonly height: number | '?'
}

export function infoCommand(): Command {
  return new Command('info')
    .description('Read a .hype scene file and print a summary.')
    .argument('<scene>', 'Path to a .hype scene file')
    .option('--json', 'Output the summary as JSON for scripting')
    .action((scenePath: string, options: InfoCommandOptions) => {
      const trimmedScenePath = scenePath.trim()
      if (!trimmedScenePath) {
        console.error('[info] scene path is required')
        process.exit(2)
      }

      const resolvedScenePath = path.resolve(trimmedScenePath)
      let bytes: Buffer
      let stats: fs.Stats
      try {
        stats = fs.statSync(resolvedScenePath)
      } catch (err) {
        console.error(
          `[info] failed to read ${resolvedScenePath}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }
      if (!stats.isFile()) {
        console.error(`[info] scene path is not a file: ${resolvedScenePath}`)
        process.exit(2)
      }
      try {
        bytes = fs.readFileSync(resolvedScenePath)
      } catch (err) {
        console.error(
          `[info] failed to read ${resolvedScenePath}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }

      let summary: SceneSummary
      try {
        summary = readSceneSummary(new Uint8Array(bytes))
      } catch (err) {
        console.error(
          `[info] ${resolvedScenePath} doesn't look like a valid .hype file: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }

      if (options.json) {
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
        return
      }

      const { meta } = summary
      const canvas = printableCanvas(meta.canvas)
      const name = printableSceneName(meta.name)
      const duration = meta.duration ?? 0
      const frameRate = meta.frameRate ?? 60

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

function printableCanvas(canvas: unknown): PrintableCanvas {
  if (canvas && typeof canvas === 'object') {
    const width = 'width' in canvas ? canvas.width : '?'
    const height = 'height' in canvas ? canvas.height : '?'

    return {
      width: printableCanvasValue(width),
      height: printableCanvasValue(height),
    }
  }

  return { width: '?', height: '?' }
}

function printableCanvasValue(value: unknown): number | '?' {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return '?'
}

function printableSceneName(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return '(unnamed)'
}
