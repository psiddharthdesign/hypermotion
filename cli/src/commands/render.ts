// SPDX-License-Identifier: Apache-2.0

/**
 * `hypermotion render -o <out>`
 *
 * Renders the user's current hyper-motion scene (whatever was last
 * persisted to IndexedDB by the desktop app) to MP4, WebM, or GIF.
 * Internally shells out to the installed desktop app, which opens an
 * off-screen window, loads the scene, runs the export pipeline, and
 * writes the rendered file to `<out>`.
 *
 * `--scene <path>` renders a saved .hype file; without it, the current
 * desktop scene is rendered.
 */

import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs'
import { locateDesktopApp } from '../electron/locator.js'
import { driveHeadlessRender, type HeadlessRenderRequest } from '../electron/driver.js'
import {
  RENDER_FORMATS,
  RENDER_QUALITIES,
  type RenderFormat,
  type RenderQuality,
} from '../renderOptions.js'

const FORMAT_HELP = RENDER_FORMATS.join(' / ')
const QUALITY_HELP = RENDER_QUALITIES.join(' / ')

interface RenderOptions {
  output: string
  format?: string
  quality?: string
  fps?: string
  scene?: string
}

interface RenderCommandDeps {
  locateApp?: () => Promise<string | null>
  driveRender?: (req: HeadlessRenderRequest) => Promise<void>
}

export function renderCommand(deps: RenderCommandDeps = {}): Command {
  const locateApp = deps.locateApp ?? locateDesktopApp
  const driveRender = deps.driveRender ?? driveHeadlessRender

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
      'Path to a .hype scene file to forward to the desktop app',
    )
    .action(async (opts: RenderOptions) => {
      const outputPath = path.resolve(opts.output)

      const requestedFormat = opts.format ?? inferFormat(outputPath)
      if (!isFormat(requestedFormat)) {
        console.error(`[render] unsupported format: ${requestedFormat} (use ${FORMAT_HELP})`)
        process.exit(1)
      }
      const format = requestedFormat

      const requestedQuality = opts.quality ?? 'comp'
      if (!isQuality(requestedQuality)) {
        console.error(`[render] unsupported quality: ${requestedQuality} (use ${QUALITY_HELP})`)
        process.exit(1)
      }
      const quality = requestedQuality

      const fps = Number(opts.fps ?? '30')
      if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
        console.error(`[render] invalid fps: ${opts.fps}`)
        process.exit(1)
      }

      // Make sure the output directory exists so the desktop app's
      // post-render write doesn't fail on a missing parent.
      const outDir = path.dirname(outputPath)
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true })
      }

      const scenePath = opts.scene ? path.resolve(opts.scene) : undefined
      if (scenePath && !fs.existsSync(scenePath)) {
        console.error(`[render] scene file not found: ${scenePath}`)
        process.exit(2)
      }
      if (scenePath && !fs.statSync(scenePath).isFile()) {
        console.error(`[render] scene path is not a file: ${scenePath}`)
        process.exit(2)
      }

      const appPath = await locateApp()
      if (!appPath) {
        console.error(
          '[render] hyper-motion desktop app not found.\n' +
            '         Install from https://hypermotion.app, then retry.',
        )
        process.exit(1)
      }

      console.log(`[render] output:  ${outputPath}`)
      if (scenePath) console.log(`[render] scene:   ${scenePath}`)
      console.log(`[render] format:  ${format} @ ${quality} · ${fps}fps`)
      console.log(`[render] driver:  ${appPath}`)
      console.log(`[render] running… (the desktop app launches off-screen)`)

      try {
        await driveRender({
          appPath,
          outputPath,
          format,
          quality,
          fps,
          scenePath,
        })
        console.log(`[render] ✓ wrote ${outputPath}`)
      } catch (err) {
        console.error('[render] failed:', err instanceof Error ? err.message : err)
        process.exit(1)
      }
    })
}

function inferFormat(outPath: string): RenderFormat {
  const ext = path.extname(outPath).toLowerCase().slice(1)
  if (isFormat(ext)) return ext
  return 'mp4'
}

function isFormat(value: string): value is RenderFormat {
  return RENDER_FORMATS.includes(value as RenderFormat)
}

function isQuality(value: string): value is RenderQuality {
  return RENDER_QUALITIES.includes(value as RenderQuality)
}
