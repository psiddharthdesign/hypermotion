// SPDX-License-Identifier: Apache-2.0

import { getAnimEngine } from '@/anim'
import {
  buildExportFilename,
  resolveDimensions,
  resolveFrameRange,
  type ExportFormat,
  type ExportRange,
} from './formats'
import type { ExportSceneContext } from './orchestrator'
import { useExportProgress } from './progressStore'

/**
 * Tab-capture export pipeline.
 *
 * Used as:
 *  - Primary path for `webm` (real-time getDisplayMedia + MediaRecorder).
 *  - Fallback path for `mp4` on browsers that don't support WebCodecs
 *    (Safari < 16.4, Firefox). Captures WebM, transcodes via ffmpeg.wasm.
 *    Native WebCodecs MP4 is preferred when available; see encodeMp4.ts.
 *
 * Architectural notes:
 *
 *   - `getDisplayMedia` asks the user to share the hyper-motion tab.
 *     The browser's compositor is already rendering the page; we just
 *     intercept the output stream. No per-frame DOM serialization,
 *     no html-to-image bottleneck, no memory growth.
 *
 *   - `MediaRecorder` consumes the stream and emits encoded chunks
 *     into a Blob progressively. Memory is O(1) regardless of
 *     export length.
 *
 *   - We play the timeline at real time during recording. A 5-second
 *     comp records in 5 seconds. Trade-off: no faster-than-realtime
 *     export, no slower-than-realtime quality boost.
 *
 *   - Resolution is bound to the SCREEN PIXEL RATIO of the captured
 *     tab — the browser composites the page at the user's display
 *     scale, then this stream picks up that result. For "sturdy 4K"
 *     where pixel-correctness matters, the native MP4 path
 *     (offscreen render at native res → WebCodecs encoder) is the
 *     right tool. Tab capture is the realistic fast path for
 *     web-grade WebM previews.
 */

/**
 * Adapter shape recordTabCapture accepts. The orchestrator synthesizes
 * a `container` field (`webm` or `mp4`) when calling this — keeps the
 * public ExportFormat type pure data and lets this file stay agnostic
 * to the catalogue's evolution.
 */
export interface RecordTabFormat extends ExportFormat {
  container: 'webm' | 'mp4'
}

/**
 * Browser support probe. getDisplayMedia is in Chrome / Edge / Arc /
 * Safari 13+ / Firefox 66+. The `displaySurface` constraint is best-
 * effort; browsers may ignore it and let the user pick anyway.
 */
export function isTabCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function'
  )
}

/**
 * Pick the best WebM codec the browser can encode. Prefers VP9 (smaller,
 * better quality at same bitrate), falls back to VP8.
 */
function pickWebMMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return 'video/webm'
}

