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

type PrintableTiming = {
  readonly duration: number
  readonly frameRate: number
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
      const timing = printableTiming(meta.duration, meta.frameRate)
      const name = printableSceneName(meta.name)

      console.log(`Scene: ${name}`)
      console.log(`  Canvas:    ${canvas.width} × ${canvas.height}`)
      console.log(`  Duration:  ${timing.duration}s @ ${timing.frameRate}fps`)
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
  if (isRecord(canvas)) {
    const width = canvas.width ?? '?'
    const height = canvas.height ?? '?'

    return {
      width: printableCanvasValue(width),
      height: printableCanvasValue(height),
    }
  }

  return { width: '?', height: '?' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function printableCanvasValue(value: unknown): number | '?' {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return '?'
}

function printableTiming(duration: unknown, frameRate: unknown): PrintableTiming {
  return {
    duration: printableTimingValue(duration, 0),
    frameRate: printableTimingValue(frameRate, 60),
  }
}

function printableTimingValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

function printableSceneName(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return '(unnamed)'
}
