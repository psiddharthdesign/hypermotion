// SPDX-License-Identifier: Apache-2.0

import type { Layout, Node as SceneNode, NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'

/**
 * High-level scene actions that are reused across keyboard shortcuts,
 * the right-click context menu, and (eventually) the top-bar menus.
 *
 * These all call straight into SceneAPI, so they end up in the
 * Y.UndoManager transaction that the keyboard hook sets up. No extra
 * wiring needed for undo/redo.
 */

/**
 * Default layout applied when a new auto-layout frame is created via
 * Shift+A or the right-click "Wrap in auto layout" action. Matches
 * Figma's defaults: horizontal row, 8px gap + padding, hug content.
 */
export const DEFAULT_AUTO_LAYOUT: Layout = {
  mode: 'flex',
  direction: 'row',
  justify: 'start',
  align: 'center',
  gap: 8,
  padding: { top: 8, right: 8, bottom: 8, left: 8 },
  wrap: false,
  columns: 3,
  rowGap: 8,
  columnGap: 8,
}

/**
 * Default layout applied when wrapping in a grid. Two-column grid with
 * 8px gap on both axes — small enough that the cards stay tight but
 * visibly different from the flex default.
 */
export const DEFAULT_GRID_LAYOUT: Layout = {
  mode: 'grid',
  direction: 'row',
  justify: 'start',
  align: 'start',
  gap: 8,
  padding: { top: 8, right: 8, bottom: 8, left: 8 },
  wrap: true,
  columns: 2,
  rowGap: 8,
  columnGap: 8,
}

/**
 * Wrap the given nodes in a new auto-layout frame.
 *
 * Semantics:
 *   - All nodes must share the same parent. If they don't, we bail —
 *     cross-parent wrapping is ambiguous (whose parent wins?) and
 *     Figma silently forbids it too.
 *   - The new frame is created under the common parent, then the
 *     selected nodes are reparented into it in their original order.
 *   - Size is 'hug' on both axes so the frame collapses to its
 *     children — users expand from there if they want a fill / fixed
 *     container.
 *
 * Returns the new frame id, or null on invalid input.
 */
export function wrapInAutoLayout(
  api: SceneAPI,
  ids: NodeId[],
): NodeId | null {
  return wrapInContainer(api, ids, { name: 'Auto layout', layout: DEFAULT_AUTO_LAYOUT })
}

/**
 * Same shape as wrapInAutoLayout but stamps a grid-mode layout on the
 * new container. Users reach this via the "Wrap in grid" context menu
 * entry.
 */
export function wrapInGrid(api: SceneAPI, ids: NodeId[]): NodeId | null {
  return wrapInContainer(api, ids, { name: 'Grid', layout: DEFAULT_GRID_LAYOUT })
}

function wrapInContainer(
  api: SceneAPI,
  ids: NodeId[],
  opts: { name: string; layout: Layout },
): NodeId | null {
  if (ids.length === 0) return null
  const nodes = ids
    .map((id) => api.getNode(id))
    .filter((n): n is SceneNode => !!n)
  if (nodes.length !== ids.length) return null

  // Filter out the root and any orphan camera — those can never be
  // wrapped. If nothing wrappable remains, bail.
  const wrappable = nodes.filter((n) => n.parent != null && n.kind !== 'camera')
  if (wrappable.length === 0) return null

  // Pick a target parent. If everything already shares one, use it
  // (preserves position-in-siblings ordering). Otherwise fall back to
  // the FIRST wrappable node's parent — this lets the user select two
  // unrelated frames and still get a wrap, instead of a silent no-op.
  // The non-matching nodes will be re-parented into the new container.
  const firstParent = wrappable[0]!.parent as NodeId
  const allSameParent = wrappable.every((n) => n.parent === firstParent)
  const parentId = firstParent

  // Preserve child order within the home parent so visual stacking is
  // stable for the same-parent case. For mixed parents, the wrap order
  // matches selection order — there's no canonical sibling list to
  // sort against once parents diverge.
  const sortedIds = allSameParent
    ? (() => {
        const siblings = api.getChildren(parentId).map((c) => c.id)
        return [...ids].sort(
          (a, b) => siblings.indexOf(a) - siblings.indexOf(b),
        )
      })()
    : wrappable.map((n) => n.id)

  // Outer parent's layout mode decides whether the new frame needs a
  // transform offset. Under mode='none', the new frame is absolutely
  // positioned inside the parent — we want it at the selection's
  // bounding-box top-left so the wrap doesn't teleport the visual.
  // Under flex/grid, Yoga places the new frame in flow; a non-zero
  // transform here would smear it off its slot and reintroduce the
  // exact bug we fixed for children. Nested autolayouts must zero out.
  const parentNode = api.getNode(parentId)
  const parentMode =
    parentNode && 'layout' in parentNode ? parentNode.layout.mode : 'none'

  // Compute the bounding box of the selection in PARENT-space so we can
  // place the new frame there (instead of at 0,0 which would visually
  // "teleport" the selection away from its existing position). This is
  // the Figma behavior: wrap keeps everything where it was.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let sawBounds = false
  for (const n of nodes) {
    if (!('size' in n) || !('transform' in n)) continue
    const w = typeof n.size.width === 'number' ? n.size.width : 0
    const h = typeof n.size.height === 'number' ? n.size.height : 0
    if (w <= 0 && h <= 0) continue
    const x = n.transform.x
    const y = n.transform.y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
    sawBounds = true
  }
  const useBoundsOffset = parentMode === 'none' && sawBounds
  const boundsX = useBoundsOffset ? Math.round(minX) : 0
  const boundsY = useBoundsOffset ? Math.round(minY) : 0

  const frameId = api.createNode('frame', parentId, {
    name: opts.name,
    size: { width: 'hug', height: 'hug' },
    layout: { ...opts.layout },
    appearance: {
      opacity: 1,
      fill: null,
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    clipsContent: false,
    // Position the new frame at the selection's top-left. Only meaningful
    // when the outer parent is mode='none'; otherwise zero so the outer
    // parent's flex/grid flow governs (nested autolayouts stay aligned).
    transform: {
      x: boundsX,
      y: boundsY,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    },
  })

  for (const id of sortedIds) {
    api.appendChild(frameId, id)
    // CRITICAL: zero the child's transform when entering a flex/grid
    // container. Yoga flows the child into its slot, and we add
    // transform on top as a post-layout offset. Keeping a pre-wrap
    // dragged transform would smear every child off its slot and make
    // them look like they "vanished". This is exactly the bug users
    // hit: "after Shift+A, elements jump elsewhere."
    const child = api.getNode(id)
    if (!child) continue
    if (opts.layout.mode === 'flex' || opts.layout.mode === 'grid') {
      api.setNodeProperty(id, 'transform', {
        ...child.transform,
        x: 0,
        y: 0,
      })
      // Similarly, if the child had `fill` on either axis from when it
      // sat under mode='none' (where fill means "span the parent"), that
      // will collapse inside a hug/hug frame in flex/grid — Yoga has
      // nothing concrete to stretch against. Pin to a pixel size so the
      // wrapped element is still visible. Prefer the solved numeric size
      // the child had at wrap time, fallback to 100×100.
      if ('size' in child) {
        const nextW =
          typeof child.size.width === 'number' ? child.size.width : 100
        const nextH =
          typeof child.size.height === 'number' ? child.size.height : 100
        const needsPin =
          child.size.width === 'fill' || child.size.height === 'fill'
        if (needsPin) {
          api.setNodeProperty(id, 'size', { width: nextW, height: nextH })
        }
      }
    }
  }
  return frameId
}

/**
 * Dissolve a frame, hoisting its children to the frame's parent at the
 * frame's position in the sibling list, then deleting the frame.
 *
 * Used by "Remove auto layout" and Cmd+Shift+G (ungroup). No-op if the
 * node isn't a frame with a parent.
 */
export function ungroupFrame(api: SceneAPI, frameId: NodeId): NodeId[] {
  const frame = api.getNode(frameId)
  if (!frame || frame.kind !== 'frame' || !frame.parent) return []
  const parentId = frame.parent
  const siblings = api.getChildren(parentId).map((c) => c.id)
  const frameIdx = siblings.indexOf(frameId)
  const kids = api.getChildren(frameId).map((c) => c.id)
  // Reparent each kid, then slide it into position just before the frame.
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!
    api.appendChild(parentId, kid)
    api.moveChild(parentId, kid, Math.max(0, frameIdx + i))
  }
  api.deleteNode(frameId)
  return kids
}

/**
 * Lock (or unlock) a node *and every descendant*.
 *
 * Matches the Figma expectation that locking a container freezes the
 * whole subtree — you can't reach into a locked frame and drag its
 * inner badge, and you don't want to either: a lock you added for
 * "don't let me accidentally move this card" would be meaningless if
 * every child inside it was still hot.
 *
 * Unlocking cascades too, which is the intuitive undo of a cascaded
 * lock. This does mean: if a user had manually locked one nested layer
 * before locking the parent, unlocking the parent also unlocks that
 * nested layer. That's a deliberate simplification — preserving prior
 * per-child lock state would require shadow metadata, and the common
 * case (lock a card → unlock the card) is the one we optimize for.
 *
 * All writes go through setNodeProperty, so Y.UndoManager groups the
 * whole cascade into one undo step via captureTimeout.
 */
export function setLockedRecursive(
  api: SceneAPI,
  id: NodeId,
  locked: boolean,
): void {
  const stack: NodeId[] = [id]
  while (stack.length > 0) {
    const next = stack.pop()!
    const node = api.getNode(next)
    if (!node) continue
    if (node.locked !== locked) {
      api.setNodeProperty(next, 'locked', locked)
    }
    for (const child of api.getChildren(next)) stack.push(child.id)
  }
}

/**
 * Belt-and-braces: keep the root node coherent with the scene meta.
 *
 * The scene root represents the artboard. Two things can drift:
 *   1. Transform. Transforms on root make no sense — there's nothing
 *      "outside" the artboard for it to translate or rotate relative
 *      to. Older scenes may have a non-zero rotation stashed from
 *      before the Inspector hid the Transform fields for root.
 *   2. Size vs. meta.canvas. The artboard's pixel box is stored twice
 *      — meta.canvas (width/height) drives the checkerboard, and
 *      root.size drives the Yoga solve. When they drift (e.g. older
 *      sample scenes had canvas=1470×900 but root=640×360), the flex
 *      solve packs children into the smaller box, leaving the rest of
 *      the artboard empty. We force root.size to be numeric pixels
 *      matching canvas so "center / end" layouts actually fill the
 *      visible artboard.
 *
 * Runs once per load in App.Shell. Silent; no user-visible churn.
 */
export function normalizeRoot(api: SceneAPI): void {
  const rootId = api.getRoot()
  if (!rootId) return
  const root = api.getNode(rootId)
  if (!root) return

  const t = root.transform
  if (
    t.x !== 0 ||
    t.y !== 0 ||
    t.rotation !== 0 ||
    t.scaleX !== 1 ||
    t.scaleY !== 1
  ) {
    api.setNodeProperty(rootId, 'transform', {
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    })
  }

  if ('size' in root) {
    const meta = api.getMeta()
    const canvasW = Math.max(1, Math.round(meta.canvas?.width ?? 0))
    const canvasH = Math.max(1, Math.round(meta.canvas?.height ?? 0))
    if (canvasW > 0 && canvasH > 0) {
      const needsSize =
        root.size.width !== canvasW || root.size.height !== canvasH
      if (needsSize) {
        api.setNodeProperty(rootId, 'size', {
          width: canvasW,
          height: canvasH,
        })
      }
    }
  }
}

/**
 * Strip leftover `transform.scaleY` tracks from cameras. Cameras now
 * use a single uniform-scale model — only `transform.scaleX` carries
 * the animation, and the renderer applies it on both axes. Older
 * sessions that paired both tracks need this one-shot cleanup so the
 * timeline doesn't show a stale "Scale Y" row.
 *
 * Hand-tested decision to delete (rather than convert) the scaleY
 * track: keeping it would either require silently merging into scaleX
 * (lossy if the values diverged) or leaving an inert track that the
 * renderer ignores (confusing). Both worse than just dropping it,
 * which is also what the user expected when they asked for unified
 * camera scale.
 */
export function pruneCameraScaleYTracks(api: SceneAPI): void {
  const cameraId = api.getActiveCameraId()
  if (!cameraId) return
  const tracks = api.getTracksForNode(cameraId)
  const stale = tracks.filter((t) => t.propertyId === 'transform.scaleY')
  if (stale.length === 0) return
  api.doc.transact(() => {
    for (const t of stale) api.deleteTrack(t.id)
  })
}

/**
 * Recenter the camera to the artboard center if it's parked at the
 * artboard's bottom-right CORNER. An earlier code path created
 * cameras at `(canvas.width, canvas.height)` instead of the intended
 * center `(canvas.width / 2, canvas.height / 2)`, which shifted the
 * viewfinder gizmo off the artboard and gave users an apparently
 * disconnected camera+scene. Detects only the exact corner pose so
 * we don't stomp legitimate user pans.
 */
export function recenterStaleCamera(api: SceneAPI): void {
  const cameraId = api.getActiveCameraId()
  if (!cameraId) return
  const camera = api.getNode(cameraId)
  if (!camera || camera.kind !== 'camera') return
  const meta = api.getMeta()
  const w = meta.canvas.width
  const h = meta.canvas.height
  const t = camera.transform
  // Only act on the exact "bottom-right corner" pose. Any other
  // position is treated as user intent.
  const isStaleCorner = t.x === w && t.y === h
  if (!isStaleCorner) return
  api.setNodeProperty(cameraId, 'transform', {
    ...t,
    x: w / 2,
    y: h / 2,
  })
}

/**
 * Snap the active camera's transform x/y to the artboard center.
 *
 * Called whenever the canvas size changes — the user explicitly opted
 * in to "camera always points at the middle." Without this, resizing
 * from 1920×1080 to 1080×1920 leaves the camera parked at the OLD
 * center (960, 540), which is no longer the middle of anything and
 * pushes the visible artboard off-screen in the viewfinder.
 *
 * Z, rotation, scale are preserved — the user's dolly / pan-tilt /
 * zoom intent shouldn't change just because they made the artboard
 * taller.
 */
export function centerCameraOnCanvas(api: SceneAPI): void {
  const cameraId = api.getActiveCameraId()
  if (!cameraId) return
  const camera = api.getNode(cameraId)
  if (!camera || camera.kind !== 'camera') return
  const meta = api.getMeta()
  const targetX = (meta.canvas?.width ?? 0) / 2
  const targetY = (meta.canvas?.height ?? 0) / 2
  const t = camera.transform
  if (t.x === targetX && t.y === targetY) return
  api.setNodeProperty(cameraId, 'transform', { ...t, x: targetX, y: targetY })
}

/**
 * Convert a camera's pre-3D `transform.scaleX` (the legacy "Scale"
 * field) into an equivalent `transform.z`, so the user's previously
 * zoomed-in camera doesn't snap back to identity zoom on the first
 * load after the 3D refactor.
 *
 * Math: the camera renders with apparentScale = FL / (FL - z), so
 *   z = FL × (1 - 1/scale)
 * with FL = 1000 (matches Canvas.tsx). Static-only — animation
 * tracks on transform.scaleX/scaleY are dropped (the camera no
 * longer reads from those tracks; users animate Z instead).
 */
export function migrateCameraScaleToZ(api: SceneAPI): void {
  const cameraId = api.getActiveCameraId()
  if (!cameraId) return
  const camera = api.getNode(cameraId)
  if (!camera || camera.kind !== 'camera') return
  const t = camera.transform
  const FL = 1000
  // Average the two scale axes — older sessions wrote scaleX === scaleY
  // for cameras anyway, but be defensive against asymmetric data.
  const scale = (t.scaleX + t.scaleY) / 2
  const needsConversion = scale !== 1 && t.z === 0
  if (!needsConversion) return
  const z = FL * (1 - 1 / Math.max(0.01, scale))
  api.doc.transact(() => {
    api.setNodeProperty(cameraId, 'transform', {
      ...t,
      z,
      scaleX: 1,
      scaleY: 1,
    })
    // Drop legacy transform.scaleX/scaleY tracks — they don't drive
    // the camera anymore. Z is the dolly axis now.
    const tracks = api.getTracksForNode(cameraId)
    for (const tr of tracks) {
      if (
        tr.propertyId === 'transform.scaleX' ||
        tr.propertyId === 'transform.scaleY'
      ) {
        api.deleteTrack(tr.id)
      }
    }
  })
}