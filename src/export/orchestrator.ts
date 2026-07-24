// SPDX-License-Identifier: Apache-2.0

import { getAnimEngine } from '@/anim'
import type { SceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import {
  createElectronCapture,
  isElectronCaptureSupported,
  type ElectronCapture,
} from './captureRect'
import { createGifEncoder } from './encodeGif'
import { createMp4Encoder, isMp4ExportSupported } from './encodeMp4'
import {
  buildExportFilename,
  resolveDimensions,
  resolveFrameSegments,
  type ExportFormat,
  type ExportQuality,
  type ExportRange,
} from './formats'
import { useExportProgress } from './progressStore'
import { recordTabCapture } from './recordTab'
import { runRenderWindowExport, isRenderWindowSupported } from './renderWindowClient'

/**
 * Top-level export dispatcher.
 *
 * Two pipelines:
 *
 *  1. captureRect (`mp4` and `gif` in Electron)
 *     — drives the timeline frame-by-frame. For each frame: seek the
 *     anim engine, wait one rAF so the editor's DOM reflects the new
 *     playhead, then ask Electron's `webContents.capturePage` for a
 *     bitmap of the artboard's exact rect. The bitmap goes straight
 *     into the WebCodecs encoder (MP4) or gifenc (GIF). No Pixi, no
 *     ffmpeg, no chrome bleed, no permission prompt.
 *
 *  2. tab capture (`webm`, plus MP4 fallback when capturePage is not
 *     available — i.e. the web tree without the Electron wrapper)
 *     — getDisplayMedia + MediaRecorder records the rendered tab in
 *     real time. Editor chrome is hidden during the record via the
 *     same `data-export-mode` body class the captureRect path uses.
 *     WebM passes through; MP4 fallback used to transcode via
 *     ffmpeg.wasm but that's been removed from the default path
 *     (Electron CSP blocks the ffmpeg-core load); web users who want
 *     MP4 should use a Chromium browser where WebCodecs is native.
 *
 * Recovery, May 2026: the previous `runMp4Native` path used Pixi as
 * an offscreen rasterizer. It needed to mirror the DOM renderer's
 * output and never quite did — text font cache, image fills, and
 * shape position math each had subtle drift. capturePage uses the
 * editor's own DOM as the single source of truth, so anything that
 * looks right in the editor renders identically in the export.
 */

export interface ExportSceneContext {
  /** Scene API — the orchestrator reads meta + walks tracks. */
  api: SceneAPI
  sceneName: string
  durationSec: number
  /** Scene's intrinsic frame rate. */
  frameRate: number
  /** Format the user picked. */
  format: ExportFormat
  /** Quality (resolution) the user picked. */
  quality: ExportQuality
  /** FPS to encode at. Defaults to scene `frameRate` when unset. */
  exportFps?: number
  /** Range to export. Defaults to full comp. */
  range?: ExportRange
  /**
   * Pipeline override (advanced). Most callers leave this undefined and
   * let the orchestrator pick: capturePage when running in Electron,
   * tab capture otherwise.
   *
   *   'tab-capture' — force the legacy getDisplayMedia path (Web tree
   *                   today; falls back here on non-Electron).
   *   'native'      — force capturePage. Errors cleanly if not running
   *                   under Electron.
   */
  pipeline?: 'tab-capture' | 'native'
  /**
   * Optional filename tag inserted between the scene name and the
   * extension. The Export menu sets this for multi-chapter exports
   * (e.g. `intro-hold` → `Untitled_intro-hold.mp4`) so multiple
   * partial exports of the same comp don't clobber each other in
   * Downloads. When unset, the filename derives from the bounding
   * frame range as before.
   */
  filenameTag?: string
  /**
   * Optional intercept for the final rendered Blob. When provided, the
   * orchestrator hands the Blob to this callback INSTEAD of triggering a
   * browser download. Used by the CLI/MCP headless render path
   * (see `src/headlessExport.ts`) to ship the bytes back to the main
   * process via IPC so they can be written to disk.
   *
   * Return a Promise to keep the export pipeline paused until the bytes
   * have been transferred — `progress.setPhase('done')` fires after this
   * resolves.
   */
  onBlob?: (blob: Blob, fileName: string) => Promise<void> | void
}

export async function runExport(ctx: ExportSceneContext): Promise<void> {
  const id = ctx.format.id
  const requested = ctx.pipeline

  // WebM has no native encoder dep in this codebase — always tab capture.
  if (id === 'webm') {
    return recordTabCapture({ ...ctx.format, container: 'webm' as const }, ctx)
  }

  // MP4 and GIF: route through the render-window pipeline when available.
  //
  // The render window is a hidden BrowserWindow sized to the exact output
  // dimensions that hosts only the canvas — no editor chrome, no zoom or
  // pan state. The export runs entirely inside it; this editor window
  // stays fully interactive (no zoom snap, no panel hiding, no flicker).
  //
  // Fallback order:
  //   1. Render window (in-Electron, the new default)
  //   2. Legacy in-editor capturePage (in-Electron, kept for safety in
  //      case the render-window path fails to spawn)
  //   3. Tab capture (web tree — no Electron, no capturePage)
  if (id === 'gif' || id === 'mp4') {
    if (id === 'mp4' && requested === 'tab-capture') {
      return recordTabCapture(
        { ...ctx.format, container: 'mp4' as const },
        ctx,
      )
    }
    if (id === 'gif' && requested === 'tab-capture') {
      useExportProgress
        .getState()
        .setError(
          'GIF export only supports the native capturePage pipeline. Run inside the desktop app.',
        )
      return
    }

    // Prefer the render-window flow when we're in Electron AND no caller
    // explicitly demanded the in-editor `native` path. The render-window
    // flow IS the native path now; the `native` pipeline override
    // remains as the legacy in-editor fallback for diagnostic use.
    if (isRenderWindowSupported() && requested !== 'native') {
      return runRenderWindowExport(ctx)
    }

    // Legacy in-editor capturePage path. Reached when:
    //   - Caller explicitly set pipeline='native' (debugging / headless)
    //   - The render-window IPC isn't available (older Electron build)
    if (!isElectronCaptureSupported()) {
      if (id === 'mp4') {
        return recordTabCapture(
          { ...ctx.format, container: 'mp4' as const },
          ctx,
        )
      }
      useExportProgress
        .getState()
        .setError(
          'GIF export requires the desktop app. In the browser, export WebM and convert externally for now.',
        )
      return
    }
    if (id === 'mp4' && !isMp4ExportSupported()) {
      useExportProgress
        .getState()
        .setError(
          'MP4 export needs WebCodecs (Chrome / Edge / Arc / recent Electron). Try WebM instead.',
        )
      return
    }

    return runCaptureRect(ctx, async (width, height, fps) => {
      if (id === 'gif') {
        const enc = createGifEncoder({ width, height, fps })
        return {
          addFrame: (canvas) => enc.addFrame(canvas),
          finish: async () => enc.finish(),
        }
      }
      const enc = await createMp4Encoder({ width, height, fps })
      return {
        addFrame: (canvas, index) => enc.addFrame(canvas, index),
        finish: async () => enc.finish(),
      }
    })
  }

  // Unreachable while ExportFormatId is the closed union mp4|webm|gif.
  useExportProgress
    .getState()
    .setError(`No export pipeline registered for format '${id}'.`)
}

// Re-export so callers can introspect whether the render-window path
// is available. Used by the headless export to decide whether to
// emit a "use Electron" hint when running in a stripped environment.
export { isRenderWindowSupported }

// ---------------------------------------------------------------------------
// captureRect-driven frame loop.
// ---------------------------------------------------------------------------

interface FrameEncoder {
  addFrame(canvas: HTMLCanvasElement, index: number): Promise<void>
  finish(): Promise<Blob>
}

const GC_YIELD_EVERY = 30

/**
 * HQ resolution comes from the user's display devicePixelRatio, NOT
 * from `setZoomFactor`. Page-zooming the renderer fights the window
 * size: at zoomFactor 2, a 1920×1080 artboard exceeds a 1440-wide
 * window, and `capturePage` clips to the visible viewport — the
 * exported frame turns into the top-left quadrant of the comp at
 * giant zoom.
 *
 * On retina (DPR=2), `capturePage` already returns ~3840×2160 for a
 * 1920×1080 CSS artboard — that IS 4K, free, no zoom needed. On a
 * non-retina display the capture is 1×, and we accept that as the
 * cap until we wire a window-resize trick (separate iteration).
 *
 * The Quality picker still affects bitrate via the encoder, just not
 * pixel count.
 */

/**
 * The main render loop, capturePage edition.
 *
 * Steps:
 *   1. Snapshot the editor's view state (zoom + pan) so we can put it
 *      back when we're done. Force zoom to 1 and pan to (0, 0) so the
 *      artboard sits in viewport space at its CSS-native size — the
 *      rect getBoundingClientRect returns is what we'll capture.
 *   2. Pause the timeline and remember the user's current playhead.
 *   3. Let one rAF pass so the body[data-export-mode] CSS hides chrome
 *      AND the workspace transform settles. Without the wait the first
 *      capturePage would still show the un-zoomed editor and the
 *      output would be stuttered.
 *   4. Build the Electron capture session at the requested zoom factor.
 *      The capture object's `init` reads the artboard rect AT the
 *      target zoom — which is what we'll feed to the encoder.
 *   5. Capture frame 0 to learn the encoder's true output dimensions
 *      (page-zoom + DPR may double them up vs. what we'd compute on
 *      paper). Build the encoder with those dimensions. Push frame 0.
 *   6. Loop the remaining frames: seek anim, await one rAF, capture,
 *      encode, update progress + ETA.
 *   7. Finalize the encoder, trigger download, restore everything.
 */
async function runCaptureRect(
  ctx: ExportSceneContext,
  makeEncoder: (
    width: number,
    height: number,
    fps: number,
  ) => Promise<FrameEncoder>,
): Promise<void> {
  const progress = useExportProgress.getState()
  const engine = getAnimEngine()

  const meta = ctx.api.getMeta()
  const sceneCanvas = meta.canvas
  const fps = ctx.exportFps ?? ctx.frameRate
  const range: ExportRange = ctx.range ?? { kind: 'full' }
  // Resolve to one or more concrete [first, last] frame pairs. For
  // simple ranges this is a one-element array; for `segments` it's the
  // multi-chapter selection in timeline order. The frame loop below is
  // uniform across both shapes.
  const segments = resolveFrameSegments(range, ctx.durationSec, fps)
  const lastSceneFrame = Math.max(0, Math.round(ctx.durationSec * fps) - 1)
  const totalFrames = segments.reduce(
    (acc, s) => acc + (s.lastFrame - s.firstFrame + 1),
    0,
  )
  // For filename derivation we use the bounding range — covers the
  // simple case (single span). The multi-chapter case overrides via
  // the new `chapterTag` option below so the file lands as
  // `Untitled_intro-hold.mp4` instead of a frame-range suffix.
  const firstFrame = segments[0]?.firstFrame ?? 0
  const lastFrame = segments[segments.length - 1]?.lastFrame ?? 0
  const fileName = buildExportFilename(ctx.sceneName, ctx.format, {
    firstFrame,
    lastFrame,
    lastSceneFrame,
    chapterTag: ctx.filenameTag,
  })

  const startToken = progress.cancelToken
  const isCancelled = () =>
    useExportProgress.getState().cancelToken !== startToken

  progress.start(ctx.format, totalFrames, fileName)

  // ---- save and lock editor state ----------------------------------
  const wasPlaying = engine.isPlaying()
  engine.pause()
  const originalPlayhead = engine.getPlayhead()

  const ui = useUI.getState()
  const originalUiPlayhead = ui.playhead
  const originalView = { ...ui.view }
  // Drop zoom to 1 and pan to 0 so the artboard sits at native CSS
  // size centered in the viewport. Necessary because CDP's clip rect
  // captures with all ancestor CSS transforms applied — at the user's
  // current zoom (e.g. 17%), the artboard would render at 17% inside
  // the clip region. Resetting view here keeps render fidelity.
  //
  // The proper "user keeps working during export" fix lives in a
  // separate BrowserWindow that renders the scene independently;
  // that's tracked as v0.2 work.
  ui.setView({ zoom: 1, panX: 0, panY: 0 })

  // Wait two rAFs:
  //   - first lets React commit the new view state
  //   - second lets the browser actually paint the new transform
  await waitForFrames(2)

  // ---- set up the Electron capture session -------------------------
  // zoomFactor stays at 1 — see comment above pickZoomFactor's spot.
  // `quality` is referenced here only so the linter sees it used; the
  // actual resolution falls out of the device pixel ratio.
  void ctx.quality
  void sceneCanvas
  let capture: ElectronCapture
  try {
    // Resolve the chosen quality against the canvas so we know exactly
    // how many pixels the encoder will emit. Used both to size the
    // captured frames (downscaling Retina-doubled raw output) AND to
    // configure the encoder. Drives the H.264 profile cap — without
    // this, a 3840×2880 artboard on a 2× DPR display would capture as
    // 7680×5760 and the encoder rejects it.
    const targetDims = resolveDimensions(ctx.quality, sceneCanvas, ctx.format.id)
    capture = await createElectronCapture({
      zoomFactor: 1,
      // Force the window to fit the artboard's CSS pixel dimensions
      // so capturePage gets the WHOLE artboard rasterized, not just
      // the portion that happened to fit in the user's screen.
      fitViewportTo: { width: sceneCanvas.width, height: sceneCanvas.height },
      // Pin each captured frame to the target output dimensions.
      // Drops the DPR multiplier; encoder gets predictable pixel sizes
      // that stay within H.264 limits.
      outputSize: targetDims,
    })
  } catch (e) {
    progress.setError(e instanceof Error ? e.message : String(e))
    ui.setView(originalView)
    return
  }

  // ---- run the frame loop ------------------------------------------
  // Walk each segment in turn. Output frame index increments across
  // segments so the encoder receives a normal monotonic stream
  // (timestamps are computed from `outputIndex`, not the scene frame
  // — which means non-contiguous chapters get glued back-to-back in
  // the resulting file). Animations that span a chapter break will
  // visually cut, by design — the user picked discrete chapters.
  let encoder: FrameEncoder | null = null
  let smoothedFrameMs = 0
  let outputIndex = 0
  // First frame across the whole export gets two rAFs so font / layout
  // settle costs are absorbed once. Subsequent segment-firsts only
  // need one — they're warm.
  let isFirstFrameOverall = true

  try {
    for (const seg of segments) {
      for (let f = seg.firstFrame; f <= seg.lastFrame; f++) {
        if (isCancelled()) {
          progress.setPhase('cancelled')
          return
        }

        const frameStart = performance.now()
        const t = f / fps
        engine.seek(t)
        ui.setPlayhead(t)

        // engine.seek schedules a React re-render through the
        // useSyncExternalStore subscription, which then has to
        // (1) reconcile, (2) apply the new CSS `transform` on the
        // camera-transform wrapper, and (3) let Chromium repaint
        // before `capturePage` grabs the surface. One rAF is not
        // enough under React 19's concurrent renderer — the commit
        // sometimes lands AFTER the next rAF, so capturePage grabs
        // the previous frame's camera state.
        //
        // Bumping to 3 rAFs per frame (5 on the first) costs ~32ms
        // per frame at 60fps and reliably gives React + the
        // compositor time to flush the new transform. This is what
        // fixes the "preview is correct but export is wrong"
        // symptom on animated cameras.
        await waitForFrames(isFirstFrameOverall ? 5 : 3)
        isFirstFrameOverall = false

        let canvas: HTMLCanvasElement
        try {
          canvas = await capture.capture()
        } catch (e) {
          throw new Error(
            `Failed to capture frame ${outputIndex + 1}/${totalFrames}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }

        // First frame teaches us the encoder's dimensions (zoom factor
        // + device pixel ratio multiply the artboard's CSS size).
        if (!encoder) {
          try {
            encoder = await makeEncoder(canvas.width, canvas.height, fps)
          } catch (e) {
            throw new Error(
              `Failed to initialize encoder: ${
                e instanceof Error ? e.message : String(e)
              }`,
            )
          }
        }

        try {
          await encoder.addFrame(canvas, outputIndex)
        } catch (e) {
          throw new Error(
            `Failed to encode frame ${outputIndex + 1}/${totalFrames}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }

        outputIndex++

        // Yield to the scheduler periodically so the rest of the editor
        // (status pill, Cancel button) stays responsive — even though
        // chrome is CSS-hidden, React commits still happen.
        if (outputIndex % GC_YIELD_EVERY === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }

        const elapsed = performance.now() - frameStart
        smoothedFrameMs =
          smoothedFrameMs === 0
            ? elapsed
            : smoothedFrameMs * 0.85 + elapsed * 0.15
        const framesLeft = totalFrames - outputIndex
        progress.setFrame(outputIndex)
        progress.setEta(framesLeft * smoothedFrameMs, smoothedFrameMs)
      }
    }

    if (isCancelled()) {
      progress.setPhase('cancelled')
      return
    }

    progress.setPhase('encoding')
    if (!encoder) {
      throw new Error('No frames captured — export aborted.')
    }
    const blob = await encoder.finish()

    if (isCancelled()) {
      progress.setPhase('cancelled')
      return
    }

    if (ctx.onBlob) {
      // Headless / programmatic caller — hand the bytes off and skip the
      // browser download dance. The caller (`headlessExport.ts`) ships
      // bytes back to the main process via IPC.
      await ctx.onBlob(blob, fileName)
      progress.setPhase('done')
    } else {
      const url = URL.createObjectURL(blob)
      progress.setDone(url)
      triggerDownload(url, fileName)
    }
  } catch (e) {
    progress.setError(e instanceof Error ? e.message : String(e))
  } finally {
    // Always restore — leaving zoom or pan munged would confuse the
    // user; leaving page zoom at 4 would make the editor unusable.
    try {
      await capture.destroy()
    } catch {
      /* best effort */
    }
    ui.setView(originalView)
    ui.setPlayhead(originalUiPlayhead)
    engine.seek(originalPlayhead)
    if (wasPlaying) engine.play()
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

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
