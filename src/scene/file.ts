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
 * Replace a target doc's scene with the scene encoded in `bytes`.
 *
 * Why not just `Y.applyUpdate(target, bytes)`: that does a CRDT merge,
 * which preserves both docs' edit history. If the target doc already
 * has `meta.canvas` set (from its own seed) and the bytes also set it,
 * Y.Map's last-write-wins resolution chooses one by (clientId, clock).
 * In the worst case the result is structurally valid but doesn't match
 * what the user saved — and in our deleteNode-then-applyUpdate pattern,
 * the recent deletes can win over the bytes' resurrects, leaving keys
 * (like `meta.canvas`) effectively undefined.
 *
 * This helper sidesteps all that by materializing the bytes in a fresh
 * side doc, then mirroring its scene-map values back into the target
 * through a single transact. The target's history is preserved as
 * delete-then-set ops, but the resulting state is exactly what the
 * file said — no CRDT conflict resolution involved.
 */
export function loadSceneIntoDoc(targetDoc: Y.Doc, bytes: Uint8Array): void {
  const sideDoc = new Y.Doc()
  Y.applyUpdate(sideDoc, bytes)

  const sideScene = sideDoc.getMap('scene')
  const targetScene = targetDoc.getMap('scene')

  // CRITICAL: `createSceneAPI` closes over the `meta`, `nodes`, `tracks`
  // (etc.) Y.Map instances at creation time. We CANNOT do
  // `targetScene.delete('meta'); targetScene.set('meta', new Y.Map())` —
  // that orphans the API's reference and `api.getMeta()` keeps reading
  // from a detached map, so the loaded scene never appears.
  //
  // Instead we mutate each existing sub-map IN PLACE: clear its keys,
  // then copy the side doc's keys into it. The API's references stay
  // valid and the loaded state shows up immediately.
  targetDoc.transact(() => {
    // Walk all keys that already exist on the target (so we touch the
    // same Y.Map instances the API closed over) plus any new ones the
    // file introduces.
    const allKeys = new Set<string>()
    for (const k of targetScene.keys()) allKeys.add(k)
    for (const k of sideScene.keys()) allKeys.add(k)

    for (const key of allKeys) {
      const sideVal = sideScene.get(key)
      const targetVal = targetScene.get(key)

      if (sideVal === undefined) {
        // File doesn't have this key. Clear the target's map/array if
        // there is one; otherwise delete the scalar key.
        if (targetVal instanceof Y.Map) {
          for (const k of [...targetVal.keys()]) targetVal.delete(k)
        } else if (targetVal instanceof Y.Array) {
          targetVal.delete(0, targetVal.length)
        } else {
          targetScene.delete(key)
        }
        continue
      }

      if (sideVal instanceof Y.Map) {
        // Reuse the existing target Y.Map if there is one (preserves the
        // API's closure reference). Otherwise create a new one.
        let tm = targetVal as Y.Map<unknown> | undefined
        if (!(tm instanceof Y.Map)) {
          tm = new Y.Map<unknown>()
          targetScene.set(key, tm)
        }
        // Clear stale entries, then mirror the side map's contents.
        for (const k of [...tm.keys()]) tm.delete(k)
        for (const [k, v] of sideVal.entries()) tm.set(k, cloneY(v))
      } else if (sideVal instanceof Y.Array) {
        let ta = targetVal as Y.Array<unknown> | undefined
        if (!(ta instanceof Y.Array)) {
          ta = new Y.Array<unknown>()
          targetScene.set(key, ta)
        }
        ta.delete(0, ta.length)
        const items: unknown[] = []
        for (const item of sideVal.toArray()) items.push(cloneY(item))
        if (items.length > 0) ta.push(items)
      } else {
        // Scalar — just overwrite.
        targetScene.set(key, sideVal)
      }
    }
  })

  sideDoc.destroy()
}

/**
 * Deep-clone a Y type (Y.Map / Y.Array) into a fresh Y type owned by
 * no document. Used by `loadSceneIntoDoc` to copy values from a side
 * doc into the active doc without leaking the side doc's lifecycle.
 *
 * Y types throw if you try to attach the same instance to two docs,
 * so this is mandatory — `set(key, sideYMap)` would fail.
 */
function cloneY(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const m = new Y.Map<unknown>()
    for (const [k, v] of value.entries()) m.set(k, cloneY(v))
    return m
  }
  if (value instanceof Y.Array) {
    const a = new Y.Array<unknown>()
    const items: unknown[] = []
    for (const item of value.toArray()) items.push(cloneY(item))
    a.push(items)
    return a
  }
  return value
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
