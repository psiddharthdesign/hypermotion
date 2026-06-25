// SPDX-License-Identifier: Apache-2.0

/**
 * `hypermotion render -o <out>`
 *
 * Renders the user's current hyper-motion scene (whatever was last
 * persisted to IndexedDB by the desktop app) to MP4, WebM, or GIF.
 * Internally shells out to the installed desktop app, which opens an
 * off-screen window, loads the scene, runs the export pipeline, and
 * ships the bytes back. The CLI writes them to `<out>`.
 *
 * Current scope: renders the CURRENT scene. A future `--scene <path>`
 * flag will render arbitrary `.hype` files once file-based headless
 * rendering lands.
 */

import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs'
import { locateDesktopApp } from '../electron/locator.js'
import { driveHeadlessRender } from '../electron/driver.js'

type Format = 'mp4' | 'webm' | 'gif'
type Quality = 'comp' | '720p' | '2k' | '4k'

interface RenderOptions {
  output: string
  format?: string
  quality?: string
  fps?: string
  scene?: string
}

export function renderCommand(): Command {
  return new Command('render')
    .description(
      "Render the current scene (whatever's loaded in the desktop app) " +
        'to MP4, WebM, or GIF.',
    )
    .requiredOption('-o, --output <path>', 'Output file path')
    .option(
      '-f, --format <format>',
      'Output format: mp4 | webm | gif (default inferred from output extension)',
    )
    .option(
      '-q, --quality <quality>',
      'Quality: comp (match comp) | 720p | 2k | 4k',
      'comp',
    )
    .option('--fps <n>', 'Frame rate', '30')
    .option(
      '--scene <path>',
      'Path to a .hype file. NOTE: file-based headless rendering is not ' +
        'available yet; this flag is accepted but ignored and the current desktop ' +
        'scene is rendered instead.',
    )
    .action(async (opts: RenderOptions) => {
      const outputPath = path.resolve(opts.output)

      const format = (opts.format ?? inferFormat(outputPath)) as Format
      if (!['mp4', 'webm', 'gif'].includes(format)) {
        console.error(`[render] unsupported format: ${format} (use mp4 / webm / gif)`)
        process.exit(1)
      }

      const quality = (opts.quality ?? 'comp') as Quality
      if (!['comp', '720p', '2k', '4k'].includes(quality)) {
        console.error(`[render] unsupported quality: ${quality} (use comp / 720p / 2k / 4k)`)
        process.exit(1)
      }

      const fps = Number(opts.fps ?? '30')
      if (!Number.isFinite(fps) || fps <= 0) {
        console.error(`[render] invalid fps: ${opts.fps}`)
        process.exit(1)
      }

      const appPath = await locateDesktopApp()
      if (!appPath) {
        console.error(
          '[render] hyper-motion desktop app not found.\n' +
            '         Install from https://hypermotion.app, then retry.',
        )
        process.exit(1)
      }

      // Make sure the output directory exists so the desktop app's
      // post-render write doesn't fail on a missing parent.
      const outDir = path.dirname(outputPath)
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true })
      }

      if (opts.scene) {
        console.warn(
          '[render] note: --scene is reserved for file-based headless rendering. ' +
            'Ignoring; rendering the current desktop scene.',
        )
      }

      console.log(`[render] output:  ${outputPath}`)
      console.log(`[render] format:  ${format} @ ${quality} · ${fps}fps`)
      console.log(`[render] driver:  ${appPath}`)
      console.log(`[render] running… (the desktop app launches off-screen)`)

      try {
        await driveHeadlessRender({
          appPath,
          outputPath,
          format,
          quality,
          fps,
        })
        console.log(`[render] ✓ wrote ${outputPath}`)
      } catch (err) {
        console.error('[render] failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    })
}

function inferFormat(outPath: string): Format {
  const ext = path.extname(outPath).toLowerCase().slice(1)
  if (ext === 'mp4' || ext === 'webm' || ext === 'gif') return ext
  return 'mp4'
}
