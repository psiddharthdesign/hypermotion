// SPDX-License-Identifier: Apache-2.0

import type { Rect } from '@/layout'
import { measureTextNodeSize } from '@/layout/textMeasure'
import type { Node } from '@/scene'
import {
  applyNodeGeometryPreview,
  type NodeGeometryPreview,
} from '@/ui/nodeGeometryPreviewStore'

/**
 * Resolve the selected node's lightweight preview bounds from its last
 * durable layout. This deliberately does not reflow siblings or rebuild the
 * Yoga tree; the authoritative solve happens once when the gesture commits.
 */
export function nodeGeometryPreviewRect(
  node: Node,
  base: Rect,
  preview: Readonly<NodeGeometryPreview> | undefined,
): Rect {
  if (!preview) return base
  const previewNode = applyNodeGeometryPreview(node, preview)
  let width =
    typeof preview.size?.width === 'number'
      ? Math.max(1, preview.size.width)
      : base.width
  let height =
    typeof preview.size?.height === 'number'
      ? Math.max(1, preview.size.height)
      : base.height

  if (previewNode.kind === 'text') {
    const authoredWidth = previewNode.size.width
    const measurement = measureTextNodeSize(
      previewNode,
      authoredWidth === 'hug' ? undefined : width,
    )
    if (authoredWidth === 'hug' && preview.size?.width === undefined) {
      width = measurement.width
    }
    if (
      previewNode.size.height === 'hug' &&
      preview.size?.height === undefined
    ) {
      height = measurement.height
    }
  }

  return { ...base, width, height }
}
