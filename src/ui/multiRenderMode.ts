// SPDX-License-Identifier: Apache-2.0

import type { Node, Transform } from '@/scene'
import type { SceneAPI } from '@/scene/doc'

export type RenderMode = NonNullable<Transform['renderMode']>

export const RENDER_MODE_OPTIONS: Array<{
  value: RenderMode
  label: string
}> = [
  { value: 'flat', label: 'Flat' },
  { value: 'plane', label: '3D Plane' },
  { value: 'group3d', label: '3D Group' },
]

export function renderModeEligibleNodes(nodes: readonly Node[]): Node[] {
  return nodes.filter(
    (node) => node.kind !== 'camera' && node.kind !== 'audio',
  )
}

/** Apply one render mode to every renderable selected layer as one undo step. */
export function applyRenderModeToSelection(
  api: SceneAPI,
  nodes: readonly Node[],
  renderMode: RenderMode,
): number {
  const targets = renderModeEligibleNodes(nodes)
  if (targets.length === 0) return 0
  api.doc.transact(() => {
    for (const node of targets) {
      api.setNodeProperty(node.id, 'transform', {
        ...node.transform,
        renderMode,
      })
    }
  }, 'multi-render-mode')
  return targets.length
}
