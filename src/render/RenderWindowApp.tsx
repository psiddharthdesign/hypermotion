// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SceneProvider,
  fillToCss,
  imageBackgroundStyle,
  loadSceneIntoDoc,
  useSceneAPI,
  useSceneVersion,
} from '@/scene'
import type { NodeId } from '@/scene'
import { useAnim } from '@/ui/hooks/useAnim'
import { useLayout } from '@/ui/hooks/useLayout'
import { useAnimatedValues } from '@/ui/hooks/useAnimatedValues'
import { setLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import {
  ScenePostProcessLayer,
  composeInheritedAnim,
  computeCameraDepthOfField,
  resolveCameraFocusTargetPoint,
} from '@/ui/Canvas'
import { getAnimEngine } from '@/anim'
import {
  createElectronCapture,
  isElectronCaptureSupported,
} from '@/export/captureRect'
import { createMp4Encoder } from '@/export/encodeMp4'
import { mixSceneAudioTrack } from '@/export/audioMix'
import { createGifEncoder } from '@/export/encodeGif'
import {
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  buildExportFilename,
  resolveDimensions,
  resolveFrameSegments,
  type ExportFormat,
  type ExportQuality,
  type ExportRange,
} from '@/export/formats'
import { useEagerLoadSceneFonts } from '@/ui/fonts/googleFonts'
import { registerFont } from '@/fonts'
import { useUI } from '@/state/ui'

/**
 * RenderWindowApp — the chrome-less render shell loaded in the hidden
 * BrowserWindow spawned by `export:open-render-window`.
 *
 * This component is mounted when `?render-window=1` is in the URL (see
 * `src/main.tsx`). It carries out the entire export end-to-end:
 *
 *   1. Fetch the render job from main (params + Y.Doc seed bytes) via
 *      `export:fetch-render-job` IPC.
 *   2. Apply the seed bytes onto the (empty) module-scope Y.Doc so the
 *      scene matches the editor's exactly. SceneProvider has already
 *      resolved by now because internals.ts skips IndexedDB in
 *      render-window mode.
 *   3. Mount <RenderCanvas> — paints the scene at the exact output
 *      dimensions, no editor chrome, no overlays, no pan/zoom transform.
 *   4. Wait for first paint + a few rAFs so the canvas is on-screen.
 *   5. Walk the requested frame range, seek the anim engine, capture
 *      each frame via Electron CDP, push into the WebCodecs encoder.
 *   6. Stream progress to the editor via `export:render-window-progress`.
 *   7. On completion, ship the encoded bytes back via
 *      `export:render-window-done`. Main closes this window.
 *
 * Everything below the data fetch is the same code path the editor used
 * to run — just untangled from any view state.
 */

interface HyperMotionBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
}

function getBridge(): HyperMotionBridge | null {
  if (typeof window === 'undefined') return null
  const hm = (window as unknown as { hypermotion?: HyperMotionBridge })
    .hypermotion
  return hm && typeof hm.invoke === 'function' ? hm : null
}

interface RenderJob {
  format: 'mp4' | 'webm' | 'gif'
  quality: 'comp' | '720p' | '2k' | '4k'
  sceneName: string
  durationSec: number
  frameRate: number
  exportFps: number
  outputWidth: number
  outputHeight: number
  range:
    | { kind: 'full' }
    | { kind: 'time'; startSec: number; endSec: number }
    | { kind: 'frames'; startFrame: number; endFrame: number }
    | { kind: 'segments'; segments: Array<{ startSec: number; endSec: number }> }
  filenameTag?: string
  seedBytes: Uint8Array
}

export default function RenderWindowApp({
  requestId,
}: {
  requestId: string | null
}) {
  if (!requestId) {
    return (
      <div style={{ color: 'red', padding: 20, fontFamily: 'monospace' }}>
        Render window opened without a requestId. This window should only
        be spawned by the export pipeline.
      </div>
    )
  }
  return (
    <SceneProvider fallback={<div style={{ background: '#000', width: '100vw', height: '100vh' }} />}>
      <RenderRunner requestId={requestId} />
    </SceneProvider>
  )
}

