// SPDX-License-Identifier: Apache-2.0

/**
 * `hypermotion create <output.hype> --from <scene.json>` — author a
 * scene file from a plain JSON description.
 *
 * A script, agent, or other external tool can produce the JSON scene
 * shape; this command writes a `.hype` byte stream the desktop app can
 * open. No desktop app launch required — the CLI builds the Y.Doc
 * directly.
 *
 * JSON shape: see `cli/src/scene/build.ts` (`SceneJson`). At minimum:
 *
 *   {
 *     "meta": { "name": "My scene", "canvas": { "width": 1080, "height": 1920 } },
 *     "nodes": {
 *       "root":   {
 *         "id": "root",
 *         "kind": "frame",
 *         "parent": null,
 *         "children": ["text"],
 *         "size": { "width": 1080, "height": 1920 },
 *         "layout": {
 *           "mode": "flex",
 *           "direction": "column",
 *           "justify": "center",
 *           "align": "center",
 *           "padding": { "top": 24, "right": 24, "bottom": 24, "left": 24 }
 *         }
 *       },
 *       "text":   { "id": "text", "kind": "text", "parent": "root", "text": "Hello" },
 *       "camera": {
 *         "id": "camera",
 *         "kind": "camera",
 *         "parent": null,
 *         "transform": { "x": 540, "y": 960, "z": 0, "rotation": 0, "scaleX": 1, "scaleY": 1 }
 *       }
 *     }
 *   }
 *
 * Tracks for keyframe animations are optional and slot in under a
 * top-level `tracks` map keyed by track id.
 */

import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { buildSceneBytes, readSceneSummary, type SceneJson } from '../scene/build.js'

interface CreateCommandOptions {
  from?: string
}

export function createCommand(): Command {
  return new Command('create')
    .description(
      'Build a .hype scene file from a plain JSON description. The desktop ' +
        'app can open the result directly.',
    )
    .argument('<output>', 'Path to write the .hype file to')
    .option(
      '-f, --from <json>',
      'Path to a JSON file describing the scene. Use "-" to read from stdin.',
    )
    .action(async (output: string, options: CreateCommandOptions) => {
      const trimmedOutput = output.trim()
      if (!trimmedOutput) {
        console.error('[create] output path is required')
        process.exit(2)
      }

      const source =
        options.from === undefined ? '-' : options.from.trim()
      if (!source) {
        console.error('[create] scene JSON source path is required')
        process.exit(2)
      }

      let raw: string
      try {
        raw = source === '-' ? await readStdin() : fs.readFileSync(source, 'utf-8')
      } catch (err) {
        console.error(
          `[create] failed to read scene JSON from ${source === '-' ? 'stdin' : source}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }

      let json: SceneJson
      try {
        json = JSON.parse(raw) as SceneJson
      } catch (err) {
        console.error(
          `[create] scene JSON is not valid JSON: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(2)
      }

      if (typeof json !== 'object' || json == null || Array.isArray(json)) {
        console.error('[create] scene JSON must be an object at the top level.')
        process.exit(2)
      }

      // Build the Y.Doc bytes. This is pure data work — no desktop app
      // needed, no IndexedDB, no React. Just JSON → Y.Doc → bytes.
      let bytes: Uint8Array
      try {
        bytes = buildSceneBytes(json)
      } catch (err) {
        console.error(
          `[create] failed to build scene: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(1)
      }

      // Make sure the output's parent directory exists. Tools and
      // agents tend to specify deeply-nested paths; we don't want a
      // simple ENOENT to obscure the real error.
      const outputPath = path.resolve(trimmedOutput)
      const outDir = path.dirname(outputPath)
      try {
        fs.mkdirSync(outDir, { recursive: true })
      } catch (err) {
        console.error(
          `[create] failed to create output directory ${outDir}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(1)
      }

      try {
        fs.writeFileSync(outputPath, Buffer.from(bytes))
      } catch (err) {
        console.error(
          `[create] failed to write ${outputPath}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(1)
      }

      const summary = readSceneSummary(bytes)
      const layers = summary.layerCount
      const tracks = summary.trackCount
      console.log(
        `Wrote ${outputPath} (${formatBytes(bytes.length)}, ${layers} layer${layers === 1 ? '' : 's'}, ${tracks} track${tracks === 1 ? '' : 's'})`,
      )
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
