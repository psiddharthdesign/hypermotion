// SPDX-License-Identifier: Apache-2.0

/**
 * Renderer-side handler for headless export mode.
 *
 * Invoked when the Electron binary was launched with `--render --out <path>`
 * (see `electron/main.ts` for the argv parser). At startup we ask the main
 * process whether there's a pending headless request; if so, we wait for
 * the scene to hydrate from IndexedDB, kick off the existing export
 * pipeline with an `onBlob` interceptor, and ship the rendered bytes
 * back to the main process via IPC. Main writes the file, app exits.
 *
 * v0.1.0 scope: renders the user's CURRENT scene (whatever was last
 * persisted to IndexedDB by the desktop app). A `.arnimotion` file format
 * for rendering arbitrary scene files is on the v0.1.1 roadmap.
 *
 * Wire diagram:
 *
 *   CLI (`@psiddharthdesign/hypermotion`)
 *     → spawns Electron with --out --format --quality --fps --headless
 *     → main.ts parses, exposes request via `export:headless-request`
 *     → this file reads the request, waits for `apiReady`
 *     → calls exportScene({ ...opts, onBlob: shipBytes })
 *     → shipBytes posts bytes via `export:headless-done`
 *     → main.ts writes to <out>, app.exit(0)
 *
 * Errors at any step post `export:headless-error` instead. Main logs
 * the message and app.exit(1).
 */

import {
  exportScene,
  getExportFormat,
  getExportQuality,
  type ExportFormatId,
  type ExportQualityId,
} from '@/export'
import { apiReady } from '@/scene'

// Renderer-side ambient type. `window.hypermotion` is exposed by
// electron/preload.ts at runtime via contextBridge; the matching
// `declare global` block over there lives in the main-tsconfig
// project, not this one, so we re-declare it locally to keep this
// renderer-side TS project clean. Mirrors the pattern used in
// `src/ui/hooks/useFigmaPaste.ts`.
declare global {
  interface Window {
    hypermotion?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
  }
}

interface HeadlessRequest {
  // scenePath kept on the protocol for forward compat with the file
  // format work in v0.1.1. v0.1.0 ignores it and always renders the
  // current IndexedDB scene.
  scenePath?: string
  outputPath: string
  format: ExportFormatId
  quality: ExportQualityId
  fps: number
}

/**
 * Boot the headless export handler. Safe to call unconditionally — it
 * no-ops when not running under the desktop wrapper or when no headless
 * request is pending.
 */
export async function bootHeadlessExport(): Promise<void> {
  const bridge = window.hypermotion
  if (!bridge) {
    return // web build — never headless
  }

  let req: HeadlessRequest | null = null
  try {
    req = (await bridge.invoke('export:headless-request')) as HeadlessRequest | null
  } catch {
    return // main process doesn't have the handler — older binary
  }
  if (!req) {
    return // normal interactive launch
  }

  // eslint-disable-next-line no-console
  console.log('[headless] export requested:', req)

  try {
    const api = await apiReady
    const meta = api.getMeta()

    // eslint-disable-next-line no-console
    console.log(
      `[headless] scene "${meta.name}" — ${meta.canvas.width}×${meta.canvas.height} · ` +
        `${meta.duration.toFixed(2)}s @ ${meta.frameRate}fps`,
    )

    // Let the React tree mount + first layout pass settle. The export
    // pipeline drives the timeline via the anim engine and reads from
    // the live DOM via capturePage; we need at least one rendered frame
    // before we start asking for captures.
    await waitForFrames(3)

    await exportScene({
      api,
      sceneName: meta.name,
      durationSec: meta.duration,
      frameRate: meta.frameRate,
      format: getExportFormat(req.format),
      quality: getExportQuality(req.quality),
      exportFps: req.fps,
      // Force the captureRect path for MP4/GIF — we're inside Electron
      // and want pixel-correct output, not the tab-capture fallback.
      // WebM uses tab capture regardless (orchestrator decides by format).
      pipeline: 'native',
      // Headless interceptor: take the Blob, hand bytes off to main.
      onBlob: async (blob) => {
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        // eslint-disable-next-line no-console
        console.log(`[headless] ✓ rendered ${bytes.byteLength} bytes — shipping to main`)
        await bridge.invoke('export:headless-done', {
          bytes,
          outputPath: req.outputPath,
        })
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error('[headless] export failed:', message)
    try {
      await bridge.invoke('export:headless-error', message)
    } catch {
      // bridge might be torn down already — best effort.
    }
  }
}

function waitForFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = n
    const tick = () => {
      left -= 1
      if (left <= 0) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
