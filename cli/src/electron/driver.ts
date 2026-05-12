// SPDX-License-Identifier: Apache-2.0

/**
 * Drive the installed hyper-motion desktop app in headless render mode.
 *
 * Spawns the Electron binary with command-line flags that the desktop
 * app's `electron/main.ts` recognizes:
 *
 *   --render             flag — go into headless render mode
 *   --out <outPath>      output file
 *   --format <fmt>       mp4 | webm | gif
 *   --quality <q>        comp | 720p | 2k | 4k
 *   --fps <n>            frame rate
 *   --scene <path>       (v0.1.1) path to a .arnimotion file. Ignored in
 *                        v0.1.0 — the desktop app's current IndexedDB
 *                        scene is rendered instead.
 *
 * The app opens an off-screen window, runs the export pipeline, ships
 * bytes to its main process via IPC, writes the file, and exits with
 * code 0 (success) or non-zero with an error message on stderr.
 */

import { spawn } from 'node:child_process'

export interface HeadlessRenderRequest {
  appPath: string
  outputPath: string
  format: 'mp4' | 'webm' | 'gif'
  quality: 'comp' | '720p' | '2k' | '4k'
  fps: number
  /** v0.1.1 — currently ignored. */
  scenePath?: string
}

export async function driveHeadlessRender(req: HeadlessRenderRequest): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args: string[] = [
      '--render',
      '--out',
      req.outputPath,
      '--format',
      req.format,
      '--quality',
      req.quality,
      '--fps',
      String(req.fps),
    ]
    if (req.scenePath) {
      args.push('--scene', req.scenePath)
    }

    const child = spawn(req.appPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Electron emits chatty logs by default; quiet them unless the
        // user opts in. Set HYPERMOTION_VERBOSE=1 to see everything.
        ELECTRON_ENABLE_LOGGING: process.env.HYPERMOTION_VERBOSE ? '1' : '',
      },
    })

    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      // Stream stdout straight through — the desktop app emits progress
      // lines like `[headless] export requested: …` that the CLI passes
      // along so the user sees what's happening.
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (process.env.HYPERMOTION_VERBOSE) {
        process.stderr.write(chunk)
      }
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn desktop app: ${err.message}`))
    })

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      if (signal) {
        reject(new Error(`Desktop app was killed by signal ${signal}`))
        return
      }
      const tail = stderr.trim().split('\n').slice(-8).join('\n')
      reject(new Error(`Desktop app exited with code ${code}. Last stderr:\n${tail || '(no output)'}`))
    })
  })
}
