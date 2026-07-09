// SPDX-License-Identifier: Apache-2.0

/**
 * Renderer-side handler for headless export mode.
 *
 * Two entry paths:
 *
 *  1. **Boot-time** — the binary was launched with `--render` and no
 *     other instance was running, so we became the first instance. On
 *     startup we ask main for the pending headless request and run it.
 *     After the export completes, main exits the process.
 *
 *  2. **Second-instance** — another hyper-motion is already running (the
 *     user's editor). The single-instance lock in main.ts forwarded the
 *     new argv via the `second-instance` event. Main dispatches an
 *     `export:headless-trigger` IPC event to this renderer. We run the
 *     export against the currently-loaded scene, write the file, drop a
 *     sentinel, then return to normal editor operation.
 *
 * In both paths the actual render is identical — call the existing
 * `exportScene()` with an `onBlob` interceptor that ships bytes back to
 * main via `export:headless-done`.
 *
 * Current scope: renders either the user's CURRENT scene from IndexedDB
 * or a saved `.hype` file provided as `--scene <path>`.
 */

import {
  exportScene,
  getExportFormat,
  getExportQuality,
  type ExportFormatId,
  type ExportQualityId,
} from '@/export'
import { apiReady } from '@/scene'
import { sceneDoc } from '@/scene/internals'
import { loadSceneIntoDoc } from '@/scene/file'

// Renderer-side ambient type. Mirrors the bridge surface in
// `electron/preload.ts` — re-declared locally because preload's
// `declare global` lives in a separate TS project from the renderer.
declare global {
  interface Window {
    hypermotion?: {
      clipboard?: {
        readText: () => Promise<string>
        writeText: (text: string) => Promise<void>
        readFiles?: () => Promise<Array<{ name: string; type: string; bytes: Uint8Array }>>
      }
      media?: {
        normalizeVideo?: (payload: {
          name: string
          type: string
          bytes: Uint8Array
        }) => Promise<{ name: string; type: string; bytes: Uint8Array; normalized: boolean }>
      }
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on?: (
        channel: string,
        listener: (...args: unknown[]) => void,
      ) => () => void
    }
  }
}

interface HeadlessRequest {
  scenePath?: string
  outputPath: string
  format: ExportFormatId
  quality: ExportQualityId
  fps: number
}

/**
 * Boot the headless export handler. Safe to call unconditionally — it
 * no-ops when not running under the desktop wrapper. Handles both the
 * boot-time pending-request flow and the second-instance trigger flow.
 */
export async function bootHeadlessExport(): Promise<void> {
  const bridge = window.hypermotion
  if (!bridge) return // web build — never headless

  bridge.on?.('scene:load-path', (scenePath) => {
    if (typeof scenePath !== 'string') return
    void loadScenePathIntoEditor(scenePath)
  })

  // Subscribe FIRST so we don't miss a trigger that arrives between
  // app startup and our boot-time check.
  bridge.on?.('export:headless-trigger', (req) => {
    void runHeadlessRender(req as HeadlessRequest)
  })

  // Check for a boot-time request (first-instance headless launch).
  let req: HeadlessRequest | null = null
  try {
    req = (await bridge.invoke('export:headless-request')) as HeadlessRequest | null
  } catch {
    return // main process doesn't have the handler — older binary
  }
  if (req) {
    await runHeadlessRender(req)
  }
}

let inFlight = false

/**
 * Drive a single headless render against the currently-loaded scene.
 * Serialized — a second trigger arriving while one render is running
 * is reported back as an error rather than racing the orchestrator.
 */
async function runHeadlessRender(req: HeadlessRequest): Promise<void> {
  const bridge = window.hypermotion
  if (!bridge) return

  // WebM goes through the tab-capture path (getDisplayMedia +
  // MediaRecorder), which requires a user gesture on macOS Chromium.
  // In headless mode there's no gesture — the call hangs forever.
  // Fail fast with a clear message so the agent can fall back to MP4
  // or GIF instead of waiting out the 5-minute CLI timeout. Rebuilding
  // WebM on top of capturePage (frame-by-frame WebM encoding) is the
  // proper fix.
  //
  // This check sits BEFORE the inFlight guard so a WebM rejection
  // doesn't consume the queue slot — other renders can proceed.
  if (req.format === 'webm') {
    await bridge.invoke(
      'export:headless-error',
      'WebM is not supported in headless mode yet (the tab-capture pipeline requires a user gesture). Use --format mp4 or --format gif instead, or run the WebM export from the desktop app GUI.',
    )
    return
  }

  if (inFlight) {
    await bridge.invoke(
      'export:headless-error',
      'Another headless render is already in flight. Try again in a moment.',
    )
    return
  }
  inFlight = true

  // eslint-disable-next-line no-console
  console.log('[headless] export requested:', req)

  try {
    const api = await apiReady
    if (req.scenePath) {
      await loadScenePathIntoEditor(req.scenePath)
      await waitForFrames(2)
    }
    const meta = api.getMeta()

    // eslint-disable-next-line no-console
    console.log(
      `[headless] scene "${meta.name}" — ${meta.canvas.width}×${meta.canvas.height} · ` +
        `${meta.duration.toFixed(2)}s @ ${meta.frameRate}fps`,
    )

    // Let one or two frames settle so the editor DOM reflects the
    // current playhead before capturePage runs.
    await waitForFrames(3)

    await exportScene({
      api,
      sceneName: meta.name,
      durationSec: meta.duration,
      frameRate: meta.frameRate,
      format: getExportFormat(req.format),
      quality: getExportQuality(req.quality),
      exportFps: req.fps,
      pipeline: 'native',
      onBlob: async (blob) => {
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        // eslint-disable-next-line no-console
        console.log(
          `[headless] ✓ rendered ${bytes.byteLength} bytes — shipping to main`,
        )
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
      /* bridge torn down — best effort */
    }
  } finally {
    inFlight = false
  }
}

async function loadScenePathIntoEditor(scenePath: string): Promise<void> {
  const bridge = window.hypermotion
  if (!bridge) return
  const bytes = (await bridge.invoke('file:read', scenePath)) as
    | Uint8Array
    | null
  if (!bytes) {
    throw new Error(`Failed to read scene file: ${scenePath}`)
  }
  loadSceneIntoDoc(sceneDoc, new Uint8Array(bytes))
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
