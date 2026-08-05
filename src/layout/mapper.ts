// SPDX-License-Identifier: Apache-2.0

import type { Node as YogaNode, Yoga } from 'yoga-layout/load'
import type {
  FlexAlign,
  FlexDirection,
  FlexJustify,
  Layout,
  Node,
  Position,
  SizeAxis,
} from '@/scene/types'
import { makeTextMeasure } from '@/layout/textMeasure'
import { makeVectorMeasure } from '@/layout/vectorMeasure'

/**
 * Pure translation from scene enum values to Yoga enum values.
 *
 * Kept as a separate module so it's easy to unit-test in isolation —
 * no Yoga instance needed to verify the string → enum mapping.
 */

export function toYogaFlexDirection(y: Yoga, d: FlexDirection): number {
  return d === 'row' ? y.FLEX_DIRECTION_ROW : y.FLEX_DIRECTION_COLUMN
}

export function toYogaJustify(y: Yoga, j: FlexJustify): number {
  switch (j) {
    case 'start': return y.JUSTIFY_FLEX_START
    case 'center': return y.JUSTIFY_CENTER
    case 'end': return y.JUSTIFY_FLEX_END
    case 'space-between': return y.JUSTIFY_SPACE_BETWEEN
    case 'space-around': return y.JUSTIFY_SPACE_AROUND
  }
}

export function toYogaAlign(y: Yoga, a: FlexAlign): number {
  switch (a) {
    case 'start': return y.ALIGN_FLEX_START
    case 'center': return y.ALIGN_CENTER
    case 'end': return y.ALIGN_FLEX_END
    case 'stretch': return y.ALIGN_STRETCH
    case 'baseline': return y.ALIGN_BASELINE
  }
}

/**
 * Apply a SizeAxis to a Yoga node on the given axis.
 *   number  → fixed pixels
 *   'hug'   → auto (intrinsic / content-sized)
 *   'fill'  → 100% of parent's available space
 *
 * 'fill' uses percentage rather than flexGrow because it's easier to
 * reason about when the parent isn't a flex container. We may revisit.
 */
export function applySize(yNode: YogaNode, axis: 'width' | 'height', value: SizeAxis): void {
  if (axis === 'width') {
    if (value === 'hug') yNode.setWidthAuto()
    else if (value === 'fill') yNode.setWidth('100%')
    else yNode.setWidth(value)
  } else {
    if (value === 'hug') yNode.setHeightAuto()
    else if (value === 'fill') yNode.setHeight('100%')
    else yNode.setHeight(value)
  }
}

/**
 * Copy all layout-affecting properties from a scene node onto a Yoga node.
 * Leaves (rect, ellipse, image, shader, text) just get size. Containers (frame,
 * component) branch on `layout.mode`:
 *
 *   - 'none' — children are absolutely positioned and their transform.x/y
 *     reads straight through. Stored flow padding is intentionally ignored.
 *   - 'flex' — canonical flex container. direction + justify + align +
 *     gap + padding + wrap.
 *   - 'grid' — flex-row with wrap=true, gap split into rowGap/columnGap,
 *     children set to basis 1/columns in applyChildLayoutInside.
 *
 * Deliberately ignores Transform — that's applied post-layout by the
 * renderer, not by Yoga. If you put transform.x here you're fighting
 * the architecture (see CLAUDE.md invariant).
 */
export function applyNodeStyle(y: Yoga, yNode: YogaNode, node: Node): void {
  if ('size' in node) {
    applySize(yNode, 'width', node.size.width)
    applySize(yNode, 'height', node.size.height)
  }

  if ('layout' in node) {
    applyContainerLayout(y, yNode, node.layout)
  }

  // Text nodes need a measure function so Yoga can resolve `hug` axes
  // to the actual rendered glyph extents — without this, hug/hug text
  // collapses to 0×0 and resize handles are invisible. Yoga only calls
  // the func on axes that are auto/AT_MOST, so fixed-width text still
  // wraps to the declared width but reports an intrinsic height.
  if (node.kind === 'text') {
    yNode.setMeasureFunc(makeTextMeasure(y, node))
  } else if (node.kind === 'vector') {
    yNode.setMeasureFunc(makeVectorMeasure(y, node))
  }
}

