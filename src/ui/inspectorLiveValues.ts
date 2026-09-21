// SPDX-License-Identifier: Apache-2.0
import type { Layout, Node } from '@/scene'
import type { AnimatedValue } from './hooks/useAnimatedValues'

export function liveInspectorLayout(layout: Layout, anim?: AnimatedValue): Layout {
  if (!anim) return layout
  return {
    ...layout,
    direction: anim.layoutDirection ?? layout.direction,
    gap: anim.layoutGap ?? layout.gap,
    padding: {
      top: anim.layoutPaddingTop ?? layout.padding.top,
      right: anim.layoutPaddingRight ?? layout.padding.right,
      bottom: anim.layoutPaddingBottom ?? layout.padding.bottom,
      left: anim.layoutPaddingLeft ?? layout.padding.left,
    },
  }
}

/** Display-only projection. Patch handlers must keep using the authored nodes. */
export function liveInspectorNode(node: Node, anim?: AnimatedValue): Node {
  if (!anim) return node
  const transform = { ...node.transform }
  for (const key of [
    'x', 'y', 'z', 'rotation', 'rotationX', 'rotationY',
    'scaleX', 'scaleY', 'anchorX', 'anchorY', 'anchorZ',
  ] as const) {
    if (anim[key] !== undefined) transform[key] = anim[key]
  }
  return {
    ...node,
    transform,
    appearance: {
      ...node.appearance,
      opacity: anim.opacity ?? node.appearance.opacity,
      cornerRadius: anim.cornerRadius ?? node.appearance.cornerRadius,
      blendMode: anim.blendMode ?? node.appearance.blendMode,
      fill: anim.fill !== undefined
        ? { kind: 'solid', color: anim.fill }
        : node.appearance.fill,
    },
    ...('size' in node ? { size: {
      width: anim.width ?? node.size.width,
      height: anim.height ?? node.size.height,
    } } : {}),
    ...('layout' in node ? { layout: liveInspectorLayout(node.layout, anim) } : {}),
  }
}
