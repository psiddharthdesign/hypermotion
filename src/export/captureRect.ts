// SPDX-License-Identifier: Apache-2.0

/**
 * Frame source built on Electron's `webContents.capturePage`.
 *
 * This is the new export-time source of truth. The renderer drives the
 * timeline (engine.seek), then asks main to capture the artboard's
 * on-screen rectangle. Pixel data comes back as PNG bytes, gets decoded
 * into an HTMLCanvasElement, and that canvas is what the encoder
 * ingests — same shape the WebCodecs MP4 / GIF encoders already accept.
 *
 * Why this replaces both prior paths:
 *
 *   - vs. the Pixi offscreen renderer: Pixi was a parallel scene
 *     renderer trying to mirror what the editor's DOM was already
 *     painting. Anything Pixi got subtly wrong (text font cache, image
 *     fills, position math) showed up only in exports. With capturePage
 *     we use the single source of truth — the editor's own DOM — and
 *     never have to keep two renderers in sync.
 *
 *   - vs. getDisplayMedia + MediaRecorder: tab capture grabs the WHOLE
 *     window (chrome, status pill, panels), and then we depended on
 *     ffmpeg.wasm to transcode WebM → MP4 — which Electron's CSP blocks
 *     from loading `ffmpeg-core.js`. capturePage targets only the
 *     artboard rect and feeds WebCodecs directly. No ffmpeg, no chrome
 *     bleed, no permission prompt, no OS recording overlay.
 *
 * Resolution story:
 *
 *   - At zoom factor 1, capturePage returns the artboard at its CSS
 *     size scaled by the device pixel ratio (so retina displays
 *     automatically get HiDPI exports).
 *
 *   - For 2K / 4K from a smaller artboard, the orchestrator calls
 *     `setZoomFactor(scale)` BEFORE the frame loop. Chromium re-
 *     rasterizes the page at the new zoom (text and images stay
 *     crisp — this is rendering, not transform-scaling), and the
 *     subsequent capturePage rects come back with that many more
 *     pixels per CSS unit. We restore the original zoom in destroy().
 */

/**
 * Stable selector for the artboard frame in the editor DOM.
 *
 * Matches the `data-canvas-root` attribute set on the inner artboard
 * div in `Canvas.tsx`. That div has explicit pixel width/height equal
 * to the scene's canvas — its bounding rect IS the artboard rect.
 */
const ARTBOARD_SELECTOR = '[data-canvas-root]'

/**
 * Returns the artboard's viewport rect in CSS pixels.
 *
 * The orchestrator calls this AFTER it has forced the editor zoom to 1
 * and pan to (0, 0) and waited for one rAF — by then `transform: scale`
 * is settled and `getBoundingClientRect()` reflects the artboard's
 * native size on screen.
 */
export function readArtboardRect(): {
  x: number
  y: number
  width: number
  height: number
} | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector<HTMLElement>(ARTBOARD_SELECTOR)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/**
 * Hypermotion preload bridge accessor. The renderer's tsconfig doesn't
 * see the `electron/preload.ts` global augmentation (preload is built
 * separately into `dist-electron/`), so we read off `window` via a
 * narrow cast rather than dragging the preload types into renderer
 * scope. Same pattern used by `useFigmaPaste`.
 */
interface HyperMotionBridge {
  isElectron: true
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}
function getBridge(): HyperMotionBridge | null {
  if (typeof window === 'undefined') return null
  const hm = (window as unknown as { hypermotion?: HyperMotionBridge })
    .hypermotion
  return hm && typeof hm.invoke === 'function' ? hm : null
}

/**
 * Probe — true when running inside the Electron shell with the export
 * IPC bridge wired up. Web tree returns false; orchestrator falls back
 * to the tab-capture path in that case.
 */
export function isElectronCaptureSupported(): boolean {
  return getBridge() !== null
}

export interface ElectronCaptureOptions {
  /**
   * Page-zoom factor to apply BEFORE the frame loop. Use 2 for 2K
   * exports from a 1080p artboard, 4 for 4K. Pass 1 for native size.
   */
  zoomFactor?: number
}

