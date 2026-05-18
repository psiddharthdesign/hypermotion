// SPDX-License-Identifier: Apache-2.0

import { sceneToBytes } from '@/scene'
import { resolveDimensions, resolveFrameSegments } from './formats'
import type { ExportSceneContext } from './orchestrator'
import { useExportProgress } from './progressStore'

/**
 * Editor-side client for the render-window export flow.
 *
 * Called by the orchestrator when running in Electron. Spawns a hidden
 * BrowserWindow via the `export:open-render-window` IPC, ships the
 * scene's Y.Doc bytes + export params, and listens for progress + done
 * events that the render window's `RenderWindowApp` fires back through
 * main.
 *
 * The editor window stays fully interactive throughout — the export
 * runs in its own process. This module's responsibility is just:
 *
 *   1. Serialize the scene + open the render window.
 *   2. Translate progress events into `useExportProgress` updates so
 *      the existing status pill / progress popover stays accurate.
 *   3. On done, hand the bytes to `ctx.onBlob` (headless path) or
 *      trigger a browser download (GUI path).
 *   4. On error, surface via `progress.setError`.
 *   5. On user cancel (`progress.cancelToken` bumps), tell main to
 *      destroy the render window.
 */

interface HyperMotionBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on?: (
    channel: string,
    listener: (...args: unknown[]) => void,
  ) => () => void
}

function getBridge(): HyperMotionBridge | null {
  if (typeof window === 'undefined') return null
  const hm = (window as unknown as { hypermotion?: HyperMotionBridge })
    .hypermotion
  return hm && typeof hm.invoke === 'function' && typeof hm.on === 'function'
    ? hm
    : null
}

/**
 * Probe — true when the render-window IPC + bridge are available.
 * The editor's orchestrator branches on this to decide whether to
 * use the new flow or fall back to legacy in-editor capture.
 */
export function isRenderWindowSupported(): boolean {
  return getBridge() !== null
}

interface ProgressMessage {
  requestId: string
  phase: 'rendering' | 'encoding'
  frame?: number
  totalFrames?: number
  etaMs?: number
  perFrameMs?: number
}

interface DoneMessage {
  requestId: string
  bytes: Uint8Array
  fileName: string
  mimeType: string
}

interface ErrorMessage {
  requestId: string
  message: string
}

