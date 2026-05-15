// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import { createSceneAPI, snapshotScene, type SceneAPI } from '@/scene/doc'
import type { NodeId, Scene } from '@/scene/types'

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
 * This is the agent authoring entrypoint. An AI agent (or any external
 * tool) produces a `Scene` JSON, this function walks it and recreates
 * the full scene graph + tracks + sections via the SceneAPI. Returns a
 * fresh SceneAPI bound to the target doc.
 *
 * ID translation: the JSON's `NodeId` / `TrackId` strings are agent-
 * supplied and need not match the IDs the SceneAPI mints. We walk
 * the tree, call `api.createNode` (which generates a real ID), and
 * thread the agent's references through an `idMap` so parent links,
 * `activeCameraId`, and per-track `nodeId` all translate.
 *
 * Walk order is topological — parentless nodes (root + camera) first,
 * then their children breadth-first — so every `createNode` call sees
 * its parent already realized.
 *
 * The target doc is wiped before the JSON is applied. The auto-seeded
 * camera and any other inherited state goes away so the result is
 * exactly what the JSON described.
 */
export function applyJsonToScene(doc: Y.Doc, json: Scene): SceneAPI {
  // createSceneAPI seeds a default Camera (and, on a brand-new doc,
  // sets up the meta defaults). We wipe everything immediately after
  // so the JSON's content lands on a clean slate — preserving the
  // doc's existing CRDT history but emptying its scene.
  const api = createSceneAPI(doc)

  doc.transact(() => {
    for (const id of api.getAllNodeIds()) {
      api.deleteNode(id)
    }
  })

  // Apply meta (canvas size, duration, framerate, name). setMeta does
  // a shallow patch, so any keys the JSON omits keep their defaults.
  if (json.meta) {
    api.setMeta(json.meta)
  }

  // Map agent IDs → real IDs. Used to translate `parent`, child arrays,
  // track `nodeId`, and `activeCameraId`. We can't pass agent IDs into
  // createNode (it auto-mints its own), so this map is the bridge.
  const idMap = new Map<string, NodeId>()

  // Topological walk: parents before children. We seed the queue with
  // every parentless node (root frame + any standalone cameras), then
  // enqueue each node's children after creating it.
  const queue: string[] = []
  const enqueued = new Set<string>()

  for (const [agentId, node] of Object.entries(json.nodes ?? {})) {
    if (node.parent == null) {
      queue.push(agentId)
      enqueued.add(agentId)
    }
  }

  while (queue.length > 0) {
    const agentId = queue.shift() as string
    const node = json.nodes?.[agentId]
    if (!node) continue

    // Translate the parent reference through the map. Parentless
    // nodes (root + cameras) keep `null` so `createNode` follows its
    // "first parentless non-camera becomes root" path for the artboard.
    const parentReal = node.parent ? (idMap.get(node.parent) ?? null) : null

    // Strip the structural fields createNode owns directly — `kind`
    // and `parent` are positional args, `id` is mint-fresh, and
    // `children` is a Y.Array that createNode builds empty (we
    // populate by creating each child with this node as parent).
    const propsForCreate: Record<string, unknown> = { ...node }
    delete propsForCreate.id
    delete propsForCreate.kind
    delete propsForCreate.parent
    delete propsForCreate.children

    const realId = api.createNode(
      node.kind,
      parentReal,
      propsForCreate as Parameters<SceneAPI['createNode']>[2],
    )
    idMap.set(agentId, realId)

    // Enqueue this node's children (skip ones already queued, in case
    // the agent's JSON has duplicate references in different child
    // arrays — which it shouldn't, but the guard is cheap).
    const children = (node as { children?: NodeId[] }).children ?? []
    for (const childAgentId of children) {
      if (!enqueued.has(childAgentId)) {
        queue.push(childAgentId)
        enqueued.add(childAgentId)
      }
    }
  }

  // Set active camera if the JSON named one (and it was created).
  if (json.activeCameraId) {
    const realCamId = idMap.get(json.activeCameraId)
    if (realCamId) api.setActiveCameraId(realCamId)
  }

  // Recreate tracks with translated nodeIds. The agent supplies its
  // own TrackId values, which we keep (no remapping needed — tracks
  // don't reference each other). Tracks whose `nodeId` doesn't map
  // to a real node (orphaned by a bad agent payload) are skipped so
  // the rest of the import still lands.
  for (const track of Object.values(json.tracks ?? {})) {
    const mappedNodeId = idMap.get(track.nodeId)
    if (!mappedNodeId) continue
    api.setTrack({ ...track, nodeId: mappedNodeId })
  }

  // Sections are stand-alone — no node references — so they go in as-is.
  for (const section of Object.values(json.sections ?? {})) {
    api.setSection(section)
  }

  return api
}