function applyContainerLayout(y: Yoga, yNode: YogaNode, l: Layout): void {
  // Padding is a flow-layout property. Keep its authored values in the scene
  // when switching to None, but do not let them offset or shrink freely
  // positioned children.
  const padding =
    l.mode === 'none'
      ? { top: 0, right: 0, bottom: 0, left: 0 }
      : l.padding
  yNode.setPadding(y.EDGE_TOP, padding.top)
  yNode.setPadding(y.EDGE_RIGHT, padding.right)
  yNode.setPadding(y.EDGE_BOTTOM, padding.bottom)
  yNode.setPadding(y.EDGE_LEFT, padding.left)

  if (l.mode === 'flex') {
    yNode.setFlexDirection(toYogaFlexDirection(y, l.direction))
    yNode.setJustifyContent(toYogaJustify(y, l.justify))
    yNode.setAlignItems(toYogaAlign(y, l.align))
    yNode.setGap(y.GUTTER_ALL, l.gap)
    yNode.setFlexWrap(l.wrap ? y.WRAP_WRAP : y.WRAP_NO_WRAP)
    return
  }

  if (l.mode === 'grid') {
    // Implement as flex-row with wrap — Yoga doesn't have a real grid
    // pass. `columns` is enforced by sizing children in
    // applyChildLayoutForParent below (basis = 1/columns of available
    // width). Row and column gaps are set independently via Yoga's
    // GUTTER_ROW / GUTTER_COLUMN.
    //
    // `alignContent = STRETCH` is what makes the grid's rows actually
    // use the parent's full height when the grid is Fill-height. Without
    // it, rows pack tight at the cross-axis start and the remainder of
    // the grid sits empty — which is exactly the "grid height = Fill but
    // the children don't span" bug users hit. Combined with each child's
    // own `align-self: stretch` when its height='fill', the whole grid
    // becomes visible across the parent.
    yNode.setFlexDirection(y.FLEX_DIRECTION_ROW)
    yNode.setJustifyContent(y.JUSTIFY_FLEX_START)
    yNode.setAlignItems(toYogaAlign(y, l.align))
    yNode.setAlignContent(y.ALIGN_STRETCH)
    yNode.setFlexWrap(y.WRAP_WRAP)
    yNode.setGap(y.GUTTER_ROW, l.rowGap)
    yNode.setGap(y.GUTTER_COLUMN, l.columnGap)
    return
  }

  // mode === 'none' — children are positioned absolutely inside, see
  // applyChildLayoutForParent. No flow spacing interferes with transforms.
  yNode.setFlexDirection(y.FLEX_DIRECTION_ROW)
  yNode.setJustifyContent(y.JUSTIFY_FLEX_START)
  yNode.setAlignItems(y.ALIGN_FLEX_START)
  yNode.setGap(y.GUTTER_ALL, 0)
  yNode.setFlexWrap(y.WRAP_NO_WRAP)
}

/**
 * Apply child-of-container rules that depend on the parent's layout
 * mode. Called by the layout engine AFTER applyNodeStyle on the child,
 * so base sizing is already set and we only override what the parent
 * mode requires.
 *
 *   - parent 'none'  → child is positionType=absolute at (0, 0). The
 *     renderer adds transform.x/y on top, so "free positioning" just
 *     means "Yoga doesn't move the child."
 *   - parent 'grid'  → child width is forced to the column cell width
 *     in pixels, so N-per-row wrapping is deterministic. If we don't
 *     know the parent's pixel width (hug / fill), fall back to a
 *     percentage that under-reserves for gaps.
 *   - parent 'flex'  → Fill on the main axis becomes flexGrow=1 with
 *     basis 0; Fill on the cross axis becomes align-self: stretch.
 *     Without this, a child with width='fill' inside a row flex
 *     container would try to take 100% of the parent and stack the
 *     siblings on top of each other.
 *
 * `parentInnerWidth` is the parent's CONTENT-BOX width in pixels (after
 * subtracting padding). Only known when the parent's size is numeric —
 * the engine passes `null` for hug / fill parents.
 */