function RenderRunner({ requestId }: { requestId: string }) {
  const api = useSceneAPI()
  // Anim engine must be attached to the scene so seek() / play() work
  // and the animated-values snapshot drives RenderCanvas paints.
  useAnim()
  // Eagerly load Google Fonts referenced in the scene — without this,
  // text layers render with a fallback face for the first few frames
  // until the font finishes downloading.
  useEagerLoadSceneFonts()

  const [job, setJob] = useState<RenderJob | null>(null)
  const [seedApplied, setSeedApplied] = useState(false)
  const [fontsReady, setFontsReady] = useState(false)
  const exportStartedRef = useRef(false)

  // Step 1: claim our render job from main.
  useEffect(() => {
    const bridge = getBridge()
    if (!bridge) {
      reportError(requestId, 'Render window has no Electron bridge.')
      return
    }
    void (async () => {
      try {
        const fetched = (await bridge.invoke(
          'export:fetch-render-job',
          requestId,
        )) as RenderJob | null
        if (!fetched) {
          reportError(requestId, 'Render job not found. The export may have been cancelled.')
          return
        }
        setJob(fetched)
      } catch (e) {
        reportError(
          requestId,
          `Failed to fetch render job: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    })()
  }, [requestId])

  // Step 2: apply the editor's seed bytes onto our empty doc.
  // `loadSceneIntoDoc` mutates the existing sub-maps in place, which is
  // important because SceneContext's value closes over the API created
  // from this doc — swapping maps would orphan that reference.
  useEffect(() => {
    if (!job) return
    try {
      loadSceneIntoDoc(api.doc, job.seedBytes)
      setSeedApplied(true)
    } catch (e) {
      reportError(
        requestId,
        `Failed to apply scene seed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }, [job, api, requestId])

  // Step 3: BEFORE mounting RenderCanvas, walk the seeded scene and
  // make every referenced Google Font actually loaded. The first time
  // RenderCanvas paints, useLayout's measureText must see the correct
  // font metrics — otherwise text containers get sized to fallback
  // widths (narrower per glyph) and the real font then overflows when
  // it renders ("Team members" → "Team membe").
  //
  // Re-solving when fonts load later (via useFontLoadVersion) is not
  // enough — by the time the re-solve commits, the export loop may
  // already have captured frames against the bad layout. Gating mount
  // on fontsReady eliminates the race entirely.
  useEffect(() => {
    if (!seedApplied) return
    let cancelled = false
    void (async () => {
      try {
        await waitForFontsReadyApi(api)
        // Give React's scheduler a tick to commit any font-load-version
        // bumps from useFontLoadVersion before we flip fontsReady.
        await waitForFrames(2)
        if (!cancelled) setFontsReady(true)
      } catch {
        // Fonts failed — proceed anyway. Worst case is fallback metrics
        // on whichever family stalled, which is no worse than today.
        if (!cancelled) setFontsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [seedApplied, api])

  // Step 4: once fonts are ready, kick off the export. Guarded with a
  // ref so React's double-invoke in StrictMode doesn't start two
  // parallel exports.
  useEffect(() => {
    if (!fontsReady || !job || exportStartedRef.current) return
    exportStartedRef.current = true
    void runExportLoop(api, job, requestId)
  }, [fontsReady, job, api, requestId])

  if (!job || !seedApplied || !fontsReady) {
    // Black surface while we boot. Hidden window so the user never sees
    // this, but matching the artboard's background avoids a one-frame
    // white flash if the window briefly becomes visible.
    return (
      <div
        style={{
          background: '#000',
          width: '100vw',
          height: '100vh',
        }}
      />
    )
  }
  return <RenderCanvas job={job} />
}

/**
 * Pure paint of the artboard at the render window's exact dimensions.
 *
 * Differences from `<Canvas>` (the editor):
 *   - No pan/zoom/transform on a workspace wrapper. The canvas-root sits
 *     at body (0,0).
 *   - The canvas-root carries its own `transform: scale()` to fill the
 *     output dimensions when the user picked a quality preset bigger
 *     than the scene canvas (e.g. 1920×1080 source rendered as 4K).
 *     transformOrigin top-left so it grows toward the bottom-right and
 *     CDP's clip-from-(0,0) captures the full scaled output.
 *   - No SelectionOverlay, no DistanceOverlay, no FloatingDock, no
 *     marquee, no draw preview, no CameraGizmo.
 *   - No pointer-event handlers. The render window is non-interactive.
 *
 * The actual paint code (camera transform, scene fill, SceneLayer) is
 * imported from Canvas.tsx so editor and render-window paint identical
 * pixels for the same scene state.
 */
function RenderCanvas({ job }: { job: RenderJob }) {
  const api = useSceneAPI()
  const version = useSceneVersion()
  const meta = api.getMeta()
  const canvasWidth = meta.canvas?.width ?? 960
  const canvasHeight = meta.canvas?.height ?? 540
  const rootId = api.getRoot() || null
  const rootNode = rootId ? api.getNode(rootId) : null
  const sceneFill = fillToCss(rootNode?.appearance.fill ?? null) ?? null
  const sceneCorner = rootNode?.appearance.cornerRadius ?? 0

  // Layout solve — same hook the editor uses.
  const container = useMemo(
    () => ({ width: canvasWidth, height: canvasHeight }),
    [canvasWidth, canvasHeight],
  )
  const solved = useLayout(rootId, container)
  useEffect(() => {
    setLastSolvedLayout(solved)
  }, [solved])

  const renderOrder = useMemo<NodeId[]>(() => {
    if (!rootId) return []
    const out: NodeId[] = []
    const visit = (id: NodeId) => {
      out.push(id)
      for (const c of api.getChildren(id)) visit(c.id)
    }
    visit(rootId)
    return out
  }, [api, rootId, version])

  const animated = useAnimatedValues(renderOrder)
  const inherited = useMemo(
    () => composeInheritedAnim(api, rootId, animated, solved),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, rootId, animated, solved, version],
  )

  // Camera composition — match the editor's behavior bit-for-bit.
  const cameraId = api.getActiveCameraId()
  const camera = cameraId ? api.getNode(cameraId) : null
  const cameraAnim = cameraId ? animated[cameraId] : undefined

  const cameraBackgroundFill =
    camera && camera.kind === 'camera' ? camera.background ?? null : null
  const cameraBackgroundCss = fillToCss(cameraBackgroundFill ?? null) ?? null
  const cameraBackgroundImageStyle = cameraBackgroundFill
    ? imageBackgroundStyle(cameraBackgroundFill)
    : null

  const cameraFocalLength =
    camera && camera.kind === 'camera'
      ? Math.max(50, camera.focalLength ?? 1000)
      : 1000
  const cameraZ =
    camera && camera.kind === 'camera'
      ? cameraAnim?.z ?? camera.transform.z
      : 0
  const cameraDollyZ = cameraZ / 100
  const cameraScaleFromZ = useMemo(() => {
    const denom = Math.max(1, cameraFocalLength - cameraDollyZ)
    return cameraFocalLength / denom
  }, [cameraDollyZ, cameraFocalLength])

  const cameraTransform = useMemo(() => {
    if (!camera || camera.kind !== 'camera') return null
    const cx = cameraAnim?.x ?? camera.transform.x
    const cy = cameraAnim?.y ?? camera.transform.y
    const rZ = cameraAnim?.rotation ?? camera.transform.rotation
    const rX = cameraAnim?.rotationX ?? camera.transform.rotationX
    const rY = cameraAnim?.rotationY ?? camera.transform.rotationY
    const s = cameraScaleFromZ
    const w = canvasWidth
    const h = canvasHeight
    return (
      `translate(${w / 2}px, ${h / 2}px) ` +
      `scale(${s}, ${s}) ` +
      `rotateX(${-rX}deg) rotateY(${rY}deg) rotateZ(${-rZ}deg) ` +
      `translate(${-cx}px, ${-cy}px)`
    )
  }, [camera, cameraAnim, cameraScaleFromZ, canvasWidth, canvasHeight])

  const cameraDepthOfField = useMemo(
    () => {
      const focusTargetWorld = resolveCameraFocusTargetPoint(
        api,
        camera && camera.kind === 'camera' ? camera : null,
        solved ?? {},
        animated,
        inherited,
        { width: canvasWidth, height: canvasHeight },
      )
      return computeCameraDepthOfField(
        camera && camera.kind === 'camera' ? camera : null,
        cameraAnim,
        cameraScaleFromZ,
        canvasWidth,
        canvasHeight,
        focusTargetWorld,
      )
    },
    [
      api,
      camera,
      cameraAnim,
      cameraScaleFromZ,
      canvasWidth,
      canvasHeight,
      solved,
      animated,
      inherited,
    ],
  )

  // Output scale — the render window's content area is sized to the
  // output dimensions in main. The artboard is rendered at its own
  // CSS size, then scaled (via CSS transform) to fill the window.
  // transformOrigin: 0 0 so the artboard grows toward the bottom-right
  // and CDP's clip rect at (0,0,outW,outH) catches the full output.
  // Re-rasterizes on each scaled paint so text and images stay crisp
  // even when scaled 2× / 3× / 4×.
  const scaleX = job.outputWidth / canvasWidth
  const scaleY = job.outputHeight / canvasHeight
  // Pick the smaller scale to avoid clipping if aspect ratios diverge.
  // resolveDimensions guarantees they match, but defensive math here
  // keeps a misconfigured job from producing letterboxed exports.
  const scale = Math.min(scaleX, scaleY)

  return (
    <div
      // Black backdrop fills the window completely — any window pixels
      // outside the artboard (shouldn't happen if main sized correctly,
      // but defensive) will encode as flat black, not random GPU
      // garbage from an unrasterized region.
      style={{
        background: '#000',
        width: '100vw',
        height: '100vh',
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'hidden',
      }}
    >
      <div
        data-canvas-root
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: canvasWidth,
          height: canvasHeight,
          // CSS-scale up to the output dimensions when the user picked a
          // quality larger than the scene canvas. transformOrigin keeps
          // the top-left pinned at (0,0) so capture math stays trivial.
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: '0 0',
          overflow: 'hidden',
          background: 'var(--color-panel)',
          borderRadius: Math.max(0, sceneCorner),
          perspective: cameraFocalLength,
          perspectiveOrigin: 'center center',
        }}
      >
        {/* Camera viewport background, if any. */}
        {cameraBackgroundImageStyle ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={cameraBackgroundImageStyle}
          />
        ) : cameraBackgroundCss ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: cameraBackgroundCss }}
          />
        ) : null}
        {!solved ? (
          // Should never paint — the export loop waits for solved to
          // become truthy before starting. Defensive marker so a stalled
          // boot is visible during debugging.
          <span style={{ color: '#fff' }}>preparing layout…</span>
        ) : camera && camera.kind === 'camera' ? (
          <ScenePostProcessLayer
            rootId={rootId}
            solved={solved}
            order={renderOrder}
            animated={animated}
            inherited={inherited}
            cameraDepthOfField={cameraDepthOfField}
            sceneFill={sceneFill}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            sceneCorner={sceneCorner}
            includeSceneFill
            sceneContentStyle={
              cameraTransform
                ? {
                    transform: cameraTransform,
                    transformOrigin: '0 0',
                    transformStyle: 'preserve-3d',
                    backfaceVisibility: 'visible',
                  }
                : undefined
            }
          />
        ) : (
          <>
            {sceneFill ? (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: 0,
                  top: 0,
                  width: canvasWidth,
                  height: canvasHeight,
                  background: sceneFill,
                  borderRadius: Math.max(0, sceneCorner),
                }}
              />
            ) : null}
            <ScenePostProcessLayer
              rootId={rootId}
              solved={solved}
              order={renderOrder}
              animated={animated}
              inherited={inherited}
              cameraDepthOfField={cameraDepthOfField}
              sceneFill={sceneFill}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              sceneCorner={sceneCorner}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export loop. Adapted from src/export/orchestrator.ts runCaptureRect, but
// stripped of the editor-window concerns (view state, chrome hiding,
// fitViewportTo). The render window is already exactly the right size and
// has no chrome to hide — so the loop simplifies to seek → capture →
// encode → progress, repeat.
// ---------------------------------------------------------------------------

interface FrameEncoder {
  addFrame(canvas: HTMLCanvasElement, index: number): Promise<void>
  finish(): Promise<Blob>
}

async function runExportLoop(
  api: ReturnType<typeof useSceneAPI>,
  job: RenderJob,
  requestId: string,
): Promise<void> {
  const bridge = getBridge()
  if (!bridge) {
    reportError(requestId, 'No Electron bridge available in render window.')
    return
  }
  if (!isElectronCaptureSupported()) {
    reportError(requestId, 'Electron capture bridge missing in render window.')
    return
  }

  const engine = getAnimEngine()

  // Wait for the canvas to actually paint. SceneProvider + RenderCanvas
  // both committed by the time this function fires, but the browser needs
  // a few frames to compose before the first capture is meaningful.
  await waitForFrames(8)

  // Fonts are guaranteed loaded by the time we get here — RenderRunner
  // gates the mount of RenderCanvas on `fontsReady`. We don't need to
  // wait here. But we DO need a few extra rAFs so the first layout
  // solve has fully committed + the canvas has painted at least once
  // before the first capture.
  await waitForFrames(4)

  const sceneCanvas = {
    width: api.getMeta().canvas?.width ?? job.outputWidth,
    height: api.getMeta().canvas?.height ?? job.outputHeight,
  }

  const format = lookupFormat(job.format)
  const quality = lookupQuality(job.quality)
  // Pass format id so the H.264 cap fires for MP4 — must match the
  // editor's resolveDimensions call in renderWindowClient.ts or the
  // render window would size differently from the BrowserWindow main
  // spawned for it.
  const targetDims = resolveDimensions(quality, sceneCanvas, format.id)
  const range: ExportRange = job.range
  const segments = resolveFrameSegments(range, job.durationSec, job.exportFps)
  const lastSceneFrame = Math.max(
    0,
    Math.round(job.durationSec * job.exportFps) - 1,
  )
  const totalFrames = segments.reduce(
    (acc, s) => acc + (s.lastFrame - s.firstFrame + 1),
    0,
  )
  const audioTrack =
    job.format === 'mp4'
      ? await mixSceneAudioTrack({
          api,
          segments,
          fps: job.exportFps,
        })
      : null
  const firstFrame = segments[0]?.firstFrame ?? 0
  const lastFrame = segments[segments.length - 1]?.lastFrame ?? 0
  const fileName = buildExportFilename(job.sceneName, format, {
    firstFrame,
    lastFrame,
    lastSceneFrame,
    chapterTag: job.filenameTag,
  })

  // Pause + reset playhead so we start at the first frame deterministically.
  engine.pause()
  const ui = useUI.getState()
  const originalPlayhead = ui.playhead
  const originalPlaying = ui.playing
  ui.setPlaying(false)

  let capture: Awaited<ReturnType<typeof createElectronCapture>>
  try {
    capture = await createElectronCapture({
      // No zoomFactor — the render window's WebContents is already at
      // 1.0 by default and there's no editor zoom to fight.
      // No fitViewportTo — main sized the window to exactly outputW × H
      // when it spawned us. Resizing again would be redundant + might
      // race against the visible-window dimensions.
      outputSize: targetDims,
    })
  } catch (e) {
    reportError(
      requestId,
      `Failed to set up capture: ${e instanceof Error ? e.message : String(e)}`,
    )
    return
  }

  let encoder: FrameEncoder | null = null
  let smoothedFrameMs = 0
  let outputIndex = 0
  let isFirstFrameOverall = true

  try {
    reportProgress(requestId, { phase: 'rendering', frame: 0, totalFrames })

    for (const seg of segments) {
      for (let f = seg.firstFrame; f <= seg.lastFrame; f++) {
        const frameStart = performance.now()
        const t = f / job.exportFps
        engine.seek(t)
        useUI.getState().setPlayhead(t)
        // Multiple rAFs to let React commit + Chromium re-rasterize the
        // new playhead before CDP captures the surface. Same heuristic
        // the editor's orchestrator uses — proven against React 19
        // concurrent renderer's late-commit behavior.
        await waitForFrames(isFirstFrameOverall ? 5 : 3)
        isFirstFrameOverall = false

        let canvasEl: HTMLCanvasElement
        try {
          canvasEl = await capture.capture()
        } catch (e) {
          throw new Error(
            `Failed to capture frame ${outputIndex + 1}/${totalFrames}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }
        const focusEffect = resolveRenderWindowFocusEffect(
          api,
          engine.getSnapshot(),
          sceneCanvas,
          { width: canvasEl.width, height: canvasEl.height },
        )
        if (focusEffect) {
          canvasEl = applyCanvasFocusBlur(canvasEl, focusEffect)
        }

        if (!encoder) {
          try {
            if (job.format === 'gif') {
              const gif = createGifEncoder({
                width: canvasEl.width,
                height: canvasEl.height,
                fps: job.exportFps,
              })
              encoder = {
                addFrame: (c) => gif.addFrame(c),
                finish: async () => gif.finish(),
              }
            } else {
              const mp4 = await createMp4Encoder({
                width: canvasEl.width,
                height: canvasEl.height,
                fps: job.exportFps,
                audio: audioTrack,
              })
              encoder = {
                addFrame: (c, i) => mp4.addFrame(c, i),
                finish: async () => mp4.finish(),
              }
            }
          } catch (e) {
            throw new Error(
              `Failed to initialize encoder: ${
                e instanceof Error ? e.message : String(e)
              }`,
            )
          }
        }

        try {
          await encoder.addFrame(canvasEl, outputIndex)
        } catch (e) {
          throw new Error(
            `Failed to encode frame ${outputIndex + 1}/${totalFrames}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          )
        }

        outputIndex++

        // Yield to the scheduler periodically. Even though no UI is
        // mounted, the IPC channel needs the event loop to drain so
        // progress messages reach the editor in real time rather than
        // batching at the end.
        if (outputIndex % 30 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }

        const elapsed = performance.now() - frameStart
        smoothedFrameMs =
          smoothedFrameMs === 0
            ? elapsed
            : smoothedFrameMs * 0.85 + elapsed * 0.15
        reportProgress(requestId, {
          phase: 'rendering',
          frame: outputIndex,
          totalFrames,
          etaMs: (totalFrames - outputIndex) * smoothedFrameMs,
          perFrameMs: smoothedFrameMs,
        })
      }
    }

    reportProgress(requestId, {
      phase: 'encoding',
      frame: outputIndex,
      totalFrames,
    })
    if (!encoder) throw new Error('No frames captured — export aborted.')
    const blob = await encoder.finish()

    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)

    await bridge.invoke('export:render-window-done', {
      requestId,
      bytes,
      fileName,
      mimeType: blob.type || mimeForFormat(job.format),
    })
    // Main destroys this window after a short delay; nothing more to do.
  } catch (e) {
    reportError(requestId, e instanceof Error ? e.message : String(e))
  } finally {
    try {
      await capture.destroy()
    } catch {
      /* best effort */
    }
    const latestUi = useUI.getState()
    latestUi.setPlayhead(originalPlayhead)
    latestUi.setPlaying(originalPlaying)
    engine.seek(originalPlayhead)
    if (originalPlaying) engine.play()
  }
}

function reportProgress(
  requestId: string,
  payload: {
    phase: 'rendering' | 'encoding'
    frame?: number
    totalFrames?: number
    etaMs?: number
    perFrameMs?: number
  },
): void {
  const bridge = getBridge()
  if (!bridge) return
  void bridge.invoke('export:render-window-progress', { requestId, ...payload })
}

function reportError(requestId: string, message: string): void {
  const bridge = getBridge()
  if (!bridge) {
    // eslint-disable-next-line no-console
    console.error('[render-window]', message)
    return
  }
  void bridge.invoke('export:render-window-error', { requestId, message })
}

function lookupFormat(id: 'mp4' | 'webm' | 'gif'): ExportFormat {
  const found = EXPORT_FORMATS.find((f) => f.id === id)
  if (!found) throw new Error(`Unknown format: ${id}`)
  return found
}

function lookupQuality(
  id: 'comp' | '720p' | '2k' | '4k',
): ExportQuality {
  const found = EXPORT_QUALITIES.find((q) => q.id === id)
  if (!found) throw new Error(`Unknown quality: ${id}`)
  return found
}

function mimeForFormat(format: 'mp4' | 'webm' | 'gif'): string {
  switch (format) {
    case 'mp4':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'gif':
      return 'image/gif'
  }
}

interface ExportFocusEffect {
  focusX: number
  focusY: number
  radius: number
  feather: number
  blurPx: number
}

function resolveRenderWindowFocusEffect(
  api: ReturnType<typeof useSceneAPI>,
  animated: ReturnType<ReturnType<typeof getAnimEngine>['getSnapshot']>,
  sceneCanvas: { width: number; height: number },
  outputCanvas: { width: number; height: number },
): ExportFocusEffect | null {
  const cameraId = api.getActiveCameraId()
  const camera = cameraId ? api.getNode(cameraId) : null
  if (!camera || camera.kind !== 'camera' || !camera.depthOfField) return null
  const cameraAnim = animated[cameraId]
  const cameraFocalLength = Math.max(50, camera.focalLength ?? 1000)
  const cameraZ = cameraAnim?.z ?? camera.transform.z
  const cameraDollyZ = cameraZ / 100
  const cameraScale =
    cameraFocalLength / Math.max(1, cameraFocalLength - cameraDollyZ)
  const dof = computeCameraDepthOfField(
    camera,
    cameraAnim,
    cameraScale,
    sceneCanvas.width,
    sceneCanvas.height,
    null,
  )
  if (!dof || !dof.enabled || dof.blurPx <= 0.05) {
    return null
  }
  const scaleX = outputCanvas.width / sceneCanvas.width
  const scaleY = outputCanvas.height / sceneCanvas.height
  const scale = (scaleX + scaleY) / 2
  return {
    focusX: dof.focusX * scaleX,
    focusY: dof.focusY * scaleY,
    radius: Math.max(1, dof.focusRadius * scale),
    feather: Math.max(1, dof.featherPx * scale),
    blurPx: Math.max(0, dof.blurPx * scale),
  }
}

function applyCanvasFocusBlur(
  source: HTMLCanvasElement,
  focus: ExportFocusEffect,
): HTMLCanvasElement {
  const width = source.width
  const height = source.height
  const blur = Math.max(0, Math.min(128, focus.blurPx))
  if (width <= 0 || height <= 0 || blur <= 0.05) return source

  const blurred = document.createElement('canvas')
  blurred.width = width
  blurred.height = height
  const blurredCtx = blurred.getContext('2d', { alpha: false })
  if (!blurredCtx) return source

  // Blur needs pixels outside the frame. If we blur the exact-size canvas,
  // Chromium samples transparent/black beyond the edges, which creates a
  // dark vignette at high blur values. Build a padded edge-clamped copy
  // first, blur that, then crop the original frame region back out.
  const pad = Math.max(8, Math.ceil(blur * 3))
  const padded = document.createElement('canvas')
  padded.width = width + pad * 2
  padded.height = height + pad * 2
  const paddedCtx = padded.getContext('2d', { alpha: false })
  if (!paddedCtx) return source
  paddedCtx.drawImage(source, pad, pad, width, height)
  paddedCtx.drawImage(source, 0, 0, width, 1, pad, 0, width, pad)
  paddedCtx.drawImage(
    source,
    0,
    height - 1,
    width,
    1,
    pad,
    pad + height,
    width,
    pad,
  )
  paddedCtx.drawImage(source, 0, 0, 1, height, 0, pad, pad, height)
  paddedCtx.drawImage(
    source,
    width - 1,
    0,
    1,
    height,
    pad + width,
    pad,
    pad,
    height,
  )
  paddedCtx.drawImage(source, 0, 0, 1, 1, 0, 0, pad, pad)
  paddedCtx.drawImage(source, width - 1, 0, 1, 1, pad + width, 0, pad, pad)
  paddedCtx.drawImage(source, 0, height - 1, 1, 1, 0, pad + height, pad, pad)
  paddedCtx.drawImage(
    source,
    width - 1,
    height - 1,
    1,
    1,
    pad + width,
    pad + height,
    pad,
    pad,
  )

  const paddedBlur = document.createElement('canvas')
  paddedBlur.width = padded.width
  paddedBlur.height = padded.height
  const paddedBlurCtx = paddedBlur.getContext('2d', { alpha: false })
  if (!paddedBlurCtx) return source
  paddedBlurCtx.filter = `blur(${Number(blur.toFixed(2))}px)`
  paddedBlurCtx.drawImage(padded, 0, 0)
  blurredCtx.drawImage(paddedBlur, pad, pad, width, height, 0, 0, width, height)

  const sharp = document.createElement('canvas')
  sharp.width = width
  sharp.height = height
  const sharpCtx = sharp.getContext('2d')
  if (!sharpCtx) return source
  sharpCtx.drawImage(source, 0, 0, width, height)
  sharpCtx.globalCompositeOperation = 'destination-in'
  const radius = Math.max(1, focus.radius)
  const feather = Math.max(1, focus.feather)
  const gradient = sharpCtx.createRadialGradient(
    focus.focusX,
    focus.focusY,
    radius,
    focus.focusX,
    focus.focusY,
    radius + feather,
  )
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)')
  gradient.addColorStop(0.35, 'rgba(0, 0, 0, 0.85)')
  gradient.addColorStop(0.72, 'rgba(0, 0, 0, 0.38)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  sharpCtx.fillStyle = gradient
  sharpCtx.fillRect(0, 0, width, height)

  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const outputCtx = output.getContext('2d', { alpha: false })
  if (!outputCtx) return source
  outputCtx.drawImage(blurred, 0, 0)
  outputCtx.drawImage(sharp, 0, 0)
  return output
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

/**
 * Block until every font referenced by the seeded scene is loaded and
 * ready to measure correctly.
 *
 * This is the THIRD attempt at this wait. Each previous attempt had a
 * race that allowed RenderCanvas to mount and run its first measureText
 * against fallback metrics. The bugs:
 *
 *   Attempt 1 — wait `document.fonts.ready` inside the export loop:
 *     RenderCanvas had already mounted by then and cached the bad
 *     layout. Even when fonts loaded later and triggered a re-solve,
 *     the export sometimes captured before React committed it.
 *
 *   Attempt 2 — gate mount on `document.fonts.load + fonts.ready`:
 *     `fonts.load` returns immediately with NO MATCHING FACES when
 *     called before the `<link>` to Google's CSS has been parsed
 *     (because the `@font-face` rule isn't registered yet). Nothing
 *     was actually pending, so `fonts.ready` resolved immediately too.
 *     We declared ready while the woff2 hadn't even started fetching.
 *
 *   Attempt 3 — call `loadGoogleFont` and await it:
 *     `loadGoogleFont` itself injects the link and then awaits
 *     `fonts.load` in the same microtask — falling into the same
 *     attempt-2 trap. Worse, it dedupes by family, so when
 *     useEagerLoadSceneFonts (mounted before our effect) had already
 *     started, our await returned immediately.
 *
 * This attempt does it correctly:
 *
 *   1. Walk the scene, collect distinct fontFamily values on text nodes.
 *   2. For each family, ensure a `<link>` to Google's CSS is in the
 *      document head. Use a per-family data attribute to dedupe with
 *      any link already injected by `useEagerLoadSceneFonts` so we
 *      don't double-load.
 *   3. AWAIT THE LINK'S `load` EVENT. This is what guarantees the CSS
 *      has been fetched and parsed and the `@font-face` rule is now
 *      registered in `document.fonts`. Until this fires,
 *      `document.fonts.load` cannot find the face and resolves with
 *      nothing pending.
 *   4. NOW call `document.fonts.load('400 16px "<family>"')`. Because
 *      the face is registered, this triggers the actual woff2 fetch
 *      and waits for it. Resolves with the loaded FontFace.
 *   5. (Optional belt-and-suspenders) Await `document.fonts.ready` for
 *      any extra weights browser may have started.
 *
 * 5-second per-family timeout — a stuck CDN shouldn't hang exports.
 * On timeout we proceed; worst case is fallback metrics on that
 * family, which matches the pre-this-fix behavior.
 */
async function waitForFontsReadyApi(
  api: ReturnType<typeof useSceneAPI>,
): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return

  // Step 0: register every scene-embedded CUSTOM font with the
  // browser's FontFaceSet. These ship in the seed bytes (Y.Doc) and
  // are unique to this scene — they're not Google Fonts and there's
  // no <link> to fetch. We register them inline via the FontFace API
  // BEFORE the Google Fonts wait so measureText sees them by the time
  // RenderCanvas's first paint runs.
  //
  // Failures here are non-fatal — `registerFont` returns false on
  // corrupt files. Worst case is fallback metrics for text using that
  // family, same as today.
  const customFonts = api.getAllCustomFonts()
  if (customFonts.length > 0) {
    await Promise.allSettled(
      customFonts.map((font) =>
        Promise.race([registerFont(font), timeoutMs(5000)]),
      ),
    )
  }

  // Step 1: collect every (family, weight) PAIR the scene actually uses.
  //
  // Critically NOT just family. Each weight (regular 400, semibold 600,
  // bold 700) is a SEPARATE woff2 file that has to be downloaded
  // individually. Awaiting only the 400 weight leaves bold text
  // measuring against fallback metrics — what surfaced as "Team membe"
  // (bold heading clipped) while "Filters" (regular weight) rendered
  // fine.
  //
  // Yoga's measure function calls `ctx.measureText(...)` with the font
  // string `<weight> <size>px <family>`. If that weight isn't loaded,
  // measureText falls back to the closest available face. Cached layout
  // ends up sized for fallback metrics; real font overflows at paint.
  const pairs = new Set<string>() // "family|weight"
  const families = new Set<string>()
  const rootId = api.getRoot()
  if (rootId) {
    const visit = (id: string): void => {
      const node = api.getNode(id)
      if (!node) return
      if (node.kind === 'text') {
        const primary = node.fontFamily
          .split(',')[0]
          .trim()
          .replace(/^["']|["']$/g, '')
        if (primary) {
          families.add(primary)
          // fontWeight may be a number (400, 700) or named (e.g.
          // "bold"). Coerce to a number — the @font-face URL uses
          // numeric weights and document.fonts.load expects numeric
          // too. Default to 400 if missing / unparseable.
          const w = normalizeWeight(node.fontWeight)
          pairs.add(`${primary}|${w}`)
        }
      }
      for (const c of api.getChildren(id)) visit(c.id)
    }
    visit(rootId)
  }

  // Step 2: for each family, ensure the <link> is injected and parsed.
  // This registers every weight's @font-face rule in document.fonts
  // (all weights ship in one Google Fonts CSS response).
  await Promise.allSettled(
    [...families].map((family) => ensureFontLinkLoaded(family)),
  )

  // Step 3: for each (family, weight) pair the scene actually uses,
  // trigger and await the woff2 fetch. The browser downloads each
  // weight's woff2 lazily — even though the @font-face rule exists,
  // the file isn't fetched until measureText / paint asks for it.
  // `document.fonts.load` is what makes it fetch.
  await Promise.allSettled(
    [...pairs].map((pair) => {
      const [family, weight] = pair.split('|')
      return Promise.race([
        document.fonts.load(`${weight} 16px "${family}"`).catch(() => {}),
        timeoutMs(5000),
      ])
    }),
  )

  // Step 4: backstop for any leftover loads the browser kicked off.
  await document.fonts.ready
}

/**
 * Normalize a fontWeight value into a numeric weight that matches
 * what Google's CSS @font-face rules use. Defaults to 400.
 */
function normalizeWeight(weight: unknown): number {
  if (typeof weight === 'number' && weight > 0) return Math.round(weight)
  if (typeof weight === 'string') {
    const n = parseInt(weight, 10)
    if (Number.isFinite(n) && n > 0) return n
    const lc = weight.toLowerCase().trim()
    if (lc === 'bold') return 700
    if (lc === 'normal') return 400
    if (lc === 'lighter') return 300
    if (lc === 'bolder') return 700
  }
  return 400
}

/**
 * Ensure the Google Fonts <link> for `family` is in the document head
 * AND has finished loading (CSS parsed, @font-face rules registered).
 *
 * This only handles the LINK stage — not the woff2 fetch for any
 * particular weight. Callers must await `document.fonts.load(...)`
 * for each weight they need.
 */
async function ensureFontLinkLoaded(family: string): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return

  const attr = `data-gf-family`
  let link = document.querySelector<HTMLLinkElement>(
    `link[${attr}="${family}"]`,
  )
  if (!link) {
    link = document.createElement('link')
    link.rel = 'stylesheet'
    const encoded = family.replace(/ /g, '+')
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@100;200;300;400;500;600;700;800;900&display=swap`
    link.setAttribute(attr, family)
    document.head.appendChild(link)
  }
  await waitForLinkLoad(link)
}

function waitForLinkLoad(link: HTMLLinkElement): Promise<void> {
  // Sheet already parsed — no wait needed.
  if (link.sheet) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      link.removeEventListener('load', done)
      link.removeEventListener('error', done)
      resolve()
    }
    link.addEventListener('load', done)
    link.addEventListener('error', done)
    // Belt-and-suspenders: if load never fires (unlikely but possible
    // if a CSP rule blocks the fetch), proceed after 5s.
    setTimeout(done, 5000)
  })
}

function timeoutMs(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
