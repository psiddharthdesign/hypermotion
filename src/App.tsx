// SPDX-License-Identifier: Apache-2.0

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { TopBar } from '@/ui/TopBar'
import { LayersPanel } from '@/ui/LayersPanel'
import { SceneNavigator } from '@/ui/SceneNavigator'
import { Canvas } from '@/ui/Canvas'
import { ComponentEditor } from '@/ui/ComponentEditor'
import { Inspector } from '@/ui/Inspector'
import { Timeline } from '@/ui/Timeline'
import { MasterTimeline } from '@/ui/MasterTimeline'
import { ContextMenu } from '@/ui/ContextMenu'
import { ExportRecordingIndicator } from '@/ui/ExportRecordingIndicator'
import { RenameDialog } from '@/ui/RenameDialog'
import { ErrorBoundary } from '@/ui/ErrorBoundary'
import { UpdateNotice } from '@/ui/UpdateNotice'
import { ToastViewport } from '@/ui/Toast'
import { useUI } from '@/state/ui'
import { SceneProvider, useSceneAPI, useSceneVersion } from '@/scene'
import type { SceneNode } from '@/scene'
import { useKeyboardShortcuts } from '@/ui/hooks/useKeyboardShortcuts'
import { useAnim } from '@/ui/hooks/useAnim'
import { useFigmaPaste } from '@/ui/hooks/useFigmaPaste'
import { useFileMenu } from '@/ui/hooks/useFileMenu'
import {
  centerCameraOnCanvas,
  migrateCameraScaleToZ,
  normalizeRoot,
  pruneCameraScaleYTracks,
  recenterStaleCamera,
  syncComponentInstances,
} from '@/ui/actions'
import type { NodeId } from '@/scene'
import { useEagerLoadSceneFonts } from '@/ui/fonts/googleFonts'
import { useCustomFonts } from '@/ui/fonts/useCustomFonts'
import { useExportProgress } from '@/export/progressStore'
import { useProjectAPI } from '@/project'
import {
  resolvePreviewAudioContributions,
  type SceneAudioOwnership,
} from '@/audio/previewAudio'
import {
  previewAudioLocalDrift,
  resolvePreviewAudioClock,
  shouldSeekPreviewMediaElement,
} from '@/audio/previewPlaybackClock'

/**
 * App shell for hyper-motion.
 *
 * Layout is deliberately Jitter-style:
 *   +--------------------------------------------------+
 *   | TopBar                                           |
 *   +---------+------------------------+---------------+
 *   | Layers  |        Canvas          |   Inspector   |
 *   +---------+------------------------+---------------+
 *   | Timeline                                         |
 *   +--------------------------------------------------+
 *
 * The whole shell is wrapped in <SceneProvider> so any child can reach
 * for useSceneAPI() / useSceneVersion() without prop-drilling. The
 * provider gates rendering until the Y.Doc is hydrated from IndexedDB,
 * so we don't flash an empty layers panel before the data is loaded.
 *
 * `useKeyboardShortcuts` and `useAnim` mount exactly once here, inside
 * SceneProvider so they have access to the scene API. Mounting them at
 * this level (not deeper) keeps the tool/selection/transport wiring in
 * a single place — easier to reason about than scattering listeners.
 */
export default function App() {
  const [isPreview, setIsPreview] = useState(
    () => new URLSearchParams(window.location.search).get('preview') === '1',
  )

  useEffect(() => {
    const syncRoute = () => {
      setIsPreview(
        new URLSearchParams(window.location.search).get('preview') === '1',
      )
    }
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'p') {
        return
      }
      event.preventDefault()
      const url = new URL(window.location.href)
      if (isPreview) url.searchParams.delete('preview')
      else url.searchParams.set('preview', '1')
      url.searchParams.delete('render-window')
      url.searchParams.delete('requestId')
      window.history.pushState(null, '', url.toString())
      window.dispatchEvent(new Event('popstate'))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPreview])

  return (
    <ErrorBoundary>
      <SceneProvider fallback={<BootSplash />}>
        {isPreview ? <PreviewShell /> : <Shell />}
      </SceneProvider>
    </ErrorBoundary>
  )
}

