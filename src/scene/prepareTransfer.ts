// SPDX-License-Identifier: Apache-2.0
import * as Y from 'yjs'
import { createSceneSnapshot, projectMediaSources } from './file'

/** Store each original once; cuts and duplicates only carry lightweight references. */
export async function prepareSceneTransfer(doc: Y.Doc, storeSource: (source: string) => Promise<string>) {
  const snapshot = createSceneSnapshot(doc)
  try {
    const sources = new Map<string, string>()
    const nodes = snapshot.getMap('scene').get('nodes')
    if (nodes instanceof Y.Map) {
      for (const node of nodes.values()) {
        if (!(node instanceof Y.Map)) continue
        const source = node.get('src')
        if (typeof source !== 'string' || !/^data:(video|audio)\//.test(source)) continue
        let stored = sources.get(source)
        if (!stored) {
          stored = await storeSource(source)
          sources.set(source, stored)
        }
        node.set('src', stored)
      }
    }
    // Re-clone after replacing sources: the intermediate Y.Doc can retain old items.
    const compact = createSceneSnapshot(snapshot)
    try {
      return { bytes: Y.encodeStateAsUpdate(compact), mediaSources: [...new Set(projectMediaSources(compact))] }
    } finally { compact.destroy() }
  } finally { snapshot.destroy() }
}
