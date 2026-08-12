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
  useExportProgress,
  type ExportFormatId,
  type ExportQualityId,
} from '@/export'
import { apiReady } from '@/scene'
import { sceneDoc } from '@/scene/internals'
import {
  loadSceneIntoDoc,
  readScene,
} from '@/scene/file'
import { getProjectAPI } from '@/project'
import { isRenderWindowSupported } from '@/export/renderWindowClient'

// Renderer-side ambient type. Mirrors the bridge surface in
// `electron/preload.ts` — re-declared locally because preload's
// `declare global` lives in a separate TS project from the renderer.
declare global {
  interface Window {
    hypermotion?: {
      clipboard?: {
        readTextSync?: () => string
        writeTextSync?: (text: string) => boolean
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

  console.log('[headless] export requested:', req)

  let transientSceneDoc: ReturnType<typeof readScene>['doc'] | null = null
  try {
    let api: ReturnType<typeof readScene>['api']
    if (req.scenePath) {
      if (!isRenderWindowSupported()) {
        throw new Error(
          'Rendering a saved scene requires the isolated render-window pipeline in this desktop build.',
        )
      }
      const loaded = readScene(await readScenePathBytes(req.scenePath))
      transientSceneDoc = loaded.doc
      api = loaded.api
    } else {
      api = await apiReady
    }
    const meta = api.getMeta()
    const project = getProjectAPI(api)
    project.ensureInitialized()
    const sequenceItems = project.getSequenceItems()
    const sequenceMap = project.getSequenceTimeMap()
    const renderSequence =
      sequenceItems.length > 1 ||
      sequenceItems.some(
        (item) =>
          (item.trimStart ?? 0) > 0 ||
          item.duration !== undefined ||
          (item.holdDuration ?? 0) > 0,
      )
    const durationSec = renderSequence ? sequenceMap.duration : meta.duration

    console.log(
      `[headless] scene "${meta.name}" — ${meta.canvas.width}×${meta.canvas.height} · ` +
        `${durationSec.toFixed(2)}s @ ${meta.frameRate}fps` +
        (renderSequence ? ` · ${sequenceMap.items.length} scenes` : ''),
    )

    // Let one or two frames settle so the editor DOM reflects the
    // current playhead before capturePage runs.
    await waitForFrames(3)

    let delivered = false
    await exportScene({
      api,
      sceneName: meta.name,
      durationSec,
      scope: renderSequence ? 'sequence' : 'scene',
      frameRate: meta.frameRate,
      format: getExportFormat(req.format),
      quality: getExportQuality(req.quality),
      exportFps: req.fps,
      onBlob: async (blob) => {
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        console.log(
          `[headless] ✓ rendered ${bytes.byteLength} bytes — shipping to main`,
        )
        await bridge.invoke('export:headless-done', {
          bytes,
          outputPath: req.outputPath,
        })
        delivered = true
      },
    })
    if (!delivered) {
      const progress = useExportProgress.getState()
      throw new Error(
        progress.error ??
          `The ${req.format.toUpperCase()} renderer finished without producing output bytes.`,
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[headless] export failed:', message)
    try {
      await bridge.invoke('export:headless-error', message)
    } catch {
      /* bridge torn down — best effort */
    }
  } finally {
    transientSceneDoc?.destroy()
    inFlight = false
  }
}

async function loadScenePathIntoEditor(scenePath: string): Promise<void> {
  loadSceneIntoDoc(sceneDoc, await readScenePathBytes(scenePath))
}

async function readScenePathBytes(scenePath: string): Promise<Uint8Array> {
  const bridge = window.hypermotion
  if (!bridge) {
    throw new Error('Desktop bridge unavailable while reading a scene file.')
  }
  const bytes = (await bridge.invoke('file:read', scenePath)) as
    | Uint8Array
    | null
  if (!bytes) {
    throw new Error(`Failed to read scene file: ${scenePath}`)
  }
  return new Uint8Array(bytes)
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