function Shell() {
  const showScenes = useUI((s) => s.panels.scenes)
  const showLayers = useUI((s) => s.panels.layers)
  const showInspector = useUI((s) => s.panels.inspector)
  const showTimeline = useUI((s) => s.panels.timeline)
  const timelineScope = useUI((s) => s.timelineScope)
  const componentEditId = useUI((s) => s.componentEditId)
  const api = useSceneAPI()
  const exportPhase = useExportProgress((s) => s.phase)

  useEffect(() => {
    const previousDensity = document.body.dataset.hmUiDensity
    document.body.dataset.hmUiDensity = 'compact'
    return () => {
      if (previousDensity === undefined) {
        delete document.body.dataset.hmUiDensity
      } else {
        document.body.dataset.hmUiDensity = previousDensity
      }
    }
  }, [])

  // Global wiring — must be mounted once, at the top of the scene tree.
  useKeyboardShortcuts()
  useFigmaPaste()
  useFileMenu()

  // Export-mode body attribute toggling has been REMOVED.
  //
  // Background: the legacy in-editor capture path used a body
  // `data-export-mode='1'` attribute to hide the TopBar, Layers,
  // Inspector, Timeline, FloatingDock, and status pill while the
  // export pipeline captured the editor's own DOM. Combined with a
  // forced zoom-to-100% + pan-to-0 on the workspace, this surfaced
  // the artboard for capturePage to grab. It was visually disruptive
  // and brittle — the user saw their editor flicker, snap, and
  // restore on every export.
  //
  // The new render-window pipeline (electron/main.ts → render-window
  // BrowserWindow → src/render/RenderWindowApp.tsx) runs the export
  // in a separate, hidden BrowserWindow at the exact output dimensions.
  // No editor chrome is ever present in the captured frames because
  // the render window only mounts the canvas. The editor stays
  // fully interactive throughout — pan, zoom, edit anything you
  // want while a 4K export renders in the background.
  //
  // `exportPhase` is still read at the top of this function because
  // some legacy diagnostic might want to know — but it no longer
  // drives any DOM mutation here.
  void exportPhase
  // Walk the scene and pre-fetch any Google Fonts referenced by text
  // nodes so the canvas renders the right face without waiting for the
  // Inspector to be opened for each one.
  useEagerLoadSceneFonts()
  // Register every scene-embedded custom font with document.fonts so
  // measureText / CSS can use them. Notifies layout to re-solve on
  // each registration so freshly-added fonts get correct metrics
  // without a manual refresh.
  useCustomFonts()

  // One-shot migration: earlier builds let users accidentally rotate /
  // scale the Scene root via Inspector fields that no longer exist.
  // Any non-identity transform on the root is reset here so persisted
  // scenes don't render tilted after the Inspector change.
  useEffect(() => {
    // Wrap every migration in a single doc.transact tagged with the
    // 'migration' origin. The Y.UndoManager only tracks transactions
    // with a null origin, so this keeps automatic cleanup writes out
    // of the user's undo stack — the first Cmd+Z reverts the user's
    // most recent edit, not a startup migration.
    api.doc.transact(() => {
      normalizeRoot(api)
      // Migration: pre-uniform-scale cameras may carry a separate
      // `transform.scaleY` track. The renderer now ignores it (camera
      // scale is uniform-from-X), but it would still clutter the
      // timeline. Drop it on first load.
      pruneCameraScaleYTracks(api)
      // Migration: an earlier path created cameras at the artboard
      // bottom-right corner (canvas.width, canvas.height) instead of
      // the intended center. Snap those back so the camera + scene
      // share the same origin again.
      recenterStaleCamera(api)
      // Migration: the camera moved from "Scale" to "Z position" for
      // the dolly axis. Convert any non-identity scale on the camera
      // to an equivalent Z so the user doesn't see their zoom-in
      // suddenly reset.
      migrateCameraScaleToZ(api)
    }, 'migration')
  }, [api])

  // Auto-recenter the camera on the artboard whenever the canvas
  // dimensions change. The user opted in to "camera always points at
  // the middle" — resizing from 1920×1080 to 1080×1920 should snap
  // the camera to the new center rather than leaving it stranded at
  // the previous one. We diff against a previous-size ref so the
  // effect only writes when the size actually changed; this keeps
  // unrelated scene mutations from spamming setNodeProperty.
  const sceneVersion = useSceneVersion()
  const prevCanvasRef = useRef<{ w: number; h: number } | null>(null)
  const componentSignatureRef = useRef<Record<NodeId, string>>({})
  useEffect(() => {
    const meta = api.getMeta()
    const w = meta.canvas?.width ?? 0
    const h = meta.canvas?.height ?? 0
    const prev = prevCanvasRef.current
    if (!prev || prev.w !== w || prev.h !== h) {
      prevCanvasRef.current = { w, h }
      // Tag this as a 'migration' transaction so the recenter doesn't
      // pollute the user's undo stack — Cmd+Z after resizing the
      // canvas should revert the resize, not split into two steps.
      api.doc.transact(() => {
        centerCameraOnCanvas(api)
      }, 'migration')
    }
  })

  // Keep materialized component instances in sync with their master.
  // This is deliberately signature-gated: syncing writes to the scene,
  // which bumps the version, so we only sync when the master's own
  // subtree actually changed.
  useEffect(() => {
    const nextSignatures: Record<NodeId, string> = {}
    for (const id of api.getAllNodeIds()) {
      const node = api.getNode(id)
      if (!node || node.kind !== 'component') continue
      const signature = componentSignature(api, id)
      nextSignatures[id] = signature
      if (componentSignatureRef.current[id] === undefined) continue
      if (componentSignatureRef.current[id] !== signature) {
        api.doc.transact(() => {
          syncComponentInstances(api, id)
        }, 'component-sync')
      }
    }
    componentSignatureRef.current = nextSignatures
  }, [api, sceneVersion])

  return (
    <div
      data-hm-editor-ui="1"
      className="flex h-full w-full flex-col bg-app-bg text-text"
    >
      <AnimationHost />
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {showLayers && <LayersPanel />}
            <div className="relative flex min-w-0 flex-1 flex-col">
              {showScenes && !componentEditId ? <SceneNavigator /> : null}
              {componentEditId ? <ComponentEditor /> : <Canvas />}
            </div>
            {showInspector && <Inspector />}
          </div>
          {showTimeline &&
            !componentEditId &&
            (timelineScope === 'sequence' ? <MasterTimeline /> : <Timeline />)}
        </div>
      </div>
      <AudioPlaybackHost />
      <ContextMenu />
      <RenameDialog />
      <ExportRecordingIndicator />
      <UpdateNotice />
      <ToastViewport />
    </div>
  )
}

