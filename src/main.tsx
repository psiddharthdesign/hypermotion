// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import RenderWindowApp from '@/render/RenderWindowApp'
import { bootHeadlessExport } from '@/headlessExport'
import '@/index.css'

/**
 * Renderer entry. Two modes:
 *
 *   1. **Editor** — default. Mounts <App>, boots headless-export listener.
 *      This is the user-facing window with all the chrome.
 *
 *   2. **Render window** — when launched with `?render-window=1`. Mounts
 *      <RenderWindowApp> instead, which is a chrome-less canvas-only shell
 *      used by the export pipeline. The editor spawns this via the
 *      `export:open-render-window` IPC; users never see it directly.
 *
 * The branch happens at the top of the entry so the editor surface and
 * its hooks (useFigmaPaste, useFileMenu, useKeyboardShortcuts) never
 * mount inside the render window — they'd interfere with the capture
 * loop and waste resources.
 */
const params = new URLSearchParams(window.location.search)
const isRenderWindow = params.get('render-window') === '1'

if (isRenderWindow) {
  const requestId = params.get('requestId')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RenderWindowApp requestId={requestId} />
    </StrictMode>,
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  // Headless render boot. No-ops when not invoked with `--render` flags;
  // see src/headlessExport.ts for the full flow. Called outside the React
  // tree because the export pipeline only needs the SceneAPI singleton and
  // the live DOM, not React context.
  void bootHeadlessExport().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[headless] boot failed:', err)
  })
}
