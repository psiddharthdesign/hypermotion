// SPDX-License-Identifier: Apache-2.0

import type { Node, NodeId, SceneAPI, Size, TextNode } from '@/scene'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

/** Layout and text metrics that can be painted without mutating the scene. */
export interface NodeGeometryPreview {
  size?: Partial<Size>
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
}

export type NodeGeometryPreviewSnapshot = Readonly<
  Record<NodeId, Readonly<NodeGeometryPreview>>
>

export type NodeGeometryPreviewNodeIdsSnapshot = readonly NodeId[]

export interface NodeGeometryPreviewStore {
  getSnapshot: () => NodeGeometryPreviewSnapshot
  /**
   * Stable while a gesture keeps previewing the same nodes, even when their
   * geometry values change every frame. Suitable for useSyncExternalStore
   * consumers that only need to hide/show the active preview nodes.
   */
  getActiveNodeIdsSnapshot: () => NodeGeometryPreviewNodeIdsSnapshot
  subscribe: (listener: () => void) => () => void
  preview: (values: NodeGeometryPreviewSnapshot) => void
  /** Publish the final packet now, then release it after one durable-data paint. */
  finish: () => void
  /** Cancel a gesture without publishing or persisting its pending packet. */
  cancel: () => void
  /** Backwards-compatible spelling shared by the other preview stores. */
  clear: () => void
}

const EMPTY_PREVIEW = Object.freeze({}) as NodeGeometryPreviewSnapshot
const EMPTY_ACTIVE_NODE_IDS = Object.freeze(
  [],
) as NodeGeometryPreviewNodeIdsSnapshot

/**
 * Display-rate geometry and typography kept outside the durable scene doc.
 *
 * Scrub and resize hardware can produce substantially more pointer packets
 * than the display can paint. This store keeps only the latest packet and
 * publishes it once per animation frame, avoiding Yjs writes, persistence,
 * undo entries, and repeated scene-wide subscribers for intermediate values.
 */
export function createNodeGeometryPreviewStore(): NodeGeometryPreviewStore {
  let visible = EMPTY_PREVIEW
  let activeNodeIds = EMPTY_ACTIVE_NODE_IDS
  let pending: NodeGeometryPreviewSnapshot | null = null
  let frame: number | null = null
  let finishFrame: number | null = null
  const listeners = new Set<() => void>()

  const publish = (next: NodeGeometryPreviewSnapshot) => {
    if (visible === next) return
    visible = next
    const nextNodeIds = Object.keys(next).sort()
    if (
      nextNodeIds.length !== activeNodeIds.length ||
      nextNodeIds.some((nodeId, index) => nodeId !== activeNodeIds[index])
    ) {
      activeNodeIds =
        nextNodeIds.length > 0
          ? Object.freeze(nextNodeIds)
          : EMPTY_ACTIVE_NODE_IDS
    }
    for (const listener of listeners) listener()
  }

  const publishPending = () => {
    if (!pending) return
    const next = pending
    pending = null
    publish(next)
  }

  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    if (finishFrame !== null) cancelAnimationFrame(finishFrame)
    frame = null
    finishFrame = null
    pending = null
    publish(EMPTY_PREVIEW)
  }

  return {
    getSnapshot: () => visible,
    getActiveNodeIdsSnapshot: () => activeNodeIds,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    preview: (values) => {
      pending = values
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      finishFrame = null
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        publishPending()
      })
    },
    finish: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      publishPending()
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      finishFrame = requestAnimationFrame(() => {
        finishFrame = null
        publish(EMPTY_PREVIEW)
      })
    },
    cancel,
    clear: cancel,
  }
}

export const nodeGeometryPreviewStore = createNodeGeometryPreviewStore()

export function applyNodeGeometryPreview(
  node: Node,
  preview: Readonly<NodeGeometryPreview> | undefined,
): Node {
  if (!preview) return node

  let result = node
  if (preview.size && 'size' in result) {
    result = {
      ...result,
      size: { ...result.size, ...preview.size },
    } as Node
  }

  if (result.kind === 'text') {
    const textPatch: Partial<
      Pick<TextNode, 'fontSize' | 'lineHeight' | 'letterSpacing'>
    > = {}
    if (preview.fontSize !== undefined) textPatch.fontSize = preview.fontSize
    if (preview.lineHeight !== undefined) textPatch.lineHeight = preview.lineHeight
    if (preview.letterSpacing !== undefined) {
      textPatch.letterSpacing = preview.letterSpacing
    }
    if (Object.keys(textPatch).length > 0) {
      result = { ...result, ...textPatch }
    }
  }

  return result
}

/** Read-only SceneAPI facade whose node queries include transient previews. */
export function sceneAPIWithNodeGeometryPreviews(
  api: SceneAPI,
  values: NodeGeometryPreviewSnapshot,
): SceneAPI {
  if (Object.keys(values).length === 0) return api

  return {
    ...api,
    getNode: (nodeId) => {
      const node = api.getNode(nodeId)
      return node ? applyNodeGeometryPreview(node, values[nodeId]) : null
    },
    getChildren: (nodeId) =>
      api
        .getChildren(nodeId)
        .map((node) => applyNodeGeometryPreview(node, values[node.id])),
  }
}

/**
 * Persist a completed geometry gesture in one undoable Yjs transaction.
 *
 * `onCommit` runs inside that same transaction so auto-key / track authoring
 * can remain one user-visible undo step with the durable property update.
 */
export function commitNodeGeometryPreviews(
  api: SceneAPI,
  values: NodeGeometryPreviewSnapshot,
  onCommit?: (nodeId: NodeId, preview: Readonly<NodeGeometryPreview>) => void,
): void {
  const entries = Object.entries(values)
  if (entries.length === 0) return

  api.doc.transact(() => {
    for (const [nodeId, preview] of entries) {
      const node = api.getNode(nodeId)
      if (!node) continue

      if (preview.size && 'size' in node) {
        api.setNodeProperty(nodeId, 'size', {
          ...node.size,
          ...preview.size,
        })
      }

      if (node.kind === 'text') {
        if (preview.fontSize !== undefined) {
          api.setNodeProperty(nodeId, 'fontSize', preview.fontSize)
        }
        if (preview.lineHeight !== undefined) {
          api.setNodeProperty(nodeId, 'lineHeight', preview.lineHeight)
        }
        if (preview.letterSpacing !== undefined) {
          api.setNodeProperty(nodeId, 'letterSpacing', preview.letterSpacing)
        }
      }

      onCommit?.(nodeId, preview)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
}