/**
 * Keep the animation bridge out of the large editor shells.
 *
 * `useAnim` samples the engine playhead into the UI store during playback.
 * Mounting that subscription directly in `Shell` made every sample reconcile
 * the complete editor (canvas, inspector, layers, and timeline). This tiny
 * leaf owns the subscription without giving those large siblings a per-tick
 * parent render.
 */
function AnimationHost() {
  useAnim()
  return null
}

function AudioPlaybackHost() {
  const api = useSceneAPI()
  const project = useProjectAPI()
  const version = useSceneVersion()
  const previewScope = useUI((state) => state.previewScope)
  const playhead = useUI((state) => state.playhead)
  const uiSelectedSequenceItemId = useUI(
    (state) => state.selectedSequenceItemId,
  )
  const uiActiveCompositionId = useUI(
    (state) => state.activeCompositionId,
  )
  const inventory = useMemo(() => {
    const audioById = new Map<
      string,
      Extract<SceneNode, { kind: 'audio' }>
    >()
    const masterAudioNodeIds: string[] = []
    const sceneAudio: SceneAudioOwnership[] = []
    const rootToSceneId = new Map(
      project.getScenes().map((scene) => [scene.rootNodeId, scene.id]),
    )
    for (const id of api.getAllNodeIds()) {
      const node = api.getNode(id)
      if (node?.kind !== 'audio') continue
      audioById.set(node.id, node)
      if (node.parent === null) {
        masterAudioNodeIds.push(node.id)
        continue
      }
      const sceneId = findOwningAudioSceneId(api, node, rootToSceneId)
      if (sceneId) sceneAudio.push({ audioNodeId: node.id, sceneId })
    }
    return { audioById, masterAudioNodeIds, sceneAudio }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, project, version])
  const timeMap = useMemo(
    () => project.getSequenceTimeMap(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, version],
  )
  const activeCompositionId =
    uiActiveCompositionId ?? project.getActiveSceneId()
  const selectedSequenceItemId =
    uiSelectedSequenceItemId ??
    timeMap.items.find((item) => item.scene.id === activeCompositionId)?.item
      .id ??
    null
  useEffect(() => {
    for (const clip of inventory.audioById.values()) {
      if (!clip.src) continue
      // Decode before an occurrence reaches the program playhead. Scene audio
      // can then enter a crossfade on its first sample instead of waiting for
      // an on-demand fetch/decode after the cut has already started.
      void decodePreviewAudio(clip.src).catch(() => {
        // The mounted contribution will use the media-element fallback.
      })
    }
  }, [inventory.audioById])
  const contributions = useMemo(
    () =>
      resolvePreviewAudioContributions({
        previewScope,
        playhead,
        timeMap,
        selectedSequenceItemId,
        activeCompositionId,
        masterAudioNodeIds: inventory.masterAudioNodeIds,
        sceneAudio: inventory.sceneAudio,
      }),
    [
      activeCompositionId,
      inventory.masterAudioNodeIds,
      inventory.sceneAudio,
      playhead,
      previewScope,
      selectedSequenceItemId,
      timeMap,
    ],
  )

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {contributions.map((contribution) => {
        const clip = inventory.audioById.get(contribution.audioNodeId)
        return clip ? (
          <AudioPlaybackElement
            key={contribution.key}
            node={clip}
            timelineTime={contribution.timelineTime}
            gainScale={contribution.gain}
          />
        ) : null
      })}
    </div>
  )
}

