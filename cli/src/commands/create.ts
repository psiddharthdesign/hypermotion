// SPDX-License-Identifier: Apache-2.0

/**
 * `hypermotion create <output.hype> --from <scene.json>` — author a
 * scene file from a plain JSON description.
 *
 * The agent (or any external tool) produces a JSON scene shape, this
 * command writes a `.hype` byte stream the desktop app can open. No
 * desktop app launch required — the CLI builds the Y.Doc directly.
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
 *         "layout": { "mode": "none" }
 *       },
 *       "text":   { "id": "text", "kind": "text", "parent": "root", "text": "Hello" },
 *       "camera": { "id": "camera", "kind": "camera", "parent": null }
 *     }
 *   }
 *
 * Tracks for keyframe animations are optional and slot in under a
 * top-level `tracks` map keyed by track id.
 */

import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { buildSceneBytes, type SceneJson } from '../scene/build.js'

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
    .action(async (output: string, options: { from?: string }) => {
      const source = options.from ?? '-'
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

      if (typeof json !== 'object' || json == null) {
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
      const outDir = path.dirname(path.resolve(output))
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
        fs.writeFileSync(output, Buffer.from(bytes))
      } catch (err) {
        console.error(
          `[create] failed to write ${output}: ${
            err instanceof Error ? err.message : err
          }`,
        )
        process.exit(1)
      }

      const layers = Object.keys(json.nodes ?? {}).length
      const tracks = Object.keys(json.tracks ?? {}).length
      console.log(
        `Wrote ${output} (${formatBytes(bytes.length)}, ${layers} layer${layers === 1 ? '' : 's'}, ${tracks} track${tracks === 1 ? '' : 's'})`,
      )
    })
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => {
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