export function applyChildLayoutForParent(
  y: Yoga,
  yChild: YogaNode,
  parentLayout: Layout,
  childSize: { width: SizeAxis; height: SizeAxis } | null,
  childIndex: number,
  parentInnerWidth: number | null,
  childPosition: Position = 'flow',
): void {
  void childIndex
  // Per-node "absolute position" bypass: if the child opts out of its
  // parent's auto layout, we treat it like a child of a mode='none'
  // parent — Yoga pins it at (0,0) and the renderer composes
  // transform.x/y on top. This matches Figma's "Absolute position"
  // toggle, and is how drawn / dragged elements stay where the user
  // put them even when the Scene later gets an auto layout.
  if (childPosition === 'absolute' || parentLayout.mode === 'none') {
    // Free canvas. Every child is positioned absolutely inside the
    // parent's padded content box; the renderer composes node.transform
    // on top so drag / preset motion reads straight through.
    //
    // Fill handling is subtle here. `setWidth('100%')` on an ABSOLUTE
    // child in Yoga doesn't actually stretch it — you need explicit
    // left+right (or top+bottom) for the absolute child to span the
    // parent. Without this, a `width: fill` element under mode='none'
    // resolved to its intrinsic size, which is the "Fill doesn't fill
    // the scene" bug. Pin left+right (or top+bottom) to 0 per axis when
    // Fill is requested; leave the other axis to use whatever size was
    // set in applyNodeStyle.
    yChild.setPositionType(y.POSITION_TYPE_ABSOLUTE)

    if (childSize?.width === 'fill') {
      yChild.setPosition(y.EDGE_LEFT, 0)
      yChild.setPosition(y.EDGE_RIGHT, 0)
      yChild.setWidthAuto()
    } else {
      yChild.setPosition(y.EDGE_LEFT, 0)
    }

    if (childSize?.height === 'fill') {
      yChild.setPosition(y.EDGE_TOP, 0)
      yChild.setPosition(y.EDGE_BOTTOM, 0)
      yChild.setHeightAuto()
    } else {
      yChild.setPosition(y.EDGE_TOP, 0)
    }
    return
  }

  if (parentLayout.mode === 'grid' && childSize) {
    const cols = Math.max(1, Math.floor(parentLayout.columns))
    if (parentInnerWidth && parentInnerWidth > 0) {
      // Known parent width → compute in pixels. This is the canonical
      // path for the Scene root and any inner frame with a fixed size.
      // Cell width = (available - (cols-1) * columnGap) / cols. Yoga's
      // wrap then packs exactly `cols` items per row with the gap in
      // between, no overflow-induced re-wrap.
      const gapTotal = Math.max(0, (cols - 1) * parentLayout.columnGap)
      const cell = Math.max(1, (parentInnerWidth - gapTotal) / cols)
      yChild.setWidth(cell)
    } else {
      // Fallback for hug/fill parents. Percentage under-reserves for
      // the gap, which is acceptable — users will tend to put grids on
      // known-size containers.
      yChild.setWidth(`${100 / cols}%`)
    }
    // Height handling for grid children:
    //   - 'hug'  → auto (intrinsic size; whatever the child declares)
    //   - 'fill' → align-self: stretch + heightAuto. Combined with the
    //              grid container's alignContent: stretch, this makes
    //              each row take an equal share of the grid's cross-axis
    //              space, and each fill-height child stretches to fill
    //              its row. `setHeight('100%')` does NOT work here —
    //              flex-row-wrap treats height-percentages relative to
    //              the first row, not the whole container.
    //   - number → fixed pixels.
    if (childSize.height === 'hug') {
      yChild.setHeightAuto()
    } else if (childSize.height === 'fill') {
      yChild.setAlignSelf(y.ALIGN_STRETCH)
      yChild.setHeightAuto()
    } else {
      yChild.setHeight(childSize.height)
    }
    return
  }

  if (parentLayout.mode === 'flex' && childSize) {
    const mainIsWidth = parentLayout.direction === 'row'
    // Fill on the main axis → flex-grow. `setFlexBasis(0)` is what
    // makes grow respect the gap correctly. Without this, the child's
    // own width still participates in sizing and the distribution is
    // wrong.
    if (mainIsWidth && childSize.width === 'fill') {
      yChild.setFlexGrow(1)
      yChild.setFlexShrink(1)
      yChild.setFlexBasis(0)
    } else if (!mainIsWidth && childSize.height === 'fill') {
      yChild.setFlexGrow(1)
      yChild.setFlexShrink(1)
      yChild.setFlexBasis(0)
    }
    // Fill on the cross axis → stretch. Yoga's default `align-items`
    // handles this if the container is stretch, but an explicit
    // `align-self: stretch` on the child makes the intent clear even
    // when align-items is center/start/end.
    if (mainIsWidth && childSize.height === 'fill') {
      yChild.setAlignSelf(y.ALIGN_STRETCH)
      yChild.setHeightAuto()
    } else if (!mainIsWidth && childSize.width === 'fill') {
      yChild.setAlignSelf(y.ALIGN_STRETCH)
      yChild.setWidthAuto()
    }
    return
  }
}