function findOwningAudioSceneId(
  api: ReturnType<typeof useSceneAPI>,
  node: Extract<SceneNode, { kind: 'audio' }>,
  rootToSceneId: ReadonlyMap<string, string>,
): string | null {
  let current: SceneNode | null = node
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const sceneId = rootToSceneId.get(current.id)
    if (sceneId) return sceneId
    current = current.parent ? api.getNode(current.parent) : null
  }
  return null
}

function AudioPlaybackElement({
  node,
  timelineTime,
  gainScale,
}: {
  node: Extract<SceneNode, { kind: 'audio' }>
  timelineTime: number
  gainScale: number
}) {
  const mediaRef = useRef<HTMLAudioElement | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const sourceStartedAtRef = useRef(0)
  const sourceStartedLocalRef = useRef(0)
  const sourceConfigRef = useRef('')
  const [metadataDuration, setMetadataDuration] = useState(0)
  const [decodeTick, setDecodeTick] = useState(0)
  const [fallbackToMediaElement, setFallbackToMediaElement] = useState(false)
  const playing = useUI((s) => s.playing)
  const rate = Math.max(0.05, Math.min(16, node.playbackRate ?? 1))
  const startTime = Number.isFinite(node.startTime) ? node.startTime : 0
  const trimStart = Number.isFinite(node.trimStart) ? node.trimStart : 0
  const sourceDuration =
    Number.isFinite(node.duration) && node.duration > 0
      ? node.duration
      : metadataDuration
  const trimEnd =
    Number.isFinite(node.trimEnd) && node.trimEnd > trimStart
      ? node.trimEnd
      : sourceDuration
  const sourceClipLen = Math.max(0, trimEnd - trimStart)
  const outputGain = previewAudioGain(node.volume, gainScale)
  const playbackClock = resolvePreviewAudioClock({
    timelineTime,
    startTime,
    trimStart,
    trimEnd,
    playbackRate: rate,
    loop: node.loop,
  })
  const local = playbackClock.localTime
  const audioActive = playbackClock.active
  const sourceConfig = `${node.loop ? 1 : 0}:${rate}:${trimStart}:${trimEnd}`

  useEffect(() => {
    const gain = gainRef.current
    if (!gain) return
    smoothPreviewGain(gain, outputGain)
  }, [outputGain])

  useEffect(() => {
    let cancelled = false
    stopAudioSource(sourceRef)
    bufferRef.current = null
    gainRef.current = null

    if (!node.src) return

    void decodePreviewAudio(node.src)
      .then((buffer) => {
        if (cancelled) return
        bufferRef.current = buffer
        setFallbackToMediaElement(false)
        setMetadataDuration(buffer.duration)
        setDecodeTick((tick) => tick + 1)
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[audio] preview decode failed, falling back to media element', err)
          setFallbackToMediaElement(true)
        }
      })

    return () => {
      cancelled = true
      stopAudioSource(sourceRef)
    }
  }, [node.src])

  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    el.muted = node.muted || outputGain <= 0
    el.volume = outputGain
    el.playbackRate = rate
  }, [fallbackToMediaElement, node.muted, outputGain, rate])

  useEffect(() => {
    if (fallbackToMediaElement) return
    const buffer = bufferRef.current
    if (
      !playing ||
      !audioActive ||
      node.muted ||
      outputGain <= 0 ||
      !buffer ||
      sourceClipLen <= 0
    ) {
      stopAudioSource(sourceRef)
      return
    }

    const ctx = getPreviewAudioContext()
    if (!ctx) {
      console.warn('[audio] Web Audio is unavailable in this renderer')
      return
    }

    const current = sourceRef.current
    const expectedLocal = local
    const actualLocal = current
      ? sourceStartedLocalRef.current +
        (ctx.currentTime - sourceStartedAtRef.current) * rate
      : Number.NaN
    const drift = previewAudioLocalDrift({
      actualTime: actualLocal,
      expectedTime: expectedLocal,
      trimStart,
      trimEnd,
      loop: node.loop,
    })
    if (
      current &&
      sourceConfigRef.current === sourceConfig &&
      drift <= 0.35
    ) {
      if (gainRef.current) {
        smoothPreviewGain(gainRef.current, outputGain)
      }
      return
    }

    stopAudioSource(sourceRef)
    void ctx.resume().catch((err) => {
      console.warn('[audio] preview context resume failed', err)
    })
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.loop = node.loop
    source.loopStart = trimStart
    source.loopEnd = trimEnd
    gain.gain.value = outputGain
    source.connect(gain)
    gain.connect(ctx.destination)

    const offset = Math.max(trimStart, Math.min(trimEnd, local))
    const remaining = Math.max(0, trimEnd - offset)
    if (!node.loop && remaining <= 0) return
    source.onended = () => {
      if (sourceRef.current === source) {
        sourceRef.current = null
        gainRef.current = null
      }
    }
    try {
      if (node.loop) source.start(0, offset)
      else source.start(0, offset, remaining)
      sourceRef.current = source
      gainRef.current = gain
      sourceStartedAtRef.current = ctx.currentTime
      sourceStartedLocalRef.current = offset
      sourceConfigRef.current = sourceConfig
    } catch (err) {
      console.warn('[audio] preview source start failed', err)
    }
  }, [
    decodeTick,
    fallbackToMediaElement,
    audioActive,
    local,
    node.loop,
    node.muted,
    outputGain,
    playing,
    rate,
    sourceClipLen,
    sourceConfig,
    startTime,
    timelineTime,
    trimEnd,
    trimStart,
  ])

  useEffect(() => {
    if (!fallbackToMediaElement) return
    const el = mediaRef.current
    if (!el) return
    if (el.readyState < HTMLMediaElement.HAVE_METADATA) {
      el.load()
      return
    }
    if (playing && audioActive && !node.muted && outputGain > 0) {
      if (
        shouldSeekPreviewMediaElement({
          currentTime: el.currentTime,
          expectedTime: local,
          trimStart,
          trimEnd,
          loop: node.loop,
          paused: el.paused,
          tolerance: 0.35,
        })
      ) {
        seekMediaAudioElement(el, local, 0.01)
      }
      if (el.paused) {
        el.play().catch((err) => {
          console.warn('[audio] media-element preview playback failed', err)
        })
      }
      return
    }
    if (!el.paused) el.pause()
    seekMediaAudioElement(el, local, 0.05)
  }, [
    fallbackToMediaElement,
    decodeTick,
    audioActive,
    local,
    node.loop,
    node.muted,
    outputGain,
    playing,
    startTime,
    timelineTime,
    trimEnd,
    trimStart,
  ])

  if (!fallbackToMediaElement || !node.src) return null
  return (
    <audio
      ref={mediaRef}
      src={node.src}
      preload="auto"
      onLoadedMetadata={(event) => {
        const duration = event.currentTarget.duration
        setMetadataDuration(Number.isFinite(duration) ? duration : 0)
        setDecodeTick((tick) => tick + 1)
      }}
      onCanPlay={() => setDecodeTick((tick) => tick + 1)}
      onError={(event) => {
        console.warn('[audio] media-element preview failed to load', event.currentTarget.error)
      }}
    />
  )
}

