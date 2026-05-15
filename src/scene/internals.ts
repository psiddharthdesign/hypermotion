// SPDX-License-Identifier: Apache-2.0

import { createContext } from 'react'
import * as Y from 'yjs'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import { persistScene } from '@/scene/persistence'
import { createSampleScene } from '@/scene/sample'

/**
 * Internal module-scope singletons for the scene layer.
 *
 * Lives in its own file (separate from SceneProvider) so React
 * Fast Refresh sees only non-component exports here. Not meant
 * to be re-exported from src/scene/index.ts — external callers
 * should go through SceneProvider + the hooks.
 *
 * See context.tsx for why this lives at module scope instead of
 * inside a useEffect.
 */

const doc = new Y.Doc()
const persistence = persistScene(doc)

/**
 * Module-scope handle to the active Y.Doc. Exposed for non-React callers
 * (file save/load via menu, headless export, etc.) that need to read or
 * mutate the doc directly without going through SceneProvider context.
 */
export const sceneDoc = doc

export const apiReady: Promise<SceneAPI> = persistence.whenSynced
  .then(() => {
    try {
      const api = createSceneAPI(doc)
      // Seed the sample scene whenever there is no root frame yet —
      // not "zero nodes." `createSceneAPI` itself auto-seeds a Camera
      // on first run, so a fresh doc reaches this point with one node
      // already present and the old `length === 0` check would skip
      // seeding, leaving us with a camera but no artboard. Every Canvas
      // mutation that needs `rootId` (drawing a rect, importing Figma,
      // pasting from the plugin) silently bails when root is empty.
      if (!api.getRoot()) {
        createSampleScene(api)
      }
      // Dev-only: expose the API on window so you can poke at the scene
      // from the DevTools console (e.g. `scene.setNodeProperty(id, 'layout', ...)`).
      // Vite strips `import.meta.env.DEV` to `false` in production, so this
      // whole block is tree-shaken out of the bundle.
      if (import.meta.env.DEV) {
        ;(globalThis as unknown as { scene: SceneAPI }).scene = api
      }
      return api
    } catch (err) {
      // Surface module-load errors loudly. Without this, a thrown read
      // (e.g. a stale doc shape that one of our recent migrations
      // doesn't tolerate) silently rejects apiReady and the whole app
      // shows a blank screen because SceneProvider is stuck on its
      // fallback. Logging here lets the error reach devtools console.
      // eslint-disable-next-line no-console
      console.error('[hyper-motion] failed to initialize scene API:', err)
      throw err
    }
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[hyper-motion] apiReady rejected:', err)
    throw err
  })

export const SceneContext = createContext<SceneAPI | null>(null)