// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import { TopBar } from '@/ui/TopBar'
import { LayersPanel } from '@/ui/LayersPanel'
import { Canvas } from '@/ui/Canvas'
import { Inspector } from '@/ui/Inspector'
import { Timeline } from '@/ui/Timeline'
import { ContextMenu } from '@/ui/ContextMenu'
import { ExportRecordingIndicator } from '@/ui/ExportRecordingIndicator'
import { RenameDialog } from '@/ui/RenameDialog'
import { ErrorBoundary } from '@/ui/ErrorBoundary'
import { useUI } from '@/state/ui'
import { SceneProvider, useSceneAPI, useSceneVersion } from '@/scene'
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
} from '@/ui/actions'
import { useEagerLoadSceneFonts } from '@/ui/fonts/googleFonts'
import { useCustomFonts } from '@/ui/fonts/useCustomFonts'
import { useExportProgress } from '@/export/progressStore'

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
  return (
    <ErrorBoundary>
      <SceneProvider fallback={<BootSplash />}>
        <Shell />
      </SceneProvider>
    </ErrorBoundary>
  )
}

function Shell() {
  const showLayers = useUI((s) => s.panels.layers)
  const showInspector = useUI((s) => s.panels.inspector)
  const showTimeline = useUI((s) => s.panels.timeline)
  const api = useSceneAPI()
  const exportPhase = useExportProgress((s) => s.phase)

  // Global wiring — must be mounted once, at the top of the scene tree.
  useKeyboardShortcuts()
  useAnim()
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
  // in a separate, hidden process at the exact output dimensions.
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
  useSceneVersion()
  const prevCanvasRef = useRef<{ w: number; h: number } | null>(null)
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

  return (
    <div className="flex h-full w-full flex-col bg-app-bg text-text">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {showLayers && <LayersPanel />}
        <Canvas />
        {showInspector && <Inspector />}
      </div>
      {showTimeline && <Timeline />}
      <ContextMenu />
      <RenameDialog />
      <ExportRecordingIndicator />
    </div>
  )
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