// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { bootHeadlessExport } from '@/headlessExport'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Headless render boot. No-ops when not invoked with `--render` flags;
// see src/headlessExport.ts for the full flow. Called outside the React
// tree because the export pipeline only needs the SceneAPI singleton and
// the live DOM, not React context.
void bootHeadlessExport()
