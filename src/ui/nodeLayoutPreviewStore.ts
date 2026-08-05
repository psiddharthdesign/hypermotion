// SPDX-License-Identifier: Apache-2.0

import type { Layout, Node, NodeId, SceneAPI } from '@/scene'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

/**
 * A transient layout patch. Padding stays independently patchable so one
 * inspector control does not need to reconstruct the other three sides.
 */
export type NodeLayoutPreview = Partial<Omit<Layout, 'padding'>> & {
  padding?: Partial<Layout['padding']>
}

export type NodeLayoutPreviewSnapshot = Readonly<
  Record<NodeId, Readonly<NodeLayoutPreview>>
>

export interface NodeLayoutPreviewStore {
  getSnapshot: () => NodeLayoutPreviewSnapshot
  subscribe: (listener: () => void) => () => void
  preview: (values: NodeLayoutPreviewSnapshot) => void
  /** Publish the final packet now, then release it after the durable paint. */
  finish: () => void
  /** Cancel without publishing or persisting the pending packet. */
  cancel: () => void
  clear: () => void
}

const EMPTY_PREVIEW = Object.freeze({}) as NodeLayoutPreviewSnapshot

/**
 * Display-rate layout values kept outside the durable scene document.
 *
 * Pointer hardware can deliver substantially more packets than the display
 * can paint. Keeping only the latest packet per animation frame prevents
 * intermediate Yjs writes, persistence, undo entries, and scene-wide durable
 * subscribers while still allowing the layout solver to update live.
 */
export function createNodeLayoutPreviewStore(): NodeLayoutPreviewStore {
  let visible = EMPTY_PREVIEW
  let pending: NodeLayoutPreviewSnapshot | null = null
  let frame: number | null = null
  let finishFrame: number | null = null
  const listeners = new Set<() => void>()

  const publish = (next: NodeLayoutPreviewSnapshot) => {
    if (visible === next) return
    visible = next
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

export const nodeLayoutPreviewStore = createNodeLayoutPreviewStore()

export function applyNodeLayoutPreview(
  node: Node,
  preview: Readonly<NodeLayoutPreview> | undefined,
): Node {
  if (!preview || !('layout' in node)) return node

  return {
    ...node,
    layout: {
      ...node.layout,
      ...preview,
      padding: preview.padding
        ? { ...node.layout.padding, ...preview.padding }
        : node.layout.padding,
    },
  } as Node
}

/** Read-only SceneAPI facade whose layout-node queries include previews. */
export function sceneAPIWithNodeLayoutPreviews(
  api: SceneAPI,
  values: NodeLayoutPreviewSnapshot,
): SceneAPI {
  if (Object.keys(values).length === 0) return api

  return {
    ...api,
    getNode: (nodeId) => {
      const node = api.getNode(nodeId)
      return node ? applyNodeLayoutPreview(node, values[nodeId]) : null
    },
    getChildren: (nodeId) =>
      api
        .getChildren(nodeId)
        .map((node) => applyNodeLayoutPreview(node, values[node.id])),
  }
}

/** Persist a completed layout gesture as one undoable scene transaction. */
export function commitNodeLayoutPreviews(
  api: SceneAPI,
  values: NodeLayoutPreviewSnapshot,
  onCommit?: (nodeId: NodeId, preview: Readonly<NodeLayoutPreview>) => void,
): void {
  const entries = Object.entries(values)
  if (entries.length === 0) return

  api.doc.transact(() => {
    for (const [nodeId, preview] of entries) {
      const node = api.getNode(nodeId)
      if (!node || !('layout' in node)) continue

      api.setNodeProperty(nodeId, 'layout', {
        ...node.layout,
        ...preview,
        padding: preview.padding
          ? { ...node.layout.padding, ...preview.padding }
          : node.layout.padding,
      })
      onCommit?.(nodeId, preview)
    }
  }, UNDOABLE_GESTURE_ORIGIN)
}