export interface ElectronCapture {
  /**
   * Capture the current artboard. Caller is expected to have seeked
   * the timeline + waited at least one rAF so the DOM reflects the
   * new playhead before this is called.
   */
  capture(): Promise<HTMLCanvasElement>
  /**
   * Restore zoom factor. Always call in a `finally` block — leaving
   * the page zoomed in after a failed export is the worst possible
   * UX.
   */
  destroy(): Promise<void>
}

/**
 * Build a capture session. Sets up zoom (if requested), reads the
 * artboard's rect once, and returns a `capture()` callable that grabs
 * one frame per call. The rect is captured ONCE up front so subsequent
 * frames don't pay for a layout query each time — this is fine because
 * the orchestrator locks the editor's zoom + pan during export.
 */
export async function createElectronCapture(
  opts: ElectronCaptureOptions = {},
): Promise<ElectronCapture> {
  const bridge = getBridge()
  if (!bridge) {
    throw new Error(
      'Electron capture not available. Restart the app or use a WebM export.',
    )
  }
  const invoke = bridge.invoke

  // Apply page zoom FIRST so the rect we read includes the zoomed
  // pixel dimensions. Without this, we'd measure the artboard at zoom
  // 1, then capturePage would return a different size — encoder size
  // mismatch.
  const originalZoom = (await invoke('export:get-zoom-factor')) as number
  const targetZoom = opts.zoomFactor ?? 1
  if (Math.abs(targetZoom - originalZoom) > 0.001) {
    await invoke('export:set-zoom-factor', targetZoom)
    // setZoomFactor doesn't synchronously reflow — wait two rAFs so the
    // page has actually re-laid-out at the new zoom before we measure.
    await waitForFrames(2)
  }

  const initialRect = readArtboardRect()
  if (!initialRect) {
    if (Math.abs(targetZoom - originalZoom) > 0.001) {
      await invoke('export:set-zoom-factor', originalZoom)
    }
    throw new Error(
      'Could not find the artboard on screen. Make sure the canvas is visible before exporting.',
    )
  }

  // Cache one canvas, resize it on first capture and reuse — saves a
  // GC churn cycle per frame on long exports.
  const outCanvas = document.createElement('canvas')
  const outCtx = outCanvas.getContext('2d', { alpha: false })
  if (!outCtx) {
    if (Math.abs(targetZoom - originalZoom) > 0.001) {
      await invoke('export:set-zoom-factor', originalZoom)
    }
    throw new Error('Failed to create output canvas — no 2D context.')
  }

  let destroyed = false

  return {
    async capture(): Promise<HTMLCanvasElement> {
      if (destroyed) throw new Error('capture() called after destroy()')
      // Re-read the rect each frame — cheap (one getBoundingClientRect
      // on a div with no children intersecting it) — so a window
      // resize mid-export doesn't strand us with a stale rect.
      const rect = readArtboardRect() ?? initialRect
      const png = (await invoke('export:capture-rect', rect)) as Uint8Array
      // Cast through BlobPart — Uint8Array<ArrayBufferLike> doesn't
      // satisfy the strict ArrayBuffer-only constraint TS infers under
      // SharedArrayBuffer-aware lib settings, even though the runtime
      // is happy. Same workaround used in transcodeMp4.ts.
      const blob = new Blob([png as BlobPart], { type: 'image/png' })
      const bitmap = await createImageBitmap(blob)
      try {
        if (
          outCanvas.width !== bitmap.width ||
          outCanvas.height !== bitmap.height
        ) {
          outCanvas.width = bitmap.width
          outCanvas.height = bitmap.height
        }
        outCtx.drawImage(bitmap, 0, 0)
      } finally {
        bitmap.close()
      }
      return outCanvas
    },

    async destroy(): Promise<void> {
      if (destroyed) return
      destroyed = true
      if (Math.abs(targetZoom - originalZoom) > 0.001) {
        try {
          await invoke('export:set-zoom-factor', originalZoom)
        } catch {
          /* best effort — never throw out of destroy */
        }
      }
    },
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