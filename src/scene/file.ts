// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import { createSceneAPI, snapshotScene, type SceneAPI } from '@/scene/doc'
import type { Scene } from '@/scene/types'

/**
 * `.hype` file format — version 1.
 *
 * A `.hype` file is a Yjs document encoded as bytes via
 * `Y.encodeStateAsUpdate(doc)`. That's it. Y.Doc fully captures every
 * piece of scene state (nodes, transforms, tracks, chapters, meta) and
 * the encoded update is the canonical binary form.
 *
 * Why bytes and not JSON: Y's binary format preserves the structural
 * CRDT history we'll need when collaboration ships. JSON would throw
 * that away. Agents that want a JSON view get one via the JSON I/O
 * surface (see below) — round-trips cleanly for new scenes; for scenes
 * with collaborative edit history, JSON is lossy.
 *
 * File on disk:
 *   <bytes of Y.encodeStateAsUpdate(doc)>
 *
 * No header, no version byte. Y itself versions the wire format
 * internally and we'd rather not invent yet another preamble. If the
 * format ever needs to break, we add the version byte then.
 */

/**
 * Serialize a Y.Doc to bytes for on-disk storage.
 */
export function sceneToBytes(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc)
}

/**
 * Apply `.hype` bytes to a Y.Doc. The doc accumulates the update via
 * CRDT merge semantics — call this on a fresh empty Y.Doc to materialize
 * a stored scene, or on an existing doc to merge another scene in.
 */
export function applyBytesToScene(doc: Y.Doc, bytes: Uint8Array): void {
  Y.applyUpdate(doc, bytes)
}

/**
 * Materialize bytes into a fresh Y.Doc + SceneAPI. Useful when you want
 * to inspect a `.hype` file without disturbing the active editor doc.
 */
export function readScene(bytes: Uint8Array): { doc: Y.Doc; api: SceneAPI } {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  const api = createSceneAPI(doc)
  return { doc, api }
}

/**
 * Snapshot a scene as a plain JSON object. The shape is the existing
 * `Scene` interface in `src/scene/types.ts` — agents read and produce
 * this format. Round-trips lossless for newly-created scenes; for
 * scenes with collaborative edit history, the JSON drops history but
 * keeps current state.
 */
export function sceneToJson(api: SceneAPI): Scene {
  return snapshotScene(api)
}

export function sceneToJsonString(api: SceneAPI): string {
  return JSON.stringify(snapshotScene(api), null, 2)
}

/**
 * Apply a plain `Scene` JSON snapshot to a Y.Doc.
 *
 * NOTE: Stubbed for v0.1.0. The proper implementation walks the JSON
 * and recreates nodes / tracks via the SceneAPI's `createNode`,
 * `setMeta`, `createTrack`, etc., translating any agent-supplied IDs
 * through an ID-mapping table. Coming with the v0.1.1 JSON I/O surface.
 *
 * Throws so callers don't silently no-op while the implementation is
 * pending.
 */
export function applyJsonToScene(doc: Y.Doc, json: Scene): SceneAPI {
  // Touch the params so TS doesn't flag them; full implementation
  // walks the JSON and recreates nodes / tracks via SceneAPI. Lands
  // with the v0.1.1 agent authoring API.
  void doc
  void json
  throw new Error(
    'applyJsonToScene is not yet implemented in v0.1.0. ' +
      'JSON import lands in v0.1.1 alongside the agent authoring API.',
  )
}
