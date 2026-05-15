// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
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
import { SceneProvider, useSceneAPI } from '@/scene'
import { useKeyboardShortcuts } from '@/ui/hooks/useKeyboardShortcuts'
import { useAnim } from '@/ui/hooks/useAnim'
import { useFigmaPaste } from '@/ui/hooks/useFigmaPaste'
import { useFileMenu } from '@/ui/hooks/useFileMenu'
import {
  migrateCameraScaleToZ,
  normalizeRoot,
  pruneCameraScaleYTracks,
  recenterStaleCamera,
} from '@/ui/actions'
import { useEagerLoadSceneFonts } from '@/ui/fonts/googleFonts'
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

  // Body-level "export mode" toggle. CSS rules in src/index.css key off
  // `data-export-mode='1'` to hide every chrome surface (TopBar, Layers,
  // Inspector, Timeline, FloatingDock, status pill) so only the
  // artboard remains on screen during a render. The orchestrator
  // additionally freezes zoom + pan so the artboard sits at native
  // CSS size, centered, ready for capturePage to grab pixel-correct
  // frames. Toggle is driven by the export progress phase: anything
  // that isn't `idle` / `done` / `error` / `cancelled` counts as an
  // active render.
  useEffect(() => {
    const isActive =
      exportPhase === 'rendering' || exportPhase === 'encoding'
    const body = document.body
    if (isActive) {
      body.setAttribute('data-export-mode', '1')
    } else {
      body.removeAttribute('data-export-mode')
    }
    return () => {
      // Defensive: if the App unmounts mid-export, never leave the
      // editor stranded with chrome hidden.
      body.removeAttribute('data-export-mode')
    }
  }, [exportPhase])
  // Walk the scene and pre-fetch any Google Fonts referenced by text
  // nodes so the canvas renders the right face without waiting for the
  // Inspector to be opened for each one.
  useEagerLoadSceneFonts()

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