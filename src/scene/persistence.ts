// SPDX-License-Identifier: Apache-2.0

import { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'

/**
 * Attach IndexedDB persistence to a Y.Doc.
 *
 * Returns the underlying provider plus a `whenSynced` Promise. Await it
 * before inspecting the doc — until it resolves, the doc is still the
 * empty in-memory one, not the hydrated version.
 *
 * Seeding decisions (sample scene, default meta) are caller-owned. Do
 * them after `whenSynced` resolves so you don't race with hydration.
 */

export interface ScenePersistence {
  provider: IndexeddbPersistence
  whenSynced: Promise<void>
  destroy: () => Promise<void>
}

export function persistScene(doc: Y.Doc, dbName = 'hyper-motion-scene'): ScenePersistence {
  const provider = new IndexeddbPersistence(dbName, doc)
  return {
    provider,
    whenSynced: provider.whenSynced.then(() => undefined),
    destroy: async () => {
      await provider.destroy()
    },
  }
}