function previewAudioGain(volume: number, gainScale: number): number {
  const safeVolume = Number.isFinite(volume) ? volume : 1
  const safeScale = Number.isFinite(gainScale) ? gainScale : 0
  return Math.max(0, Math.min(1, safeVolume * safeScale))
}

function smoothPreviewGain(gain: GainNode, value: number): void {
  const now = gain.context.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setTargetAtTime(value, now, 0.015)
}

let sharedPreviewAudioContext: AudioContext | null = null
const previewAudioBufferCache = new Map<string, Promise<AudioBuffer>>()

function getPreviewAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return null
  }
  if (!sharedPreviewAudioContext || sharedPreviewAudioContext.state === 'closed') {
    sharedPreviewAudioContext = new AudioContext()
  }
  return sharedPreviewAudioContext
}

async function decodePreviewAudio(src: string): Promise<AudioBuffer> {
  const cached = previewAudioBufferCache.get(src)
  if (cached) return cached
  const ctx = getPreviewAudioContext()
  if (!ctx) throw new Error('Web Audio is unavailable')
  const pending = fetch(src)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Audio fetch failed (${response.status})`)
      }
      const bytes = await response.arrayBuffer()
      return await ctx.decodeAudioData(bytes.slice(0))
    })
    .catch((error) => {
      previewAudioBufferCache.delete(src)
      throw error
    })
  previewAudioBufferCache.set(src, pending)
  return await pending
}

function stopAudioSource(ref: React.MutableRefObject<AudioBufferSourceNode | null>): void {
  const source = ref.current
  ref.current = null
  if (!source) return
  source.onended = null
  try {
    source.stop()
  } catch {
    // Already stopped.
  }
  source.disconnect()
}

function seekMediaAudioElement(
  el: HTMLAudioElement,
  localTime: number,
  tolerance: number,
): void {
  if (!Number.isFinite(localTime)) return
  const duration =
    Number.isFinite(el.duration) && el.duration > 0
      ? el.duration
      : Number.POSITIVE_INFINITY
  const next = Math.max(0, Math.min(duration, localTime))
  if (Math.abs(el.currentTime - next) <= tolerance) return
  try {
    el.currentTime = next
  } catch (err) {
    console.warn('[audio] media-element preview seek failed', err)
  }
}

function PreviewShell() {
  const api = useSceneAPI()
  const project = useProjectAPI()
  const setPlaying = useUI((s) => s.setPlaying)
  const setPlayhead = useUI((s) => s.setPlayhead)
  const setView = useUI((s) => s.setView)
  const clearSelection = useUI((s) => s.clearSelection)
  const currentFilePath = useUI((s) => s.currentFilePath)
  const playing = useUI((s) => s.playing)
  const playhead = useUI((s) => s.playhead)
  const setIsolatedRange = useUI((s) => s.setIsolatedRange)
  const storedWorkArea = useUI((s) => s.workAreaRange)
  const setStoredWorkArea = useUI((s) => s.setWorkAreaRange)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<PreviewDragState | null>(null)
  const [dragTooltip, setDragTooltip] = useState<{
    mode: 'start' | 'end'
    time: number
  } | null>(null)
  const sceneVersion = useSceneVersion()
  const meta = api.getMeta()
  const duration = Math.max(0.1, meta.duration)
  const frameStep = 1 / Math.max(1, meta.frameRate)
  const minWorkArea = Math.max(frameStep, 0.05)
  const normalizedWorkArea = normalizePreviewWorkArea(
    storedWorkArea ?? { start: 0, end: duration },
    duration,
    minWorkArea,
  )
  const activeComposition = project.getActiveScene()
  const activeCompositionId = activeComposition?.id ?? null
  const compositionWorkAreaStart = activeComposition?.workArea?.start
  const compositionWorkAreaEnd = activeComposition?.workArea?.end

  const commitPreviewWorkArea = useCallback(
    (range: { start: number; end: number } | null) => {
      setStoredWorkArea(range)
      if (activeCompositionId) {
        project.setSceneWorkArea(activeCompositionId, range)
      }
    },
    [activeCompositionId, project, setStoredWorkArea],
  )

  const displayName = (() => {
    if (currentFilePath) {
      const base = currentFilePath.replace(/^.*[\\/]/, '')
      return base.replace(/\.hype$/i, '')
    }
    return api.getMeta().name || 'Untitled'
  })()

  const closePreview = useCallback(() => {
    setPlaying(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('preview')
    window.history.pushState(null, '', url.toString())
    window.dispatchEvent(new Event('popstate'))
  }, [setPlaying])

  useEagerLoadSceneFonts()
  useCustomFonts()

  useEffect(() => {
    document.body.setAttribute('data-preview-mode', '1')
    setIsolatedRange(null)
    const fitPreview = () => {
      const canvas = api.getMeta().canvas ?? { width: 960, height: 540 }
      const paddingX = 48
      const paddingY = 136
      const zoom = Math.min(
        2,
        Math.max(
          0.05,
          Math.min(
            (window.innerWidth - paddingX) / canvas.width,
            (window.innerHeight - paddingY) / canvas.height,
          ),
        ),
      )
      setView({ panX: 0, panY: 0, zoom })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setPlaying(false)
      closePreview()
    }

    clearSelection()
    setPlayhead(0)
    setPlaying(true)
    fitPreview()
    window.addEventListener('resize', fitPreview)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      setPlaying(false)
      document.body.removeAttribute('data-preview-mode')
      window.removeEventListener('resize', fitPreview)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    api,
    clearSelection,
    closePreview,
    setIsolatedRange,
    setPlayhead,
    setPlaying,
    setView,
  ])

  const seekPreview = (next: number) => {
    const clamped = clamp(next, 0, duration)
    setPlaying(false)
    setPlayhead(clamped)
  }

  const togglePlayback = () => {
    if (
      !playing &&
      (playhead < normalizedWorkArea.start ||
        playhead >= normalizedWorkArea.end - 0.001)
    ) {
      setPlayhead(normalizedWorkArea.start)
    }
    setPlaying(!playing)
  }

  useEffect(() => {
    const next =
      compositionWorkAreaStart !== undefined &&
      compositionWorkAreaEnd !== undefined
        ? {
            start: compositionWorkAreaStart,
            end: compositionWorkAreaEnd,
          }
        : null
    setStoredWorkArea(next)
  }, [
    compositionWorkAreaEnd,
    compositionWorkAreaStart,
    sceneVersion,
    setStoredWorkArea,
  ])

  useEffect(() => {
    if (!storedWorkArea) return
    const next = normalizePreviewWorkArea(
      storedWorkArea,
      duration,
      minWorkArea,
    )
    if (
      next.start !== storedWorkArea.start ||
      next.end !== storedWorkArea.end
    ) {
      commitPreviewWorkArea(next)
    }
  }, [
    commitPreviewWorkArea,
    duration,
    minWorkArea,
    storedWorkArea,
  ])

  useEffect(() => {
    if (
      playhead < normalizedWorkArea.start ||
      playhead > normalizedWorkArea.end
    ) {
      setPlayhead(normalizedWorkArea.start)
    }
  }, [normalizedWorkArea.start, normalizedWorkArea.end, playhead, setPlayhead])

  const timeFromPreviewPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration)
  }

  const updateWorkAreaDrag = (clientX: number) => {
    const drag = dragRef.current
    if (!drag) return
    const t = timeFromPreviewPointer(clientX)
    if (drag.mode === 'scrub') {
      setPlayhead(t)
      setDragTooltip(null)
      return
    }
    if (drag.mode === 'start') {
      const nextStart = clamp(
        t,
        0,
        normalizedWorkArea.end - minWorkArea,
      )
      commitPreviewWorkArea({
        start: nextStart,
        end: normalizedWorkArea.end,
      })
      setPlayhead(nextStart)
      setDragTooltip({ mode: 'start', time: nextStart })
      return
    }
    if (drag.mode === 'end') {
      const nextEnd = clamp(
        t,
        normalizedWorkArea.start + minWorkArea,
        duration,
      )
      commitPreviewWorkArea({
        start: normalizedWorkArea.start,
        end: nextEnd,
      })
      setPlayhead(Math.min(playhead, nextEnd))
      setDragTooltip({ mode: 'end', time: nextEnd })
      return
    }
    const delta = t - drag.anchorTime
    const span = drag.startArea.end - drag.startArea.start
    const nextStart = clamp(drag.startArea.start + delta, 0, duration - span)
    commitPreviewWorkArea({ start: nextStart, end: nextStart + span })
    setPlayhead(clamp(drag.startPlayhead + delta, nextStart, nextStart + span))
    setDragTooltip(null)
  }

  const beginPreviewDrag = (
    event: ReactPointerEvent,
    mode: PreviewDragState['mode'],
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setPlaying(false)
    const anchorTime = timeFromPreviewPointer(event.clientX)
    dragRef.current = {
      mode,
      anchorTime,
      startArea: normalizedWorkArea,
      startPlayhead: playhead,
    }
    if (mode === 'scrub') setPlayhead(anchorTime)
    if (mode === 'start' || mode === 'end') {
      setDragTooltip({
        mode,
        time: mode === 'start' ? normalizedWorkArea.start : normalizedWorkArea.end,
      })
    } else {
      setDragTooltip(null)
    }
    trackRef.current?.setPointerCapture(event.pointerId)
  }

  const continuePreviewDrag = (event: ReactPointerEvent) => {
    if (!dragRef.current) return
    event.preventDefault()
    updateWorkAreaDrag(event.clientX)
  }

  const endPreviewDrag = (event: ReactPointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (trackRef.current?.hasPointerCapture(event.pointerId)) {
      trackRef.current.releasePointerCapture(event.pointerId)
    }
    setDragTooltip(null)
  }

  const restartPreview = () => {
    seekPreview(normalizedWorkArea.start)
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-50">
      <AnimationHost />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-3 text-zinc-50">
        <button
          type="button"
          onClick={closePreview}
          className="flex h-7 items-center rounded-md px-3 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
          title="Return to editor"
        >
          {displayName}
        </button>
        <span className="text-zinc-700">/</span>
        <button
          type="button"
          className="flex h-7 items-center gap-2 rounded-md bg-zinc-800 px-3 text-[12px] font-medium text-zinc-50"
          title="Preview tab"
        >
          <span>Preview</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={closePreview}
          className="flex h-7 items-center rounded-md px-3 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
          title="Close preview (Esc)"
        >
          Esc
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <Canvas />
      </div>
      <AudioPlaybackHost />
      <div className="flex h-16 shrink-0 items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-4 text-zinc-50">
        <button
          type="button"
          onClick={restartPreview}
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
          title="Restart preview"
        >
          <PreviewStartIcon />
        </button>
        <button
          type="button"
          onClick={togglePlayback}
          className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
          title={playing ? 'Pause preview' : 'Play preview'}
        >
          {playing ? <PreviewPauseIcon /> : <PreviewPlayIcon />}
        </button>
        <span className="w-14 text-right font-mono text-[11px] tabular-nums text-zinc-300">
          {formatPreviewTime(Math.min(playhead, duration))}
        </span>
        <div
          ref={trackRef}
          className="relative h-9 flex-1 cursor-pointer rounded-md bg-zinc-800"
          onPointerDown={(event) => beginPreviewDrag(event, 'scrub')}
          onPointerMove={continuePreviewDrag}
          onPointerUp={endPreviewDrag}
          onPointerCancel={endPreviewDrag}
          title="Click to scrub. Drag the yellow work area to loop a range."
        >
          <div
            className="absolute bottom-0 top-0 border-x border-zinc-700 bg-zinc-700/55"
            style={{
              left: `${(Math.min(playhead, duration) / duration) * 100}%`,
              width: 1,
            }}
          />
          <div
            className="absolute top-1 bottom-1 rounded border-2 border-[oklch(0.84_0.18_85)] bg-[oklch(0.84_0.18_85)]/14 shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
            style={{
              left: `${(normalizedWorkArea.start / duration) * 100}%`,
              width: `${
                ((normalizedWorkArea.end - normalizedWorkArea.start) /
                  duration) *
                100
              }%`,
            }}
            onPointerDown={(event) => beginPreviewDrag(event, 'move')}
          >
            <div
              className="absolute -left-1 top-0 bottom-0 w-3 cursor-ew-resize rounded-l bg-[oklch(0.84_0.18_85)]"
              onPointerDown={(event) => beginPreviewDrag(event, 'start')}
            />
            <div
              className="absolute -right-1 top-0 bottom-0 w-3 cursor-ew-resize rounded-r bg-[oklch(0.84_0.18_85)]"
              onPointerDown={(event) => beginPreviewDrag(event, 'end')}
            />
          </div>
          {dragTooltip ? (
            <div
              className="pointer-events-none absolute -top-9 z-20 -translate-x-1/2 rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 font-mono text-[11px] tabular-nums text-zinc-950 shadow-lg"
              style={{
                left: `${
                  ((dragTooltip.mode === 'start'
                    ? normalizedWorkArea.start
                    : normalizedWorkArea.end) /
                    duration) *
                  100
                }%`,
              }}
            >
              {formatPreviewTimePrecise(dragTooltip.time)}
              <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-zinc-300 bg-zinc-50" />
            </div>
          ) : null}
        </div>
        <span className="w-14 font-mono text-[11px] tabular-nums text-zinc-500">
          {formatPreviewTime(duration)}
        </span>
      </div>
    </div>
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

interface PreviewWorkArea {
  start: number
  end: number
}

interface PreviewDragState {
  mode: 'scrub' | 'start' | 'end' | 'move'
  anchorTime: number
  startArea: PreviewWorkArea
  startPlayhead: number
}

function normalizePreviewWorkArea(
  range: PreviewWorkArea,
  duration: number,
  minSpan: number,
): PreviewWorkArea {
  const safeDuration = Math.max(0.1, duration)
  const safeMinSpan = Math.min(Math.max(0.001, minSpan), safeDuration)
  const start = clamp(range.start, 0, Math.max(0, safeDuration - safeMinSpan))
  const end = clamp(range.end, start + safeMinSpan, safeDuration)
  return { start, end }
}

function formatPreviewTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const whole = Math.floor(safe)
  const tenths = Math.floor((safe - whole) * 10)
  const minutes = Math.floor(whole / 60)
  const secs = whole % 60
  return `${minutes}:${String(secs).padStart(2, '0')}.${tenths}`
}

function formatPreviewTimePrecise(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const secs = Math.floor(safe % 60)
  const hundredths = Math.floor((safe - Math.floor(safe)) * 100)
  return `${minutes.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`
}

function PreviewStartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 3v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 4.2 6.5 8l5.5 3.8V4.2Z" fill="currentColor" />
    </svg>
  )
}

function PreviewPlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5.5 3.5v9L12 8 5.5 3.5Z" fill="currentColor" />
    </svg>
  )
}

function PreviewPauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5 3.5v9M11 3.5v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function componentSignature(api: ReturnType<typeof useSceneAPI>, id: NodeId): string {
  const visit = (nodeId: NodeId): unknown => {
    const node = api.getNode(nodeId)
    if (!node) return null
    const { id: _id, parent: _parent, children: _children, ...rest } =
      node as unknown as Record<string, unknown>
    void _id
    void _parent
    void _children
    return {
      ...rest,
      tracks: api.getTracksForNode(nodeId),
      children: api.getChildren(nodeId).map((child) => visit(child.id)),
    }
  }
  return JSON.stringify(visit(id))
}

function BootSplash() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-app-bg text-text-dim">
      <span className="font-mono text-[11px] tracking-wider uppercase">
        loading scene…
      </span>
    </div>
  )
}