export async function runRenderWindowExport(
  ctx: ExportSceneContext,
): Promise<void> {
  const bridge = getBridge()
  if (!bridge || !bridge.on) {
    useExportProgress
      .getState()
      .setError('Render window bridge not available in this build.')
    return
  }

  const progress = useExportProgress.getState()
  const meta = ctx.api.getMeta()
  const sceneCanvas = meta.canvas
  const fps = ctx.exportFps ?? ctx.frameRate

  // Resolve output dimensions up-front so we can size the render
  // window correctly. Passing `format.id` enables the H.264 cap for
  // MP4 jobs — Match comp / 4K on an oversized canvas auto-clamps to
  // 3840×2160 bounding box instead of failing in the encoder.
  // The render window's RenderCanvas re-derives these too (via
  // resolveDimensions on the seeded doc with the same format), and
  // the two must agree because main sizes the BrowserWindow off this
  // value while the render window paints into it.
  const targetDims = resolveDimensions(ctx.quality, sceneCanvas, ctx.format.id)

  // Total frames for the progress bar — derived from the export range.
  const range = ctx.range ?? { kind: 'full' as const }
  const segments = resolveFrameSegments(range, ctx.durationSec, fps)
  const totalFrames = segments.reduce(
    (acc, s) => acc + (s.lastFrame - s.firstFrame + 1),
    0,
  )

  // Serialize the scene to bytes — same format `.hype` files use.
  // The render window applies these onto its own (empty) Y.Doc, which
  // gives it a deep, deterministic copy of the editor's current state.
  const seedBytes = sceneToBytes(ctx.api.doc)

  // Provisional filename — main's filename is informational; we re-derive
  // in the render window so the chapterTag etc. is consistent. Provide
  // here for the progress UI before any frames render.
  const sceneName = ctx.sceneName
  const provisionalFileName = `${sceneName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'export'}.${ctx.format.extension}`

  progress.start(ctx.format, totalFrames, provisionalFileName)
  const startToken = progress.cancelToken

  let requestId: string
  try {
    const result = (await bridge.invoke('export:open-render-window', {
      params: {
        format: ctx.format.id,
        quality: ctx.quality.id,
        sceneName,
        durationSec: ctx.durationSec,
        frameRate: ctx.frameRate,
        exportFps: fps,
        outputWidth: targetDims.width,
        outputHeight: targetDims.height,
        range,
        filenameTag: ctx.filenameTag,
      },
      seedBytes,
    })) as { requestId: string }
    requestId = result.requestId
  } catch (e) {
    progress.setError(
      `Failed to open render window: ${e instanceof Error ? e.message : String(e)}`,
    )
    return
  }

  // Smoothing pass for ETA — the render window reports per-frame ms
  // directly, so we don't need to smooth here. Just forward the
  // numbers into the progress store as they arrive.
  let smoothedFrameMs = 0

  let resolveDone: () => void = () => {}
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const offProgress = bridge.on('export:render-window-progress', (...args) => {
    const msg = args[0] as ProgressMessage
    if (msg.requestId !== requestId) return
    if (progress.cancelToken !== startToken) return // user cancelled
    if (msg.phase === 'encoding') {
      progress.setPhase('encoding')
      return
    }
    if (typeof msg.frame === 'number') {
      progress.setFrame(msg.frame)
    }
    if (typeof msg.perFrameMs === 'number') {
      smoothedFrameMs = msg.perFrameMs
      progress.setEta(msg.etaMs ?? 0, smoothedFrameMs)
    }
  })

  const offDone = bridge.on('export:render-window-done', (...args) => {
    const msg = args[0] as DoneMessage
    if (msg.requestId !== requestId) return
    void handleDone(msg, ctx).finally(() => {
      offProgress?.()
      offDone?.()
      offError?.()
      resolveDone()
    })
  })

  const offError = bridge.on('export:render-window-error', (...args) => {
    const msg = args[0] as ErrorMessage
    if (msg.requestId !== requestId) return
    progress.setError(msg.message)
    offProgress?.()
    offDone?.()
    offError?.()
    resolveDone()
  })

  // Cancellation watcher. Polls the progress store at 4Hz for the
  // cancelToken bump triggered by the user's Cancel button. When seen,
  // tells main to destroy the render window — the orchestrator's
  // pending promise then resolves via the error/done path (window
  // destroy fires `closed` which clears the renderJobs entry).
  const cancelInterval = window.setInterval(() => {
    if (progress.cancelToken !== startToken) {
      void bridge.invoke('export:cancel-render-window', requestId)
      progress.setPhase('cancelled')
      offProgress?.()
      offDone?.()
      offError?.()
      window.clearInterval(cancelInterval)
      resolveDone()
    }
  }, 250)

  try {
    await donePromise
  } finally {
    window.clearInterval(cancelInterval)
  }
}

async function handleDone(
  msg: DoneMessage,
  ctx: ExportSceneContext,
): Promise<void> {
  const progress = useExportProgress.getState()
  // Wrap the raw bytes back into a Blob so the existing onBlob /
  // download flow (originally written against the encoder's Blob
  // output) doesn't need to know we came from IPC.
  // Cast through BlobPart for the same reason `captureRect.ts` does —
  // strict ArrayBuffer-only constraint under SharedArrayBuffer-aware
  // lib settings, runtime is happy.
  const blob = new Blob([msg.bytes as BlobPart], { type: msg.mimeType })

  if (ctx.onBlob) {
    try {
      await ctx.onBlob(blob, msg.fileName)
      progress.setPhase('done')
    } catch (e) {
      progress.setError(
        `Failed to consume rendered bytes: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    return
  }

  const url = URL.createObjectURL(blob)
  progress.setDone(url)
  triggerDownload(url, msg.fileName)
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