export async function recordTabCapture(
  format: RecordTabFormat,
  ctx: ExportSceneContext,
): Promise<void> {
  const progress = useExportProgress.getState()
  const engine = getAnimEngine()

  if (!isTabCaptureSupported()) {
    progress.setError(
      'Tab capture requires getDisplayMedia + MediaRecorder. Use a recent Chrome / Edge / Arc / Safari.',
    )
    return
  }

  // Resolve scene canvas via the artboard DOM — same trick as the
  // native render path. The artboard's offset dimensions ARE the comp size.
  const sceneCanvas = (() => {
    const el = document.querySelector<HTMLElement>('[data-canvas-root]')
    if (el && el.offsetWidth && el.offsetHeight) {
      return { width: el.offsetWidth, height: el.offsetHeight }
    }
    return { width: 1920, height: 1080 }
  })()
  const { width, height } = resolveDimensions(ctx.quality, sceneCanvas)

  const fps = ctx.exportFps ?? ctx.frameRate
  const range: ExportRange = ctx.range ?? { kind: 'full' }
  const { firstFrame, lastFrame } = resolveFrameRange(range, ctx.durationSec, fps)
  const lastSceneFrame = Math.max(0, Math.round(ctx.durationSec * fps) - 1)
  const totalFrames = Math.max(1, lastFrame - firstFrame + 1)
  const fileName = buildExportFilename(ctx.sceneName, format, {
    firstFrame,
    lastFrame,
    lastSceneFrame,
    chapterTag: ctx.filenameTag,
  })
  const startSec = firstFrame / fps
  const endSec = (lastFrame + 1) / fps
  const recordSec = endSec - startSec

  const startToken = progress.cancelToken
  const isCancelled = () => useExportProgress.getState().cancelToken !== startToken

  progress.start(format, totalFrames, fileName)

  // Pause + seek to the start of the range. We'll engine.play() once
  // the recorder is armed and the user has dismissed the share prompt.
  const wasPlaying = engine.isPlaying()
  engine.pause()
  const originalPlayhead = engine.getPlayhead()
  engine.setLoopRange(null) // record straight through; loop range
  engine.seek(startSec)

  // Toggle the document's "recording" mode so CSS can hide the editor
  // chrome (panels, top bar, timeline) while the capture is active.
  // The selector body[data-export-recording] is consumed in
  // src/index.css — keeps the captured stream focused on the artboard.
  const body = document.body
  body.setAttribute('data-export-recording', '1')

  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  const chunks: Blob[] = []

  // Always tear down — on success, error, or cancel — so we don't
  // leave the editor stuck in "recording" mode if anything throws.
  const cleanup = () => {
    body.removeAttribute('data-export-recording')
    if (stream) {
      for (const t of stream.getTracks()) t.stop()
      stream = null
    }
    engine.pause()
    engine.seek(originalPlayhead)
    if (wasPlaying) engine.play()
  }

  try {
    // Prompt the user to pick a tab to share.
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: fps },
          width: { ideal: width },
          height: { ideal: height },
        },
        audio: false,
        ...({ preferCurrentTab: true } as unknown as Record<string, unknown>),
      })
    } catch {
      throw new Error(
        'Tab capture cancelled. When the browser asks which window to share, choose this hyper-motion tab.',
      )
    }

    if (isCancelled()) {
      progress.setPhase('cancelled')
      cleanup()
      return
    }

    // Region Capture (CropTarget). When supported, crop the captured
    // stream to JUST the artboard div so panels / chrome don't appear
    // in the output. Falls back to full-tab capture on unsupported
    // browsers or unfortunate picker selections.
    const artboardEl = document.querySelector<HTMLElement>('[data-canvas-root]')
    const win = window as unknown as {
      CropTarget?: { fromElement: (el: Element) => Promise<unknown> }
    }
    const [videoTrack] = stream.getVideoTracks()
    const trackWithCrop = videoTrack as MediaStreamTrack & {
      cropTo?: (target: unknown) => Promise<void>
    }
    if (artboardEl && win.CropTarget && typeof trackWithCrop.cropTo === 'function') {
      try {
        const cropTarget = await win.CropTarget.fromElement(artboardEl)
        await trackWithCrop.cropTo(cropTarget)
      } catch (cropErr) {
        // eslint-disable-next-line no-console
        console.warn(
          '[export] Region Capture not applied; recording the full tab. ' +
            'If you picked a different tab in the share picker, this is expected. ' +
            'Otherwise the captured surface might not support cropTo:',
          cropErr,
        )
      }
    }

    const bitrate = Math.max(2_000_000, Math.round(width * height * fps * 0.1))
    recorder = new MediaRecorder(stream, {
      mimeType: pickWebMMimeType(),
      videoBitsPerSecond: bitrate,
    })
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }

    recorder.start(500)

    await new Promise<void>((resolve) => setTimeout(resolve, 80))
    engine.play()

    const playStart = performance.now()
    let lastProgressUpdate = 0
    while (true) {
      if (isCancelled()) {
        progress.setPhase('cancelled')
        break
      }
      const elapsedMs = performance.now() - playStart
      const elapsedSec = elapsedMs / 1000
      if (elapsedSec >= recordSec) break
      if (elapsedMs - lastProgressUpdate >= 100) {
        const f = Math.min(totalFrames, Math.round(elapsedSec * fps))
        progress.setFrame(f)
        progress.setEta((recordSec - elapsedSec) * 1000, 1000 / fps)
        lastProgressUpdate = elapsedMs
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }

    engine.pause()

    progress.setPhase('encoding')
    await new Promise<void>((resolve) => {
      recorder!.onstop = () => resolve()
      recorder!.stop()
    })

    if (isCancelled()) {
      progress.setPhase('cancelled')
      cleanup()
      return
    }

    const webmBlob = new Blob(chunks, { type: pickWebMMimeType() })

    // MP4 in this path used to transcode through ffmpeg.wasm here, but
    // that load is blocked by Electron's CSP (`failed to import
    // ffmpeg-core.js`) and is genuinely slow for any non-trivial render.
    // The supported MP4 path is now `captureRect` + WebCodecs, which
    // the orchestrator routes to first when running under Electron. If
    // we still landed here with `container === 'mp4'`, it means the
    // user is on a browser without WebCodecs OR explicitly forced
    // `pipeline: 'tab-capture'`. In either case, surface a clean error
    // rather than promising an MP4 we can't actually deliver.
    if (format.container === 'mp4') {
      throw new Error(
        'MP4 via tab capture is no longer supported. Run inside the desktop app (uses WebCodecs directly) or pick WebM for browser-only export.',
      )
    }
    const outputBlob: Blob = webmBlob
    const outputMime = pickWebMMimeType()

    if (isCancelled()) {
      progress.setPhase('cancelled')
      cleanup()
      return
    }

    const finalBlob =
      outputBlob.type === outputMime
        ? outputBlob
        : new Blob([outputBlob], { type: outputMime })
    if (ctx.onBlob) {
      // Headless / programmatic caller — see orchestrator.ts for the
      // matching branch and headlessExport.ts for the caller.
      await ctx.onBlob(finalBlob, fileName)
      progress.setPhase('done')
    } else {
      const url = URL.createObjectURL(finalBlob)
      progress.setDone(url)
      triggerDownload(url, fileName)
    }
  } catch (e) {
    progress.setError(e instanceof Error ? e.message : String(e))
  } finally {
    cleanup()
  }
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