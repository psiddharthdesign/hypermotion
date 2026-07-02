// SPDX-License-Identifier: Apache-2.0

/**
 * `hypermotion render -o <out>`
 *
 * Renders a saved `.hype` scene, or the user's current hyper-motion scene
 * (whatever was last persisted to IndexedDB by the desktop app), to MP4,
 * WebM, or GIF.
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
  inferRenderFormatFromPath,
  isRenderFormat,
  isRenderQuality,
} from '../renderOptions.js'

const FORMAT_HELP = RENDER_FORMATS.join(' / ')
const QUALITY_HELP = RENDER_QUALITIES.join(' / ')
const EMPTY_OPTION_LABEL = '<empty>'

interface RenderOptions {
  output: string
  format?: string
  quality?: string
  fps?: string
  scene?: string
}

export interface RenderCommandDeps {
  locateApp?: () => Promise<string | null>
  driveRender?: (req: HeadlessRenderRequest) => Promise<void>
  existsSync?: typeof fs.existsSync
  mkdirSync?: typeof fs.mkdirSync
  statSync?: typeof fs.statSync
}

export function renderCommand(deps: RenderCommandDeps = {}): Command {
  const locateApp = deps.locateApp ?? locateDesktopApp
  const driveRender = deps.driveRender ?? driveHeadlessRender
  const existsSync = deps.existsSync ?? fs.existsSync
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync
  const statSync = deps.statSync ?? fs.statSync

  return new Command('render')
    .description(
      'Render a saved .hype scene, or the current desktop scene, ' +
        'to MP4, WebM, or GIF.',
    )
    .requiredOption('-o, --output <path>', 'Output file path')
    .option(
      '-f, --format <format>',
      'Output format: mp4 | webm | gif (default inferred from output extension)',
    )
    .option(
      '-q, --quality <quality>',
      'Quality: comp (match scene canvas) | 720p | 2k | 4k',
      'comp',
    )
    .option('--fps <n>', 'Frame rate', '30')
    .option(
      '--scene <path>',
      'Path to a .hype scene file to forward to the desktop app',
    )
    .action(async (opts: RenderOptions) => {
      const outputInput = opts.output.trim()
      if (!outputInput) {
        console.error('[render] output path is required')
        process.exit(1)
      }
      const outputPath = path.resolve(outputInput)

      const requestedFormat =
        opts.format?.trim().toLowerCase() ?? inferRenderFormatFromPath(outputPath)
      if (!isRenderFormat(requestedFormat)) {
        console.error(
          `[render] unsupported format: ${formatOptionValue(requestedFormat)} (use ${FORMAT_HELP})`,
        )
        process.exit(1)
      }
      const format = requestedFormat

      const requestedQuality = opts.quality?.trim().toLowerCase() ?? 'comp'
      if (!isRenderQuality(requestedQuality)) {
        console.error(
          `[render] unsupported quality: ${formatOptionValue(requestedQuality)} (use ${QUALITY_HELP})`,
        )
        process.exit(1)
      }
      const quality = requestedQuality

      const fpsInput = opts.fps?.trim() ?? '30'
      const fps = Number(fpsInput)
      if (!Number.isInteger(fps) || fps <= 0 || fps > 120) {
        console.error(`[render] invalid fps: ${fpsInput}`)
        process.exit(1)
      }

      // Make sure the output directory exists so the desktop app's
      // post-render write doesn't fail on a missing parent.
      const outDir = path.dirname(outputPath)
      if (!existsSync(outDir)) {
        try {
          mkdirSync(outDir, { recursive: true })
        } catch (err) {
          console.error(
            `[render] failed to create output directory ${outDir}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
          process.exit(2)
        }
      } else {
        let outDirStats: fs.Stats
        try {
          outDirStats = statSync(outDir)
        } catch (err) {
          console.error(
            `[render] failed to read output directory ${outDir}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
          process.exit(2)
        }
        if (!outDirStats.isDirectory()) {
          console.error(`[render] output directory is not a directory: ${outDir}`)
          process.exit(2)
        }
      }

      const sceneInput = opts.scene?.trim()
      const scenePath = sceneInput ? path.resolve(sceneInput) : undefined
      if (scenePath && !existsSync(scenePath)) {
        console.error(`[render] scene file not found: ${scenePath}`)
        process.exit(2)
      }
      if (scenePath) {
        let stats: fs.Stats
        try {
          stats = statSync(scenePath)
        } catch (err) {
          console.error(
            `[render] failed to read ${scenePath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          )
          process.exit(2)
        }
        if (!stats.isFile()) {
          console.error(`[render] scene path is not a file: ${scenePath}`)
          process.exit(2)
        }
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

function formatOptionValue(value: string): string {
  return value === '' ? EMPTY_OPTION_LABEL : value
}
