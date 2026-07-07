// SPDX-License-Identifier: Apache-2.0

/**
 * Drive the installed hyper-motion desktop app in headless render mode.
 *
 * Wire diagram:
 *
 *   1. CLI deletes any stale `<output>`, `<output>.done`, and
 *      `<output>.error` from a previous run.
 *   2. CLI spawns the .app binary with `--render --out=<path> ...`.
 *   3. Inside the binary, `app.requestSingleInstanceLock()` either
 *      succeeds (we're the first instance) or fails (another hyper-motion
 *      is already running). Either way the running app ends up handling
 *      the render:
 *        - First-instance: this process stays alive, renders, exits 0.
 *        - Lock-fail: this process exits immediately; the OS forwarded
 *          our argv to the running app via `second-instance` event.
 *   4. The running app writes the output file, then writes a sentinel
 *      at `<output>.done` containing `{"ts":..., "bytes":...}`.
 *   5. CLI polls for the success or error sentinel. On success, render
 *      is done; on error, the renderer's message is surfaced. CLI cleans
 *      up whichever sentinel it consumed.
 *
 * This single-instance handoff avoids IndexedDB lock contention — the
 * running editor can stay open and still serve CLI render requests.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { RenderFormat, RenderQuality } from '../renderOptions.js'

export interface HeadlessRenderRequest {
  readonly appPath: string
  readonly outputPath: string
  readonly format: RenderFormat
  readonly quality: RenderQuality
  readonly fps: number
  /** Optional .hype scene path to render instead of the current desktop scene. */
  readonly scenePath?: string
}

// Maximum wait for a render to complete. Keep hung desktop handoffs
// bounded while still allowing high-quality renders to finish.
const RENDER_TIMEOUT_MS = 5 * 60 * 1000
// How often we poll for the sentinel file.
const POLL_INTERVAL_MS = 250
// Grace period after child exit before deciding the render failed.
// Gives the OS time to flush the sentinel write if it raced with exit.
const POST_EXIT_GRACE_MS = 1500

export async function driveHeadlessRender(req: HeadlessRenderRequest): Promise<void> {
  const sentinelPath = `${req.outputPath}.done`
  const errorPath = `${req.outputPath}.error`
  const verbose = process.env.HYPERMOTION_VERBOSE === '1'

  // Clean slate — remove any stale output / sentinels from previous runs
  // so we can't false-positive on old data.
  cleanFile(req.outputPath)
  cleanFile(sentinelPath)
  cleanFile(errorPath)

  // Use `--key=value` form (not `--key value`) for every value flag.
  // Electron's `second-instance` event delivers argv pre-processed by
  // Chromium's CommandLine class, which drops bare values between
  // switches. `--key=value` survives that round-trip; `--key value`
  // collapses to just `--key`. The `=` form also works fine for the
  // direct first-instance launch path.
  const args: string[] = [
    '--render',
    `--out=${req.outputPath}`,
    `--format=${req.format}`,
    `--quality=${req.quality}`,
    `--fps=${req.fps}`,
  ]
  if (req.scenePath) {
    args.push(`--scene=${req.scenePath}`)
  }

  const child = spawn(req.appPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: verbose ? '1' : '',
    },
  })

  let stderr = ''
  let exitCode: number | null = null
  let exitSignal: NodeJS.Signals | null = null
  let exitedAt = 0
  // Closure-assigned values use a wrapper object so TS narrows them
  // correctly in the polling loop below. With `let`-declared bare
  // values, TS narrows the closure-set state to `never` after the
  // initial null assignment because it can't see across the callback
  // boundary.
  const errorRef: { current: Error | null } = { current: null }

  child.stdout.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
    if (verbose) {
      process.stderr.write(chunk)
    }
  })
  child.on('error', (err) => {
    errorRef.current = err
  })
  child.on('exit', (code, signal) => {
    exitCode = code
    exitSignal = signal
    exitedAt = Date.now()
  })

  // Poll for the sentinel. The render is complete when it appears.
  const start = Date.now()
  while (Date.now() - start < RENDER_TIMEOUT_MS) {
    if (errorRef.current) {
      throw new Error(`Failed to spawn desktop app: ${errorRef.current.message}`)
    }
    if (hasCompleteSuccessSentinel(sentinelPath)) {
      // Render complete. Remove the sentinel so subsequent runs start clean.
      cleanFile(sentinelPath)
      return
    }
    if (fs.existsSync(errorPath)) {
      // Renderer reported an error. Surface it and bail — no point
      // continuing to poll, the render isn't going to finish.
      const message = readRenderErrorMessage(errorPath)
      if (message) {
        cleanFile(errorPath)
        throw new Error(message)
      }
    }
    // If the child exited with a non-zero code AND no sentinel has
    // appeared after the grace window, the render failed.
    if (
      exitedAt > 0 &&
      Date.now() - exitedAt > POST_EXIT_GRACE_MS &&
      exitCode !== null &&
      exitCode !== 0
    ) {
      const tail = stderr.trim().split('\n').slice(-8).join('\n')
      throw new Error(
        `Desktop app exited with code ${exitCode}. Last stderr:\n${
          tail || '(no output)'
        }`,
      )
    }
    if (exitSignal && Date.now() - exitedAt > POST_EXIT_GRACE_MS) {
      throw new Error(`Desktop app was killed by signal ${exitSignal}`)
    }

    await sleep(POLL_INTERVAL_MS)
  }

  // If the event loop was suspended or starved past the timeout boundary,
  // a final sentinel may have landed after the last in-loop poll.
  if (hasCompleteSuccessSentinel(sentinelPath)) {
    cleanFile(sentinelPath)
    return
  }
  if (fs.existsSync(errorPath)) {
    const message = readRenderErrorMessage(errorPath)
    if (message) {
      cleanFile(errorPath)
      throw new Error(message)
    }
  }

  throw new Error(
    `Render timed out after ${RENDER_TIMEOUT_MS / 1000}s. ` +
      `Make sure the desktop app is responsive. Set HYPERMOTION_VERBOSE=1 ` +
      `to see the app's stderr and diagnose where it's stuck.`,
  )
}

function cleanFile(p: string): void {
  try {
    fs.rmSync(p, { force: true })
  } catch {
    /* best-effort */
  }
}

function hasCompleteSuccessSentinel(sentinelPath: string): boolean {
  try {
    const raw = fs.readFileSync(sentinelPath, 'utf-8')
    const data = JSON.parse(raw)
    return (
      typeof data === 'object' &&
      data !== null &&
      'bytes' in data &&
      typeof data.bytes === 'number' &&
      Number.isFinite(data.bytes) &&
      data.bytes >= 0
    )
  } catch {
    return false
  }
}

function readRenderErrorMessage(errorPath: string): string | null {
  let message = 'Render failed (no details available)'
  try {
    const raw = fs.readFileSync(errorPath, 'utf-8')
    if (raw.length === 0) return null
    try {
      const data = JSON.parse(raw)
      if (hasErrorMessage(data)) message = data.message.trim()
    } catch {
      const text = raw.trim()
      if (text) message = text
    }
  } catch {
    /* best effort — fall through with the generic message */
  }
  return message
}

function hasErrorMessage(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string' &&
    value.message.trim().length > 0
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
