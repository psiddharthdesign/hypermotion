// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useSceneAPI,
  useSceneVersion,
  fillToCss,
  imageBackgroundStyle,
} from '@/scene'
import type { Node as SceneNode, NodeId, NodeKind, Stroke } from '@/scene'
import type { Rect, SolvedLayout } from '@/layout'
import type { SceneAPI } from '@/scene/doc'
import { useLayout } from '@/ui/hooks/useLayout'
import { setLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import { useUI } from '@/state/ui'
import type { Tool } from '@/state/ui'
import { SelectionOverlay } from '@/ui/SelectionOverlay'
import { DistanceOverlay } from '@/ui/DistanceOverlay'
import { useAnimatedValues, type AnimatedValue } from '@/ui/hooks/useAnimatedValues'
import { useDragToMove } from '@/ui/hooks/useDragToMove'
import { buildNodeContextMenu } from '@/ui/contextMenuActions'
import { importImageFiles, isImageFile } from '@/ui/importImage'
import { importMediaFiles, isMediaFile } from '@/ui/importMedia'
import { FloatingDock } from '@/ui/FloatingDock'

/**
 * Per-node values accumulated from every ancestor in the scene tree.
 *
 * Needed because the DOM renderer paints every node as a flat,
 * absolutely-positioned sibling (using Yoga's world-space rect), so a
 * parent's CSS transform / opacity cannot reach its children the way
 * it would if they were nested in the DOM. Without this, animating a
 * parent (e.g. a Slide preset on a card) leaves its children stuck in
 * place while the parent alone slides — clearly broken.
 *
 * For each descendant we fold in every ancestor's (static + animated)
 *   translate   → additive
 *   rotation    → additive (uses each child's own pivot — approximate,
 *                 good enough for MVP pure-slide / pure-rotate)
 *   scaleX/Y    → multiplicative (same pivot caveat)
 *   opacity     → multiplicative
 *
 * The root / artboard contributes nothing — its transform is clamped
 * to identity by `NodeView` so even if stale scene state had it tilted,
 * the inheritance pass sees a no-op.
 *
 * Proper pivot-correct composition via a 2D affine matrix lands with
 * the Pixi swap (Step 4); until then this additive model handles the
 * 95% case (translate) perfectly and the rest visibly-correctly.
 */
export interface InheritedAnim {
  x: number
  y: number
  z: number
  rotation: number
  rotationX: number
  rotationY: number
  scaleX: number
  scaleY: number
  opacity: number
}

const IDENTITY_INHERITED: InheritedAnim = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
}

/**
 * Walk the scene tree from root, producing per-node InheritedAnim maps
 * that carry the compounded effect of every ancestor's transform +
 * animated delta. Node's own contribution is NOT included here — the
 * NodeView composes its own on top at render time.
 */
function composeInheritedAnim(
  api: SceneAPI,
  rootId: NodeId | null,
  animated: Record<NodeId, AnimatedValue>,
): Record<NodeId, InheritedAnim> {
  const out: Record<NodeId, InheritedAnim> = {}
  if (!rootId) return out
  const visit = (id: NodeId, inherited: InheritedAnim) => {
    out[id] = inherited
    const node = api.getNode(id)
    if (!node) return
    // Root is treated as identity — never propagate the artboard's own
    // transform / opacity to its children even if it has stale values.
    const isRoot = id === rootId
    const a = animated[id]
    // REPLACE semantics: when a track exists for a property, the
    // animated value is the node's "effective" value at this instant —
    // it already includes wherever the node would render. So we use it
    // directly in the ancestor composition, falling through to static
    // when no track is active.
    const effX = a?.x ?? node.transform.x
    const effY = a?.y ?? node.transform.y
    const effRot = a?.rotation ?? node.transform.rotation
    const effSX = a?.scaleX ?? node.transform.scaleX
    const effSY = a?.scaleY ?? node.transform.scaleY
    const effOp = a?.opacity ?? node.appearance.opacity
    // 3D channels (z, rotationX, rotationY) are NOT propagated through
    // the regular-node tree. They live exclusively on the camera, which
    // applies them as a single transform to the whole scene via the
    // separate camera path. Letting a regular frame translate or rotate
    // in 3D would either silently no-op (no perspective context) or
    // visibly clip children to z<0 — both surprising. Keeping the
    // surface 2D for everything except the camera.
    const nextInherited: InheritedAnim = isRoot
      ? inherited
      : {
          x: inherited.x + effX,
          y: inherited.y + effY,
          z: 0,
          rotation: inherited.rotation + effRot,
          rotationX: 0,
          rotationY: 0,
          scaleX: inherited.scaleX * effSX,
          scaleY: inherited.scaleY * effSY,
          opacity: inherited.opacity * effOp,
        }
    for (const child of api.getChildren(id)) visit(child.id, nextInherited)
  }
  visit(rootId, IDENTITY_INHERITED)
  return out
}

/**
 * Workspace host.
 *
 * Owns the zoomable / pannable surface around the scene's canvas frame.
 * The inner tree walks the scene and paints each node as an
 * absolutely-positioned div sized from its SolvedLayout rect.
 *
 * Coordinate spaces:
 *   - workspace (pixels in the DOM viewport)
 *   - canvas    (inside the transformed container; 1 unit = 1 canvas px)
 *   - a click at workspace (wx, wy) maps to canvas
 *     ((wx - panX) / zoom, (wy - panY) / zoom).
 *
 * Step 4 will replace the inline NodeView divs with a Pixi adapter; the
 * workspace transform container stays (Pixi inherits CSS transforms
 * without penalty on current browsers).
 */
export function Canvas() {
  const api = useSceneAPI()
  const version = useSceneVersion()

  const workspaceRef = useRef<HTMLDivElement>(null)
  const meta = api.getMeta()
  const rootId = api.getRoot() || null
  // Root appearance drives the canvas box itself — fill paints the
  // artboard background, corner radius rounds the box. Without this,
  // the container's hardcoded bg + rounded-sm would always win over
  // the Scene Inspector's Background section. Runs through the same
  // fillToCss serializer as inner nodes so the artboard can host a
  // gradient just like any other frame.
  const rootNode = rootId ? api.getNode(rootId) : null
  const sceneFill = fillToCss(rootNode?.appearance.fill ?? null) ?? null
  const sceneCorner = rootNode?.appearance.cornerRadius ?? 0
  // Camera viewport background — paints behind the artboard so when
  // the user zooms out / pans beyond the artboard, this fill (rather
  // than the workspace chrome) is what shows. Read here so the
  // surrounding canvas-root JSX can substitute it for the static
  // panel color and decide whether the checkerboard is helpful.
  // `camera` is computed below; we recompute the background CSS once
  // we have the camera node in hand. Defining the variable here keeps
  // the JSX further down readable. Falls back to null when there's
  // no active camera or no background fill set.

  // --- selection + tool + view state -----------------------------------
  const setSelection = useUI((s) => s.setSelection)
  const clearSelection = useUI((s) => s.clearSelection)
  const selection = useUI((s) => s.selection)
  const tool = useUI((s) => s.tool)
  const setTool = useUI((s) => s.setTool)
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)
  const zoomAt = useUI((s) => s.zoomAt)

  // --- layout solve ----------------------------------------------------
  const container = useMemo(
    () => ({ width: meta.canvas.width, height: meta.canvas.height }),
    [meta.canvas.width, meta.canvas.height],
  )
  const solved = useLayout(rootId, container)
  // Mirror the latest solve into a module-scope cache so out-of-tree
  // callers (Inspector position-toggle, context menu actions) can read
  // a node's rect on a discrete user action without forcing the layout
  // hook into their parents. See hooks/lastSolvedLayout.ts.
  useEffect(() => {
    setLastSolvedLayout(solved)
  }, [solved])

  const renderOrder = useMemo<NodeId[]>(() => {
    if (!rootId) return []
    const out: NodeId[] = []
    const visit = (id: NodeId) => {
      out.push(id)
      for (const c of api.getChildren(id)) visit(c.id)
    }
    visit(rootId)
    return out
  }, [api, rootId, version])

  // Animated values (opacity, transform offsets) from the anim engine,
  // keyed by node id. Empty object while no tracks exist, which is the
  // current default — the engine is wired but untouched until Step 5.
  const animated = useAnimatedValues(renderOrder)

  // Active camera: a scene-level node whose transform is interpreted as
  // the view transform, inverse-applied to the artboard content. The
  // camera isn't part of the layout tree (parent: null, excluded from
  // the artboard walk above) so the layout/render passes never see it
  // as something to position. Here we just read its current composed
  // transform (static + any anim delta) and fold it into a CSS string
  // applied to the paint layer.
  //
  // When there's no active camera (legacy doc, not migrated yet), the
  // view collapses to identity — scene renders exactly as before.
  const cameraId = api.getActiveCameraId()
  const camera = cameraId ? api.getNode(cameraId) : null
  const cameraAnim = cameraId ? animated[cameraId] : undefined
  // Pre-serialize the camera's viewport background so the canvas-root
  // JSX further down can swap it in for the static panel color. Null
  // when there's no active camera or no fill set; the renderer falls
  // back to `var(--color-panel)` in that case.
  const cameraBackgroundFill =
    camera && camera.kind === 'camera' ? camera.background ?? null : null
  const cameraBackgroundCss = fillToCss(cameraBackgroundFill ?? null) ?? null
  // For image fills, the renderer needs the full background-* bundle
  // (image url + size + repeat). For solid/gradient, we just paint
  // `background: <css>`. Branch here so the JSX stays simple.
  const cameraBackgroundImageStyle = cameraBackgroundFill
    ? imageBackgroundStyle(cameraBackgroundFill)
    : null
  // ---------------------------------------------------------------
  // 3D camera
  // ---------------------------------------------------------------
  //
  // The camera carries (x, y, z). Z is the dolly axis:
  //   - z=0  : neutral, world renders at scale 1
  //   - z>0  : camera moved closer, world appears bigger (scale > 1)
  //   - z<0  : camera moved back, world appears smaller (scale < 1)
  //
  // Apparent scale uses a textbook pinhole model:
  //   apparentScale = focalLength / (focalLength - z)
  //
  // FOCAL_LENGTH is in canvas-pixel units. 1000 was chosen so a
  // ±50px Z move feels noticeable (≈±5% scale) without saturating.
  // Bigger focal length = more "telephoto" feel (smaller scale change
  // per unit of Z); smaller = "wide angle."
  const FOCAL_LENGTH = 1000
  const cameraZ =
    camera && camera.kind === 'camera'
      ? cameraAnim?.z ?? camera.transform.z
      : 0
  // Clamp the denominator so an animation through z = FOCAL_LENGTH
  // (singularity) doesn't blow the scale up to infinity.
  const cameraScaleFromZ = useMemo(() => {
    const denom = Math.max(1, FOCAL_LENGTH - cameraZ)
    return FOCAL_LENGTH / denom
  }, [cameraZ])

  const cameraTransform = useMemo(() => {
    if (!camera || camera.kind !== 'camera') return null
    // REPLACE semantics for x/y/rotation. Apparent scale is derived
    // from camera Z so the inspector doesn't carry a redundant
    // scale field on cameras (Z replaced it).
    const cx = cameraAnim?.x ?? camera.transform.x
    const cy = cameraAnim?.y ?? camera.transform.y
    const rZ = cameraAnim?.rotation ?? camera.transform.rotation
    const rX = cameraAnim?.rotationX ?? camera.transform.rotationX
    const rY = cameraAnim?.rotationY ?? camera.transform.rotationY
    const s = cameraScaleFromZ
    // View-matrix pattern: shift world so camera position lands at
    // origin → rotate/scale around that origin → shift back so the
    // camera's position ends up at the artboard center.
    //
    // 3D rotation: a camera rotation moves the WORLD by the inverse,
    // so each axis is negated. Order is rotateZ → rotateY → rotateX
    // applied right-to-left (CSS multiplies in the order written),
    // which matches a typical "yaw, pitch, roll" camera-to-world
    // composition for a freelook camera. The renderer's parent
    // wrapper carries `perspective(...)` so these rotations actually
    // foreshorten layers instead of shearing them flat.
    const w = meta.canvas.width
    const h = meta.canvas.height
    return (
      `translate(${w / 2}px, ${h / 2}px) ` +
      `scale(${s}, ${s}) ` +
      `rotateX(${-rX}deg) rotateY(${-rY}deg) rotateZ(${-rZ}deg) ` +
      `translate(${-cx}px, ${-cy}px)`
    )
  }, [camera, cameraAnim, cameraScaleFromZ, meta.canvas.width, meta.canvas.height])

  // Inherited-from-ancestor effects per node, so a parent's animated
  // translate / opacity / scale also moves the children that sit beside
  // it in the flat SceneLayer paint (not nested under it in the DOM).
  // Rebuilt whenever the scene structure or the engine snapshot changes.
  // `version` is a cache-bust signal — not referenced inside the fn but
  // required so pure-scene mutations (e.g. dragging a node) re-run the
  // ancestor walk even when the anim snapshot identity hasn't changed.
  const inherited = useMemo(
    () => composeInheritedAnim(api, rootId, animated),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, rootId, animated, version],
  )

  // --- pointer events: workspace-level click to clear / pan with H ----
  const panStateRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  // Drawing state for R/O/T/F tools. Kept as both ref (for pointer move
  // math without re-render churn) and state (for rendering the preview
  // outline during the drag).
  const drawStateRef = useRef<{
    kind: NodeKind
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
  const [drawPreview, setDrawPreview] = useState<Rect | null>(null)

  // Convert a clientX/clientY into canvas-space coordinates.
  //
  // There are two transforms stacked between the user's pointer and the
  // scene:
  //
  //   1. Workspace view — pan/zoom centered on the workspace midpoint.
  //      Controlled by the hand tool and Cmd-drag.
  //   2. Camera view — the active camera node's inverse transform,
  //      wrapping the scene paint layer so the camera pans/rotates/zooms
  //      the SCENE CONTENT within the artboard.
  //
  // A pointer click has to unwind BOTH to land in the canvas-space the
  // scene nodes live in. Missing step 2 is the "I drew an ellipse here
  // but it appeared over there" bug — the camera shifts the visible
  // artboard, but the placement math wrote the pre-camera coord, so the
  // new node rendered (through the camera again) somewhere else.
  const clientToCanvas = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = workspaceRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      // Step 1 — invert workspace pan + zoom. This puts us in the same
      // frame the camera wrapper sits in (origin = artboard top-left).
      let x =
        (clientX - rect.left - rect.width / 2 - view.panX) / view.zoom +
        meta.canvas.width / 2
      let y =
        (clientY - rect.top - rect.height / 2 - view.panY) / view.zoom +
        meta.canvas.height / 2
      // Step 2 — invert the camera transform if one is active.
      //
      // Forward (cameraTransform above):
      //   P' = translate(W/2, H/2) · scale(sx,sy) · rotate(-r) ·
      //        translate(-cx, -cy) · P
      // Inverse:
      //   P  = translate(cx, cy) · rotate(+r) · scale(1/sx, 1/sy) ·
      //        translate(-W/2, -H/2) · P'
      if (camera && camera.kind === 'camera') {
        // REPLACE semantics — match the forward cameraTransform above.
        const camCx = cameraAnim?.x ?? camera.transform.x
        const camCy = cameraAnim?.y ?? camera.transform.y
        const camR = cameraAnim?.rotation ?? camera.transform.rotation
        const camSx = cameraAnim?.scaleX ?? camera.transform.scaleX
        const camSy = cameraAnim?.scaleY ?? camera.transform.scaleY
        const W = meta.canvas.width
        const H = meta.canvas.height
        // translate(-W/2, -H/2)
        let px = x - W / 2
        let py = y - H / 2
        // scale(1/sx, 1/sy) — guard divide-by-zero on a degenerate camera
        // (shouldn't happen in UI, but if someone types 0 into scale...)
        px = camSx !== 0 ? px / camSx : px
        py = camSy !== 0 ? py / camSy : py
        // rotate(+r) around origin
        const rad = (camR * Math.PI) / 180
        const c = Math.cos(rad)
        const s = Math.sin(rad)
        const rx = px * c - py * s
        const ry = px * s + py * c
        // translate(cx, cy)
        x = rx + camCx
        y = ry + camCy
      }
      return { x, y }
    },
    [
      view.panX,
      view.panY,
      view.zoom,
      meta.canvas.width,
      meta.canvas.height,
      camera,
      cameraAnim,
    ],
  )

  const DRAW_TOOLS: Tool[] = ['rect', 'ellipse', 'text', 'frame']
  const isDrawTool = DRAW_TOOLS.includes(tool)

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only left-button on the workspace background, not on a NodeView.
      if (e.button !== 0) return
      // Clicks forwarded here that originated inside a node bubble up;
      // check the target carries a data-node-id to distinguish.
      // Drawing tools intentionally ignore this check — users expect
      // to be able to draw a new rect on top of / inside an existing one.
      const target = e.target as HTMLElement
      const onExistingNode = !!target.closest('[data-node-id]')

      if (tool === 'hand' || e.metaKey) {
        // Start pan. Alt/Opt is deliberately NOT a pan trigger — it now
        // means "show distance annotations" (Figma parity), handled by
        // DistanceOverlay. Cmd (⌘) still pans for users on trackpads
        // who prefer it, and the dedicated H tool is always available.
        panStateRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          panX: view.panX,
          panY: view.panY,
        }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        return
      }

      if (isDrawTool) {
        const start = clientToCanvas(e.clientX, e.clientY)
        if (!start) return
        drawStateRef.current = {
          kind: toolToKind(tool),
          pointerId: e.pointerId,
          startX: start.x,
          startY: start.y,
        }
        setDrawPreview({ x: start.x, y: start.y, width: 0, height: 0 })
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (!onExistingNode) clearSelection()
    },
    [tool, isDrawTool, clientToCanvas, view.panX, view.panY, clearSelection],
  )

  const onBackgroundPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = panStateRef.current
      if (p) {
        setView({
          panX: p.panX + e.clientX - p.startX,
          panY: p.panY + e.clientY - p.startY,
        })
        return
      }
      const d = drawStateRef.current
      if (d && e.pointerId === d.pointerId) {
        const cur = clientToCanvas(e.clientX, e.clientY)
        if (!cur) return
        const x = Math.min(d.startX, cur.x)
        const y = Math.min(d.startY, cur.y)
        const width = Math.abs(cur.x - d.startX)
        const height = Math.abs(cur.y - d.startY)
        setDrawPreview({ x, y, width, height })
      }
    },
    [clientToCanvas, setView],
  )

  const onBackgroundPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (panStateRef.current) {
        panStateRef.current = null
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        return
      }
      const d = drawStateRef.current
      if (d && e.pointerId === d.pointerId) {
        try {
          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }
        const cur = clientToCanvas(e.clientX, e.clientY)
        drawStateRef.current = null
        setDrawPreview(null)
        if (!cur || !rootId) return

        // Commit. Dragged bounds → size + transform.x/y under root.
        // A tiny drag (< 2px) becomes a default-sized rect at the point,
        // matching Figma: click with a shape tool stamps a default shape.
        const dragW = Math.abs(cur.x - d.startX)
        const dragH = Math.abs(cur.y - d.startY)
        const width = dragW < 2 ? 100 : dragW
        const height = dragH < 2 ? 100 : dragH
        const x = Math.min(d.startX, cur.x)
        const y = Math.min(d.startY, cur.y)

        // Honor the parent's layout mode. If the Scene has auto layout
        // (flex / grid), the newly-drawn element should flow into that
        // layout — giving it a non-zero transform would offset it from
        // where Yoga places it, which reads as "I drew it here, why did
        // it jump?" If the parent is mode='none' (free canvas), we keep
        // the dragged position as the transform so click-drag lands
        // exactly where the user pointed.
        const parentNode = api.getNode(rootId)
        const parentMode =
          parentNode && 'layout' in parentNode ? parentNode.layout.mode : 'none'
        const useAbsolute = parentMode === 'none'

        // Sizing rules:
        // - Text always prefers hug when drawn into a flex/grid parent
        //   (a 100×100 text node that wraps "Text" into a giant box looks
        //   broken; letting the measure function size it is what users
        //   expect). On a free-canvas parent, a real drag means "I want
        //   a fixed-width text frame", so respect that; a tiny click
        //   stamps a hug-hug caret like Figma does.
        // - Other shapes (rect, ellipse, frame) keep their dragged size
        //   regardless of parent — flex/grid will still position them
        //   at the start of the layout since transform stays (0, 0).
        const isTinyDrag = dragW < 2 && dragH < 2
        const textShouldHug = d.kind === 'text' && (!useAbsolute || isTinyDrag)
        const sizeProp = textShouldHug
          ? { width: 'hug' as const, height: 'hug' as const }
          : { width, height }

        const baseProps = {
          size: sizeProp,
          transform: useAbsolute
            ? {
                x,
                y,
                z: 0,
                rotation: 0,
                rotationX: 0,
                rotationY: 0,
                scaleX: 1,
                scaleY: 1,
              }
            : {
                x: 0,
                y: 0,
                z: 0,
                rotation: 0,
                rotationX: 0,
                rotationY: 0,
                scaleX: 1,
                scaleY: 1,
              },
        }
        const appearanceForKind = (kind: NodeKind) =>
          kind === 'frame'
            ? {
                opacity: 1,
                fill: null,
                stroke: null,
                cornerRadius: 0,
                effects: [],
              }
            : undefined

        const appearance = appearanceForKind(d.kind)
        const newId = api.createNode(d.kind, rootId, {
          ...baseProps,
          ...(appearance ? { appearance } : {}),
        } as never)

        setSelection([newId])
        setTool('select')
      }
    },
    [api, rootId, clientToCanvas, setSelection, setTool],
  )

  // --- wheel: cmd/ctrl + wheel = zoom, otherwise pan -------------------
  useEffect(() => {
    const el = workspaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!el.contains(e.target as Node)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      // zoomAt wants *origin-relative* coordinates — the transform
      // container is anchored at the workspace center via CSS, so we
      // subtract the center to get the right fixed point under the
      // cursor. Using the top-left (as the old code did) made Cmd+wheel
      // zoom toward the bottom-right instead of toward the cursor.
      const ox = e.clientX - rect.left - rect.width / 2
      const oy = e.clientY - rect.top - rect.height / 2
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch registers as ctrlKey. Discrete mouse wheels too
        // when user holds Cmd. Delta is signed: up = zoom in.
        const factor = Math.exp(-e.deltaY * 0.01)
        zoomAt(view.zoom * factor, ox, oy)
      } else {
        setView({ panX: view.panX - e.deltaX, panY: view.panY - e.deltaY })
      }
    }
    // React only synthesizes wheel as passive; we need to preventDefault
    // to stop the page from scrolling under Cmd+wheel, so attach native.
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [view.zoom, view.panX, view.panY, zoomAt, setView])

  const workspaceCursor =
    tool === 'hand'
      ? panStateRef.current
        ? 'grabbing'
        : 'grab'
      : isDrawTool
        ? 'crosshair'
        : undefined

  // --- native drag-drop: image import ----------------------------------
  // Tracks the "a dragged file is hovering over the canvas" state so the
  // UI can show a visible drop target. dragenter/dragover fire many times
  // during a hover; a boolean is enough — we don't need to count enters.
  const [isFileDragging, setIsFileDragging] = useState(false)
  const dragDepthRef = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    dragDepthRef.current += 1
    setIsFileDragging(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    // Required to allow `drop` to fire — the browser assumes you're
    // rejecting the drag unless you preventDefault on dragover.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    // Nested elements fire leave/enter pairs during traversal. Use a
    // depth counter so the highlight only clears when the drag truly
    // exits the workspace, not when crossing a child boundary.
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsFileDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return
      e.preventDefault()
      dragDepthRef.current = 0
      setIsFileDragging(false)
      if (!rootId) return

      const allFiles = Array.from(e.dataTransfer.files)
      const imageFiles = allFiles.filter(isImageFile)
      // isImageFile matches SVG by extension, which would also match our
      // media test if we ever added SVG video — guard by excluding any
      // file already claimed by the image path so a file isn't imported
      // twice.
      const mediaFiles = allFiles.filter(
        (f) => !isImageFile(f) && isMediaFile(f),
      )
      if (imageFiles.length === 0 && mediaFiles.length === 0) return

      // Drop at the pointer location in canvas coordinates so the asset
      // lands where the user let go, not at the artboard center.
      const dropPos = clientToCanvas(e.clientX, e.clientY) ?? undefined
      const ids: NodeId[] = []
      if (imageFiles.length > 0) {
        ids.push(
          ...(await importImageFiles(imageFiles, api, rootId, {
            dropPos: dropPos ?? undefined,
          })),
        )
      }
      if (mediaFiles.length > 0) {
        ids.push(
          ...(await importMediaFiles(mediaFiles, api, rootId, {
            dropPos: dropPos ?? undefined,
          })),
        )
      }
      if (ids.length > 0) {
        setSelection(ids)
        setTool('select')
      }
    },
    [api, rootId, clientToCanvas, setSelection, setTool],
  )

  return (
    <main
      ref={workspaceRef}
      className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-app-bg"
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onBackgroundPointerMove}
      onPointerUp={onBackgroundPointerUp}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ cursor: workspaceCursor }}
    >
      {/* Single transform container for both scene paint + selection overlay.
          Placing the transform here (absolute, top-left) with explicit pan
          and scale is more predictable than transforming a flex-centered
          box — the math for click-to-canvas stays linear. */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <div
          className="relative border border-border-strong shadow-2xl"
          style={{
            width: meta.canvas.width,
            height: meta.canvas.height,
            // Nudge the canvas box so its center aligns with the transform
            // origin when zoom=1 and pan=(0,0). Combined with the `left-1/2
            // top-1/2` above, the scene sits centered in the workspace by
            // default; pan modifies translate from there.
            marginLeft: -meta.canvas.width / 2,
            marginTop: -meta.canvas.height / 2,
            overflow: 'hidden',
            // Workspace panel color as the always-present fallback.
            // The camera's own viewport background (when set) paints
            // on top of this via a dedicated child div below — that
            // way we can support solid / gradient / image fills with
            // proper background-size handling for images.
            background: 'var(--color-panel)',
            borderRadius: Math.max(0, sceneCorner),
            // Perspective on the parent so the child camera-transform's
            // rotateX/rotateY actually foreshorten layers (otherwise CSS
            // collapses 3D rotations to a flat shear). Matched to
            // FOCAL_LENGTH so the perceived 3D matches the same focal
            // length the perspective-scale code uses for cameraScaleFromZ.
            perspective: 1000,
            perspectiveOrigin: 'center center',
          }}
          data-canvas-root
        >
          {/* Camera viewport background — paints across the entire
              artboard window when the camera carries a `background`
              fill. Sits below the camera-transform wrapper so it
              stays put when the user pans / zooms the camera, which
              is exactly the "world backdrop" effect: pull the camera
              back, see your scene shrink, see the backdrop framing it.
              Image fills get the full background-* bundle so `cover` /
              `contain` / `tile` all work. */}
          {cameraBackgroundImageStyle ? (
            <div
              className="pointer-events-none absolute inset-0"
              style={cameraBackgroundImageStyle}
            />
          ) : cameraBackgroundCss ? (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: cameraBackgroundCss }}
            />
          ) : null}
          {/* Checkerboard sits on the OUTER canvas-root, anchored to the
              viewport box so users always see "this is your artboard
              window" even when the camera pans the scene paint inside
              it. Hidden when the camera carries its own background
              fill — at that point the user has explicitly chosen what
              should sit behind the scene, and the checkerboard would
              just dirty the look. */}
          {!cameraBackgroundCss && (
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.05]"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #fff 25%, transparent 25%), linear-gradient(-45deg, #fff 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #fff 75%), linear-gradient(-45deg, transparent 75%, #fff 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
              }}
            />
          )}
          {!solved ? (
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[11px] text-text-dim">
              {rootId ? 'preparing layout…' : 'empty scene'}
            </span>
          ) : (
            <div
              className="absolute inset-0"
              style={
                cameraTransform
                  ? {
                      transform: cameraTransform,
                      transformOrigin: '0 0',
                      // Preserve 3D so descendants inherit the perspective
                      // — without this, CSS flattens the camera's rotateX /
                      // rotateY before painting children, making the 3D
                      // tilt look like a shear instead of a perspective.
                      transformStyle: 'preserve-3d',
                    }
                  : undefined
              }
            >
              {sceneFill ? (
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: 0,
                    top: 0,
                    width: meta.canvas.width,
                    height: meta.canvas.height,
                    background: sceneFill,
                    borderRadius: Math.max(0, sceneCorner),
                  }}
                />
              ) : null}
              <SceneLayer
                rootId={rootId}
                solved={solved}
                order={renderOrder}
                animated={animated}
                inherited={inherited}
                onNodeClick={(id, additive) => {
                  if (additive) {
                    useUI.getState().toggleInSelection(id, true)
                  } else {
                    setSelection([id])
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* Selection outline lives outside the `overflow:hidden` canvas box
            so a selected node near the edge doesn't get its frame clipped.
            It's still in canvas coordinates — same transform — so positions
            map 1:1 to what the user sees.

            `data-export-hide="1"` removes this entire chrome layer
            (selection rings, resize handles, camera viewfinder gizmo,
            distance hints) from the captured stream during tab-capture
            export. None of these are scene content — they're editor
            affordances that don't belong in the output WebM. */}
        <div
          className="pointer-events-none absolute"
          data-export-hide="1"
          style={{
            left: -meta.canvas.width / 2,
            top: -meta.canvas.height / 2,
            width: meta.canvas.width,
            height: meta.canvas.height,
          }}
        >
          {/* Camera viewfinder gizmo. Drawn OUTSIDE the camera-transform
              wrapper so it shows where the camera is in scene space
              (the rect doesn't compose with the very transform it
              represents). Visible when the user has Camera selected,
              so the panel doesn't gain extra noise during normal
              editing. */}
          {camera && camera.kind === 'camera' ? (
            <CameraGizmo
              camera={camera}
              cameraAnim={cameraAnim}
              canvasWidth={meta.canvas.width}
              canvasHeight={meta.canvas.height}
              zoom={view.zoom}
              selected={selection.includes(camera.id)}
            />
          ) : null}
          <div
            className="pointer-events-none absolute inset-0"
            style={
              cameraTransform
                ? { transform: cameraTransform, transformOrigin: '0 0' }
                : undefined
            }
          >
            {solved && (
              <SelectionOverlay
                solved={solved}
                animated={animated}
                inherited={inherited}
                zoom={view.zoom}
              />
            )}
            {solved && (
              <DistanceOverlay
                solved={solved}
                canvasWidth={meta.canvas.width}
                canvasHeight={meta.canvas.height}
                zoom={view.zoom}
                workspaceRef={workspaceRef}
                view={view}
                rootId={rootId}
              />
            )}
            {drawPreview ? (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: drawPreview.x,
                  top: drawPreview.y,
                  width: Math.max(1, drawPreview.width),
                  height: Math.max(1, drawPreview.height),
                  border: `${1 / Math.max(view.zoom, 0.001)}px dashed var(--color-accent)`,
                  background: 'var(--color-accent-soft)',
                  borderRadius: tool === 'ellipse' ? '9999px' : 2,
                }}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Zoom indicator. `data-export-hide` removes it from any
          frame the export pipeline captures — it's editor chrome,
          not scene content. */}
      <div
        className="pointer-events-none absolute bottom-3 right-3 rounded bg-panel/80 px-2 py-1 font-mono text-[10px] text-text-muted backdrop-blur"
        data-export-hide="1"
      >
        {Math.round(view.zoom * 100)}%
      </div>

      {/* Floating tool dock — sits inside the canvas zone, centered
          horizontally, 16px above the bottom edge. Lives here (not
          App.Shell) so it's positioned relative to the canvas
          workspace and never bleeds into the Timeline below. */}
      <FloatingDock />

      {/* File-drop highlight. Shown while a file drag hovers over the
          workspace. Pointer-events off so it doesn't eat the `drop` /
          `dragleave` events on the workspace itself. */}
      {isFileDragging ? (
        <div className="pointer-events-none absolute inset-2 rounded-md border-2 border-dashed border-accent/70 bg-accent/[0.06]">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-panel/90 px-3 py-1.5 font-mono text-[11px] text-accent shadow-lg">
            Drop to import image
          </div>
        </div>
      ) : null}
    </main>
  )
}

function toolToKind(tool: Tool): NodeKind {
  // The tool palette uses narrower names than the scene kinds
  // (rect vs rectangle). The palette wins on brevity; this mapping keeps
  // the data model canonical.
  switch (tool) {
    case 'rect':
      return 'rect'
    case 'ellipse':
      return 'ellipse'
    case 'text':
      return 'text'
    case 'frame':
      return 'frame'
    default:
      // Called only after DRAW_TOOLS check; fall back to rect defensively.
      return 'rect'
  }
}

// ---------------------------------------------------------------------------
// Scene paint layer
// ---------------------------------------------------------------------------

function SceneLayer({
  rootId,
  solved,
  order,
  animated,
  inherited,
  onNodeClick,
}: {
  rootId: NodeId | null
  solved: SolvedLayout
  order: NodeId[]
  animated: Record<NodeId, AnimatedValue>
  inherited: Record<NodeId, InheritedAnim>
  onNodeClick: (id: NodeId, additive: boolean) => void
}) {
  const api = useSceneAPI()
  const sceneVersion = useSceneVersion() // re-render on mutations
  const openContextMenu = useUI((s) => s.openContextMenu)
  const selection = useUI((s) => s.selection)
  const setSelection = useUI((s) => s.setSelection)

  const onNodeContext = (id: NodeId, clientX: number, clientY: number) => {
    // If the right-clicked node isn't in the current selection, replace
    // selection with it. Keeps the menu actions matching visible state.
    const targetIds = selection.includes(id) ? selection : [id]
    if (!selection.includes(id)) setSelection([id])
    openContextMenu({
      x: clientX,
      y: clientY,
      items: buildNodeContextMenu(api, targetIds),
    })
  }

  // Precompute "effective visibility" — a node is rendered only when
  // it AND every ancestor up to root are visible. Without this, hiding
  // a parent in the Layers panel left every child painted on the
  // canvas (matches Figma's behavior: hiding a frame hides everything
  // inside it). Walk the tree once per render so children inherit
  // their ancestor's visibility flag.
  const hiddenIds = useMemo(() => {
    const hidden = new Set<NodeId>()
    if (!rootId) return hidden
    const walk = (id: NodeId, parentHidden: boolean) => {
      const n = api.getNode(id)
      if (!n) return
      const eff = parentHidden || !n.visible
      if (eff) hidden.add(id)
      for (const c of api.getChildren(id)) walk(c.id, eff)
    }
    walk(rootId, false)
    return hidden
  }, [api, rootId, order, sceneVersion])

  // Per-node clip rect, derived from the closest ancestor frame whose
  // `clipsContent` is true. Needed because the renderer flattens the
  // scene tree — every node is an absolute sibling under the camera-
  // transform wrapper, so a parent frame's `overflow:hidden` has no
  // descendants in its DOM subtree to clip. Without this map, anything
  // larger than its parent (or positioned outside it) would bleed onto
  // siblings — exactly the bug the user reported.
  //
  // We walk the scene tree from root, accumulating the active clip
  // rect as we descend. When we cross a clipping frame, the current
  // clip becomes that frame's rect intersected with whatever clip we
  // were already inside — so a deeply nested clip-in-clip-in-clip
  // composes correctly.
  //
  // Skip the root in the clip map: the artboard div already applies
  // `overflow:hidden` at the DOM level, so root-level clipping is
  // handled by the canvas chrome and doesn't need a per-node clip-path.
  const ancestorClip = useMemo(() => {
    const map: Record<NodeId, Rect> = {}
    if (!rootId) return map
    const visit = (id: NodeId, currentClip: Rect | null) => {
      if (currentClip && id !== rootId) map[id] = currentClip
      const node = api.getNode(id)
      if (!node) return
      let nextClip: Rect | null = currentClip
      // The root's own clipsContent is already enforced by the artboard
      // div's overflow:hidden, so we don't fold it into the per-node
      // clip map — would just paint a redundant inset(0 0 0 0) on every
      // top-level child.
      if (node.kind === 'frame' && node.clipsContent && id !== rootId) {
        const r = solved[id]
        if (r) {
          if (currentClip) {
            const x1 = Math.max(currentClip.x, r.x)
            const y1 = Math.max(currentClip.y, r.y)
            const x2 = Math.min(
              currentClip.x + currentClip.width,
              r.x + r.width,
            )
            const y2 = Math.min(
              currentClip.y + currentClip.height,
              r.y + r.height,
            )
            nextClip = {
              x: x1,
              y: y1,
              width: Math.max(0, x2 - x1),
              height: Math.max(0, y2 - y1),
            }
          } else {
            nextClip = r
          }
        }
      }
      for (const c of api.getChildren(id)) visit(c.id, nextClip)
    }
    visit(rootId, null)
    return map
  }, [api, rootId, solved, order, sceneVersion])

  // Mask info — for each node whose previous sibling carries
  // `isMask: true`, record the mask shape's solved rect + kind + corner
  // radius so NodeView can derive a CSS clip-path.
  //
  // Mask convention: sibling[i] with isMask=true clips sibling[i+1].
  // Only the immediate next sibling is masked (Figma's MVP behavior).
  // Multi-layer masking ("clip everything above") is a follow-up if
  // users ask for it — most motion-graphics masks are 1:1.
  //
  // Limitation in this MVP: clip-path is applied to the masked node's
  // own box in box-local coords. That means animating the masked
  // node's transform also drags the clip with it — fine for static
  // masks (avatar circles, container reveals where mask + content
  // share a parent that animates as a unit), wrong for "content
  // slides through a stationary mask" reveals. Real reveal behavior
  // needs a world-space clip wrapper; defer until requested.
  type MaskHit = {
    rect: Rect
    kind: NodeKind
    corner: number
  }
  const maskInfo = useMemo(() => {
    const map: Record<NodeId, MaskHit> = {}
    if (!rootId) return map
    const visit = (id: NodeId) => {
      const kids = api.getChildren(id)
      for (let i = 0; i < kids.length - 1; i++) {
        const masker = kids[i]!
        if (!masker.isMask) continue
        const masked = kids[i + 1]!
        const maskerRect = solved[masker.id]
        if (!maskerRect) continue
        // Corner radius — frames carry it on appearance.corner; rect
        // and ellipse don't have a separate field. For ellipse we let
        // the kind drive the clip path (clip-path: ellipse(...)) and
        // corner is unused; for rect/frame we read appearance.corner
        // when present.
        const corner =
          (masker.appearance as { corner?: number } | undefined)?.corner ?? 0
        map[masked.id] = {
          rect: maskerRect,
          kind: masker.kind,
          corner,
        }
      }
      for (const k of kids) visit(k.id)
    }
    visit(rootId)
    return map
  }, [api, rootId, solved, sceneVersion])

  return (
    <>
      {order.map((id) => {
        const node = api.getNode(id)
        const rect = solved[id]
        if (!node || !rect || hiddenIds.has(id)) return null
        return (
          <NodeView
            key={id}
            node={node}
            rect={rect}
            anim={animated[id]}
            inherit={inherited[id] ?? IDENTITY_INHERITED}
            isRoot={id === rootId}
            isSelected={selection.includes(id)}
            ancestorClip={ancestorClip[id]}
            maskedBy={maskInfo[id]}
            onClick={(e) => {
              e.stopPropagation()
              onNodeClick(id, e.shiftKey || e.metaKey)
            }}
            onContextMenu={(e) => {
              // Skip context menu on the root — there's nothing useful
              // to do on the artboard itself.
              if (id === rootId) return
              e.preventDefault()
              e.stopPropagation()
              onNodeContext(id, e.clientX, e.clientY)
            }}
          />
        )
      })}
    </>
  )
}

/**
 * Render a single scene node as a positioned div.
 *
 * Pre-Pixi placeholder: solid fills only, no strokes, no effects,
 * no text glyphs. Enough to visually verify that Yoga is placing
 * things where we expect. Text nodes show their string content in
 * the app's monospace so the debug view remains legible.
 *
 * Two distinct kinds of position are composed here:
 *   - `rect.x / rect.y / rect.width / rect.height`  — from the Yoga
 *     solve, i.e. where auto-layout puts the node relative to the
 *     canvas origin. These map to `left / top / width / height`.
 *   - `node.transform.{x,y,rotation,scaleX,scaleY}` — the animatable
 *     post-layout offset. Lives on the CSS `transform` property so
 *     it never feeds back into the layout pass.
 *
 * Animated values from the engine are composited on top of the
 * static transform — ultra-cheap here because it's a plain numeric
 * add before the CSS transform string is assembled.
 *
 * Frame nodes with `clipsContent: true` get `overflow:hidden` so
 * children that exceed their bounds are clipped rather than bleeding
 * onto other frames. Matches Figma / Jitter.
 */
function NodeView({
  node,
  rect,
  anim,
  inherit,
  isRoot,
  isSelected,
  ancestorClip,
  maskedBy,
  onClick,
  onContextMenu,
}: {
  node: SceneNode
  rect: Rect
  anim: AnimatedValue | undefined
  inherit: InheritedAnim
  isRoot: boolean
  isSelected: boolean
  /**
   * World-space rect that this node should be clipped to, derived from
   * the closest clipping ancestor. Undefined when there is no clipping
   * ancestor (i.e. the node sits directly under root). The renderer
   * applies this as a `clip-path: inset(...)` because the flat-DOM
   * structure means the parent frame's `overflow:hidden` can't reach
   * the child to clip it.
   */
  ancestorClip?: Rect
  /**
   * Mask shape info — present when the previous sibling has
   * `isMask: true`. The renderer applies a CSS clip-path on this
   * node so its painted pixels are limited to the mask shape's
   * silhouette. See the maskInfo memo in SceneLayer for build details.
   */
  maskedBy?: { rect: Rect; kind: NodeKind; corner: number }
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
}) {
  // Node background — serialize whatever Fill shape the model holds
  // (solid / linear / radial) into a CSS background value. Solid fills
  // return a bare color, gradients return a `linear-gradient(...)` or
  // `radial-gradient(...)` string, null returns undefined so the
  // parent's or canvas's default paint shows through.
  //
  // Text is a special case: its fill is painted through the glyphs via
  // background-clip: text on the inner <span>. Letting the wrapper
  // box also paint the fill would show a solid block of paint behind
  // the transparent text, losing the gradient-on-glyphs effect. So we
  // suppress the wrapper background for text nodes.
  // If the anim engine is tweening a fill color, it hands us a solid
  // OKLCH string via `anim.fill`. That override replaces the static
  // fill entirely (even when the static fill is a gradient) — a solid
  // tween between two gradients isn't meaningful, so the engine only
  // emits `anim.fill` when both endpoints were solid. We synthesise a
  // one-stop solid Fill so the rest of the paint pipeline stays uniform.
  const effectiveFill =
    anim?.fill !== undefined
      ? ({ kind: 'solid', color: anim.fill } as const)
      : node.appearance.fill
  // Image fills need three CSS properties (image, size, repeat) — `bg`
  // alone can't carry them. Compute the full style bundle here so the
  // wrapper div can spread it; for non-image fills we keep the simple
  // single-string `background` path.
  const bgImage = node.kind === 'text' ? null : imageBackgroundStyle(effectiveFill)
  const bg =
    node.kind === 'text' || bgImage ? null : fillToCss(effectiveFill)

  // Hover state for the placeholder outline below. Kept local so a
  // cursor hover doesn't fan out through the whole component tree.
  const [hovered, setHovered] = useState(false)

  // Frames without any paint would otherwise be invisible on the canvas,
  // but the user specifically didn't want the dashed hint to linger
  // when they're not interacting with it — "if I didn't tell it to
  // show, don't show". So we paint the silhouette only while the user
  // is either hovering or has the frame selected. Root is handled by
  // the canvas box itself so we skip it.
  //
  // Exception: when a frame has an active animation (any track is
  // emitting non-identity values), we force the silhouette on so the
  // user can actually SEE the frame fading, sliding, or scaling. Without
  // this, a fade-in on an empty frame looks like the preset did nothing
  // — the frame's div animates correctly but has no paint to show it.
  // Children still fade via inherited anim, but the frame itself needs
  // a visible handle too.
  const isEmptyFrame =
    !isRoot &&
    node.kind === 'frame' &&
    node.appearance.fill === null &&
    node.appearance.stroke === null
  // The dashed outline now appears ONLY on hover or selection, not
  // continuously while a frame has animation tracks. Earlier the
  // animated case forced it on so users could "see" a fade-in on an
  // otherwise invisible frame, but in real scenes that meant every
  // frame with any track painted a dashed border permanently — visual
  // noise that even bled into video exports. If you want a
  // permanent silhouette around a frame, set a faint stroke or fill
  // on it; the editor outline is just an interaction affordance.
  const needsDashedOutline = isEmptyFrame && (hovered || isSelected)

  // Root is the artboard — no transform, no rotation, no scale. Even
  // if stale state has a non-identity transform on it, we paint it
  // flat. `normalizeRoot` will clean up the underlying data on next
  // load; this is the in-render safety net so the Scene never tilts.
  //
  // For non-root nodes we compose three sources under REPLACE semantics:
  //   - node.transform.*  : the node's own static transform
  //   - anim.*            : absolute value at the current playhead when
  //                          a track exists — otherwise undefined
  //   - inherit.*         : the compounded contribution of every ancestor
  //                          (see composeInheritedAnim). Additive/
  //                          multiplicative against the OWN effective
  //                          value, since ancestors apply on top.
  //
  // "Effective own value" picks animated when present, static otherwise.
  // Inherited offsets still compose additively/multiplicatively because
  // they represent the accumulated contribution from ancestors, not a
  // replacement.
  const ownX = anim?.x ?? node.transform.x
  const ownY = anim?.y ?? node.transform.y
  const ownRot = anim?.rotation ?? node.transform.rotation
  const ownSX = anim?.scaleX ?? node.transform.scaleX
  const ownSY = anim?.scaleY ?? node.transform.scaleY
  const ownOp = anim?.opacity ?? node.appearance.opacity
  const tx = isRoot ? 0 : ownX + inherit.x
  const ty = isRoot ? 0 : ownY + inherit.y
  const rotation = isRoot ? 0 : ownRot + inherit.rotation
  const sx = isRoot ? 1 : ownSX * inherit.scaleX
  const sy = isRoot ? 1 : ownSY * inherit.scaleY
  const opacity = ownOp * inherit.opacity
  // cornerRadius from the engine REPLACES the static value when a track
  // is active; static is the fallback for the no-track case. See the
  // `AnimatedValue.cornerRadius` docstring for why this differs from
  // the additive/multiplicative composition used for transform/opacity.
  const cornerRadius = anim?.cornerRadius ?? node.appearance.cornerRadius
  // Per-corner override. When `appearance.cornerRadii` is set, write the
  // four-value CSS shorthand `tl tr br bl`. We deliberately ignore the
  // animated uniform `cornerRadius` here — once a designer promotes to
  // per-corner, the uniform track stops applying. This trade-off keeps
  // the data model honest: there is one source of truth at any time.
  const cornerRadii = node.appearance.cornerRadii
  // Ellipses are always circles/ellipses by definition — the
  // cornerRadius property on ellipse nodes doesn't mean anything. Paint
  // the wrapper with `border-radius: 9999px` so a drawn ellipse looks
  // like an ellipse even when the stored cornerRadius is 0. The stroke
  // overlay still gets the numeric `cornerRadius` and does its own
  // ellipse-aware path (inset ellipse painted via an SVG ellipse).
  const wrapperBorderRadius: number | string =
    node.kind === 'ellipse'
      ? '9999px'
      : cornerRadii
        ? `${cornerRadii.tl}px ${cornerRadii.tr}px ${cornerRadii.br}px ${cornerRadii.bl}px`
        : cornerRadius
  // For SVG-based stroke overlays (dashed/dotted/inside-aligned/gradient
  // strokes) we can only express ONE rx today — fall back to the max of
  // the four corners when in per-corner mode. Solid solid-color strokes
  // are painted via CSS `box-shadow` strokeShadow and inherit the
  // wrapper's border-radius perfectly, so they work correctly already.
  const strokeOverlayCorner = cornerRadii
    ? Math.max(cornerRadii.tl, cornerRadii.tr, cornerRadii.br, cornerRadii.bl)
    : cornerRadius

  // Empty frames (fill=null, stroke=null) have no paint of their own —
  // applying the animated opacity to the wrapper would also fade out
  // the dashed placeholder we paint via `outline`, so the user can't
  // SEE the animation running on the frame. Skip opacity on the wrapper
  // for empty frames; the value still reaches children through
  // `composeInheritedAnim`, which is where the opacity matters anyway
  // (the frame itself is an invisible container). Non-empty frames and
  // every other node kind keep the wrapper opacity so their fill / text
  // / image content fades normally.
  // Mask shapes paint at reduced opacity so the user can still see and
  // edit them on the canvas — Figma hides them entirely once the
  // selection moves elsewhere, but for our DOM renderer that's
  // confusing because the mask shape still has fields in the
  // Inspector. 0.35 keeps it visible without competing with the
  // masked content.
  const baseWrapperOpacity = isEmptyFrame ? 1 : opacity
  const wrapperOpacity = node.isMask ? baseWrapperOpacity * 0.35 : baseWrapperOpacity

  // Mask clip-path. When this node is masked by a sibling, derive a
  // CSS clip-path string from the mask shape's local rect (relative
  // to this node's own box) and apply it to the styled inner box.
  //
  // Kind-specific shapes:
  //   - 'ellipse' → CSS ellipse(rx ry at cx cy), giving a true round
  //     mask matching the mask shape's bounding box.
  //   - 'rect' / 'frame' / everything else → inset(t r b l) optionally
  //     with `round Npx` when the masker carries a corner radius. This
  //     covers rounded-rectangle reveals.
  //
  // Coordinates are in the masked node's local box space (top-left of
  // the box is 0,0). World-coord clipping needs a wrapper layer; see
  // the maskInfo comment in SceneLayer for why MVP punts on that.
  let maskClipPath: string | undefined
  if (maskedBy) {
    const localX = maskedBy.rect.x - rect.x
    const localY = maskedBy.rect.y - rect.y
    const w = maskedBy.rect.width
    const h = maskedBy.rect.height
    if (maskedBy.kind === 'ellipse') {
      const rx = w / 2
      const ry = h / 2
      const cx = localX + rx
      const cy = localY + ry
      maskClipPath = `ellipse(${rx}px ${ry}px at ${cx}px ${cy}px)`
    } else {
      // inset insets are: top / right / bottom / left
      const t = localY
      const l = localX
      const r = rect.width - (localX + w)
      const b = rect.height - (localY + h)
      maskClipPath =
        maskedBy.corner > 0
          ? `inset(${t}px ${r}px ${b}px ${l}px round ${maskedBy.corner}px)`
          : `inset(${t}px ${r}px ${b}px ${l}px)`
    }
  }

  const parts: string[] = []
  // Regular nodes render in 2D space. The 3D channels (z, rotationX,
  // rotationY) live exclusively on the camera, which applies them as
  // a separate transform to the whole scene — keeping non-camera Z
  // out of the per-node transform avoids "negative Z hides the
  // element entirely" surprises when there's no perspective context.
  if (tx !== 0 || ty !== 0) parts.push(`translate(${tx}px, ${ty}px)`)
  if (rotation !== 0) parts.push(`rotate(${rotation}deg)`)
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`)
  const transform = parts.length > 0 ? parts.join(' ') : undefined

  const clips = node.kind === 'frame' && node.clipsContent

  // Strokes split into two rendering paths:
  //
  //   solid  → boxShadow, because it cooperates with borderRadius and
  //            doesn't force us to reserve layout space the way CSS
  //            `border` would.
  //   dashed → an SVG overlay painted on top of the node box. boxShadow
  //   dotted → can't express dash patterns, so solid-only stays on it.
  //
  // Alignment mirrors Figma in both paths:
  //   inside  — outer edge of the stroke sits at the node boundary
  //   outside — inner edge of the stroke sits at the node boundary
  //   center  — the stroke straddles the boundary 50/50
  //
  // Re-rendered on every value change; no perf concern at current
  // scales. The SVG overlay is pointer-events:none so it doesn't eat
  // clicks meant for the node itself.
  const { stroke } = node.appearance
  const strokeStyle = stroke?.style ?? 'solid'
  // Box-shadow is the fast path for solid-color strokes. A gradient
  // stroke forces the SVG overlay path because box-shadow only accepts
  // a flat color. Same reason dashed/dotted go to SVG — we push the
  // harder case to SVG and keep the common case cheap.
  const strokeHasGradient = !!stroke?.fill && stroke.fill.kind !== 'solid'
  const strokeFlatColor = stroke?.fill?.kind === 'solid'
    ? stroke.fill.color
    : stroke?.color
  // Per-side widths take a different render path: CSS borders, one
  // per side. box-shadow can only express uniform strokes, so any
  // node imported with "1px bottom border only" (tabs, list rows,
  // dividers) needs the per-side path. We force inside-alignment for
  // per-side strokes — Figma allows center/outside but the layout
  // implications of mixed-width outside borders are too messy to
  // implement reliably for an MVP.
  const hasPerSideStroke =
    !!stroke && !!stroke.widths && strokeStyle === 'solid' && !strokeHasGradient
  const strokeBorderCss = hasPerSideStroke
    ? {
        borderTopWidth: stroke!.widths!.top,
        borderRightWidth: stroke!.widths!.right,
        borderBottomWidth: stroke!.widths!.bottom,
        borderLeftWidth: stroke!.widths!.left,
        borderStyle: 'solid' as const,
        borderColor: strokeFlatColor,
        // box-sizing keeps the outer dimensions stable so Yoga's solved
        // rect remains the authoritative size — borders eat into the
        // content box rather than expanding the wrapper.
        boxSizing: 'border-box' as const,
      }
    : undefined
  const strokeShadow =
    stroke &&
    stroke.width > 0 &&
    strokeStyle === 'solid' &&
    !strokeHasGradient &&
    !hasPerSideStroke
      ? stroke.align === 'inside'
        ? `inset 0 0 0 ${stroke.width}px ${strokeFlatColor}`
        : stroke.align === 'outside'
          ? `0 0 0 ${stroke.width}px ${strokeFlatColor}`
          : `inset 0 0 0 ${stroke.width / 2}px ${strokeFlatColor}, 0 0 0 ${stroke.width / 2}px ${strokeFlatColor}`
      : undefined

  // Effect stack — Figma-style. Drop and inner shadows compose into
  // CSS box-shadow alongside any stroke shadow; layer blurs compose
  // into the same CSS filter pipeline as DOF blur. Effects are
  // applied in array order (later entries paint visually on top, so
  // they appear last in the comma-separated box-shadow list — CSS
  // paints box-shadow tail-to-head).
  //
  // `visible: false` rows are skipped so disabled effects don't
  // contribute to the rendered string but still survive in the data.
  const effects = node.appearance.effects ?? []
  const effectShadowParts: string[] = []
  const effectFilterParts: string[] = []
  for (const fx of effects) {
    if (fx.visible === false) continue
    if (fx.kind === 'shadow') {
      const spread = fx.spread ?? 0
      effectShadowParts.push(
        `${fx.offsetX}px ${fx.offsetY}px ${fx.blur}px ${spread}px ${fx.color}`,
      )
    } else if (fx.kind === 'inner-shadow') {
      const spread = fx.spread ?? 0
      effectShadowParts.push(
        `inset ${fx.offsetX}px ${fx.offsetY}px ${fx.blur}px ${spread}px ${fx.color}`,
      )
    } else if (fx.kind === 'blur') {
      effectFilterParts.push(`blur(${fx.amount}px)`)
    }
  }
  const effectShadowCss = effectShadowParts.join(', ')
  const effectFilterCss = effectFilterParts.join(' ')

  // Compose the final box-shadow string. Stroke shadow first so a
  // drop shadow paints OUTSIDE the stroke, matching Figma's stack
  // order (effects are above stroke in their effects panel).
  const composedBoxShadow = [strokeShadow, effectShadowCss]
    .filter(Boolean)
    .join(', ')

  // Drag-to-move, activated on pointerdown. Only inner (non-root) nodes
  // get drag behavior — the root is the scene frame, which is positioned
  // by the canvas box itself.
  const drag = useDragToMove(node.id, isRoot)

  // Ancestor clip — when this node sits under a clipping frame, we
  // render an OUTER clip wrapper around the node's normal styled box.
  // The outer is positioned at the world-space clip rect with
  // `overflow: hidden`, has no transform of its own, and crops both
  // paint and pointer events. The inner box keeps the node's transform
  // / animation / styling and is positioned RELATIVE to the outer.
  //
  // Why two wrappers instead of `clip-path` on the styled box:
  // CSS applies `clip-path` BEFORE `transform`, so a clip mask in
  // element-local box coords rides along with any animation
  // transform — defeating the whole point of "child clipped by
  // parent" once the child starts moving. The outer-wrapper approach
  // keeps the clip in world space regardless of inner animation.
  //
  // When there's no clipping ancestor, render the styled box directly
  // (no wrapper) so unrelated nodes pay no DOM cost.
  const clipWrapperStyle =
    ancestorClip && !isRoot
      ? ({
          position: 'absolute' as const,
          left: ancestorClip.x,
          top: ancestorClip.y,
          width: ancestorClip.width,
          height: ancestorClip.height,
          overflow: 'hidden' as const,
          // Clip wrapper itself shouldn't intercept clicks — it's an
          // invisible mask. Inner re-enables pointer events so clicks
          // land on the actual node.
          pointerEvents: 'none' as const,
          // CRITICAL: propagate the camera's 3D context through the
          // wrapper. The camera-transform wrapper uses
          // `transformStyle: preserve-3d` so descendants' rotateX /
          // rotateY foreshorten under the camera's tilt. Without
          // explicitly preserving 3D here, this wrapper inherits the
          // CSS default (`flat`), which collapses 3D children into
          // 2D — meaning toggling Clip on a frame caused its
          // descendants to suddenly stop honoring camera rotation
          // and snap back to a flat-projection position. Looked like
          // an overflow bug ("clip is cutting things off") but was
          // really a 3D-inheritance bug.
          transformStyle: 'preserve-3d' as const,
        })
      : null

  // Inner box position. When wrapped, left/top become relative to the
  // clip wrapper's local coords; when not wrapped, they're world coords.
  const innerLeft = clipWrapperStyle ? rect.x - ancestorClip!.x : rect.x
  const innerTop = clipWrapperStyle ? rect.y - ancestorClip!.y : rect.y

  const innerBox = (
    <div
      data-node-id={node.id}
      data-node-kind={node.kind}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onPointerDown={drag.onPointerDown}
      // Hover gating for the empty-frame dashed placeholder. Cheap
      // enough to wire on every node; only the empty-frame path
      // actually reads `hovered`.
      onPointerEnter={isEmptyFrame ? () => setHovered(true) : undefined}
      onPointerLeave={isEmptyFrame ? () => setHovered(false) : undefined}
      style={{
        position: 'absolute',
        left: innerLeft,
        top: innerTop,
        width: rect.width,
        height: rect.height,
        background: bg,
        ...(bgImage ?? {}),
        opacity: wrapperOpacity,
        borderRadius: wrapperBorderRadius,
        boxShadow: composedBoxShadow || undefined,
        ...(strokeBorderCss ?? {}),
        transform,
        transformOrigin: 'center center',
        filter: effectFilterCss || undefined,
        overflow: clips ? 'hidden' : undefined,
        cursor: isRoot ? 'default' : 'move',
        // Mask shapes get an accent dashed outline regardless of
        // selection so users can spot which sibling is acting as the
        // mask without having to click around. Empty frames keep
        // their existing hover/selection-gated outline.
        outline: node.isMask
          ? '1px dashed var(--color-accent)'
          : needsDashedOutline
            ? '1px dashed var(--color-border-strong)'
            : undefined,
        outlineOffset: node.isMask || needsDashedOutline ? '-1px' : undefined,
        // Apply the sibling-mask clip-path. See maskedBy / maskInfo
        // for derivation. No-op when this node isn't being masked.
        clipPath: maskClipPath,
        // Re-enable pointer events: the clip wrapper above sets
        // pointer-events:none, so we have to reinstate them here for
        // clicks / drags to reach the node.
        pointerEvents: clipWrapperStyle ? 'auto' : undefined,
      }}
    >
      {node.kind === 'image' && node.src ? (
        <img
          src={node.src}
          alt=""
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            // object-fit maps our semantic fit values 1:1 — same names,
            // same meaning. 'none' preserves natural size (overflows the
            // box); the wrapping div's `overflow: hidden` (for frames
            // that set clipsContent) keeps that contained. For image
            // leaves we don't clip by default, which mirrors how Figma
            // handles overflow when you shrink an image below its
            // natural size with fit=none.
            objectFit: node.fit,
            // Inherit the rounded corners from the node box — without
            // this, the image's square edges poke through the parent's
            // corner radius at large radii.
            borderRadius: 'inherit',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {node.kind === 'video' ? (
        <MediaVideo node={node} />
      ) : null}
      {node.kind === 'audio' ? (
        <AudioChip node={node} />
      ) : null}
      {node.kind === 'text' ? (
        <span
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            fontFamily: node.fontFamily,
            fontSize: node.fontSize,
            fontWeight: node.fontWeight,
            lineHeight: node.lineHeight,
            letterSpacing: node.letterSpacing,
            // Text color layering:
            //  - If appearance.fill is set (solid or gradient), paint
            //    the glyphs through the fill via background-clip: text.
            //    This is how you get gradient text on the web: the text
            //    becomes a clipping mask over a background image.
            //  - Otherwise, fall back to the simple `color` path that
            //    this renderer has always used. Gradients here require
            //    transparent `color` so the clipped background shows
            //    through; without it the fill would be hidden behind
            //    the flat glyph color.
            // Prefer the animation engine's fill override if a color
            // track is active. Otherwise take the static fill off the
            // node. This mirrors the wrapper-box logic above so glyphs
            // and background stay in sync during a tween.
            ...(effectiveFill
              ? {
                  background: fillToCss(effectiveFill) ?? undefined,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }
              : { color: node.color }),
            // Map our semantic align values to the CSS `text-align`
            // shorthand. `start` / `end` honor the writing direction,
            // `center` is the same in both models. Keeping 'start'/'end'
            // in the data model (vs. 'left'/'right') so eventual RTL
            // support is free.
            textAlign:
              node.textAlign === 'start'
                ? 'left'
                : node.textAlign === 'end'
                  ? 'right'
                  : 'center',
            // Preserve whitespace and allow wrapping when the text box
            // is width-constrained (Figma-style "Auto height" mode).
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            // We don't own the text editor yet; the span is display-only.
            // Prevent the OS cursor from flickering over text glyphs.
            userSelect: 'none',
          }}
        >
          {node.text}
        </span>
      ) : null}
      {stroke && stroke.width > 0 && (strokeStyle !== 'solid' || strokeHasGradient) ? (
        <StrokeOverlay
          stroke={stroke}
          width={rect.width}
          height={rect.height}
          cornerRadius={strokeOverlayCorner}
        />
      ) : null}
      {/* Layout guides — Figma-style stacked overlays. Only frames
          carry guides; visible flag toggled per-entry in the
          inspector. Painted last so they sit ABOVE content but
          stay below the selection chrome (which the SelectionOverlay
          renders outside the node entirely). Defensive `?? []` in
          case a stale doc shape reaches us — never crash on the
          new field. */}
      {node.kind === 'frame' && (node.layoutGuides ?? []).length > 0 && (
        <LayoutGuidesOverlay
          guides={node.layoutGuides ?? []}
          width={rect.width}
          height={rect.height}
        />
      )}
    </div>
  )

  if (clipWrapperStyle) {
    return <div style={clipWrapperStyle}>{innerBox}</div>
  }
  return innerBox
}

/**
 * Paints the stack of layout guides on top of a frame. Each guide
 * renders independently — they don't combine, just stack in array
 * order. Pointer-events:none across the whole layer so guides never
 * eat clicks meant for the frame or its children.
 */
function LayoutGuidesOverlay({
  guides,
  width,
  height,
}: {
  guides: import('@/scene').LayoutGuide[]
  width: number
  height: number
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      // Layout guides are editor aids, not output content. Hide them
      // from the captured stream during tab-capture export — without
      // this, your column / row / grid guides paint into the recorded
      // WebM right alongside the layout they're supposed to be helping
      // you align.
      data-export-hide="1"
    >
      {guides.map((g, i) => {
        if (!g.visible) return null
        if (g.kind === 'grid') {
          // CSS-gradient pixel grid: two repeating linear-gradients,
          // one for verticals and one for horizontals. Cheap and
          // crisp at any zoom.
          const lineColor = withOpacity(g.color, g.opacity)
          return (
            <div
              key={i}
              className="absolute inset-0"
              style={{
                backgroundImage: `linear-gradient(to right, ${lineColor} 1px, transparent 1px), linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`,
                backgroundSize: `${g.size}px ${g.size}px`,
              }}
            />
          )
        }
        if (g.kind === 'columns') {
          const fill = withOpacity(g.color, g.opacity)
          const bands = computeBands(
            g.type,
            g.count,
            width,
            g.width,
            g.margin,
            g.gutter,
          )
          return (
            <div key={i} className="absolute inset-0">
              {bands.map((b, j) => (
                <div
                  key={j}
                  className="absolute top-0 bottom-0"
                  style={{ left: b.offset, width: b.size, background: fill }}
                />
              ))}
            </div>
          )
        }
        // rows
        const fill = withOpacity(g.color, g.opacity)
        const bands = computeBands(
          g.type,
          g.count,
          height,
          g.height,
          g.margin,
          g.gutter,
        )
        return (
          <div key={i} className="absolute inset-0">
            {bands.map((b, j) => (
              <div
                key={j}
                className="absolute left-0 right-0"
                style={{ top: b.offset, height: b.size, background: fill }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Compute the per-band offset+size for a columns/rows guide, given
 * the parent dimension along the band axis. Three band-layout types:
 *   - 'stretch' — bands fill (axisLen − 2*margin − (count-1)*gutter)
 *   - 'fixed'   — packed from the start with the given band size
 *   - 'center'  — total block (count*size + (count-1)*gutter)
 *                 centered within axisLen
 */
function computeBands(
  type: 'stretch' | 'fixed' | 'center',
  count: number,
  axisLen: number,
  bandSize: number,
  margin: number,
  gutter: number,
): Array<{ offset: number; size: number }> {
  if (count <= 0) return []
  if (type === 'stretch') {
    const inner = Math.max(0, axisLen - 2 * margin - (count - 1) * gutter)
    const size = inner / count
    const out: Array<{ offset: number; size: number }> = []
    for (let i = 0; i < count; i++) {
      out.push({ offset: margin + i * (size + gutter), size })
    }
    return out
  }
  if (type === 'fixed') {
    const out: Array<{ offset: number; size: number }> = []
    for (let i = 0; i < count; i++) {
      out.push({ offset: margin + i * (bandSize + gutter), size: bandSize })
    }
    return out
  }
  // center
  const total = count * bandSize + (count - 1) * gutter
  const start = (axisLen - total) / 2
  const out: Array<{ offset: number; size: number }> = []
  for (let i = 0; i < count; i++) {
    out.push({ offset: start + i * (bandSize + gutter), size: bandSize })
  }
  return out
}

/**
 * Mix a base color with a 0..1 opacity. Implemented as a CSS
 * color-mix with `transparent` since we can't easily decompose
 * arbitrary CSS color strings. Browsers without color-mix support
 * (very old) get the base color at full opacity — acceptable
 * fallback.
 */
function withOpacity(color: string, opacity: number): string {
  const pct = Math.round(clamp01Local(opacity) * 100)
  return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

function clamp01Local(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Video leaf. Renders an `<video>` element whose playback is slaved to
 * the scene playhead.
 *
 *   - When the UI is NOT playing, we seek the element's currentTime so
 *     scrubbing the timeline scrubs the frame.
 *   - When playback starts, we call `play()` and stop spamming
 *     currentTime each frame — native video playback is smoother when
 *     we let the element run. We only resync if drift exceeds 200ms
 *     (e.g. the user scrubbed while paused and then hit play).
 *   - When the playhead is outside `[startTime, startTime + clipLen]`,
 *     the element holds its first or last frame and pauses, so the
 *     video isn't silently looping in the background.
 */
function MediaVideo({
  node,
}: {
  node: Extract<SceneNode, { kind: 'video' }>
}) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const playing = useUI((s) => s.playing)
  const playhead = useUI((s) => s.playhead)
  const clipLen = Math.max(0, (node.trimEnd || node.duration) - node.trimStart)
  const local = clampLocal(playhead - node.startTime + node.trimStart, node)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reflect muted + volume every render. These are cheap.
    el.muted = node.muted
    el.volume = Math.max(0, Math.min(1, node.volume))
  }, [node.muted, node.volume])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const inRange = playhead >= node.startTime && playhead < node.startTime + clipLen
    if (playing && inRange) {
      if (el.paused) {
        // Seek once on transition-into-playback so we start at the right
        // frame; thereafter let the element's own clock drive the tick.
        if (Math.abs(el.currentTime - local) > 0.2) el.currentTime = local
        el.play().catch(() => {
          // Autoplay policies may reject — user interaction is required.
          // We pause silently; the user can click play again after
          // interacting and the browser will admit us.
        })
      }
    } else {
      if (!el.paused) el.pause()
      // While paused / out-of-range, pin the element to the scrubbed time.
      if (Math.abs(el.currentTime - local) > 0.05) el.currentTime = local
    }
  }, [playing, playhead, local, clipLen, node.startTime])

  if (!node.src) return null

  return (
    <video
      ref={ref}
      src={node.src}
      draggable={false}
      playsInline
      preload="auto"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: node.fit,
        borderRadius: 'inherit',
        pointerEvents: 'none',
      }}
    />
  )
}

function clampLocal(
  t: number,
  node: Extract<SceneNode, { kind: 'video' | 'audio' }>,
): number {
  const trimEnd = node.trimEnd || node.duration || 0
  if (t < node.trimStart) return node.trimStart
  if (t > trimEnd) return trimEnd
  return t
}

/**
 * Audio "chip" — a non-visual node gets a small card on the artboard
 * so the user has something to click, drag, and inspect. The playback
 * is driven by a headless `<audio>` element mounted alongside the
 * chip; visuals are a speaker glyph + the node's name.
 */
function AudioChip({
  node,
}: {
  node: Extract<SceneNode, { kind: 'audio' }>
}) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const playing = useUI((s) => s.playing)
  const playhead = useUI((s) => s.playhead)
  const clipLen = Math.max(0, (node.trimEnd || node.duration) - node.trimStart)
  const local = clampLocal(playhead - node.startTime + node.trimStart, node)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.volume = Math.max(0, Math.min(1, node.volume))
  }, [node.volume])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const inRange = playhead >= node.startTime && playhead < node.startTime + clipLen
    if (playing && inRange) {
      if (el.paused) {
        if (Math.abs(el.currentTime - local) > 0.2) el.currentTime = local
        el.play().catch(() => {})
      }
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - local) > 0.05) el.currentTime = local
    }
  }, [playing, playhead, local, clipLen, node.startTime])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        height: '100%',
        padding: '0 10px',
        borderRadius: 'inherit',
        pointerEvents: 'none',
        fontSize: 11,
        color: 'var(--color-text-muted)',
        background: 'var(--color-panel-raised)',
        overflow: 'hidden',
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>
        ♪
      </span>
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {node.name}
      </span>
      {node.src ? (
        <audio
          ref={ref}
          src={node.src}
          preload="auto"
        />
      ) : null}
    </div>
  )
}

/**
 * SVG overlay that paints a dashed or dotted stroke around a node box.
 *
 * Rationale: `box-shadow` gives us solid strokes for free (including
 * corner-radius cooperation) but can't express dash patterns. CSS
 * `border-style: dashed` can, but at wide stroke widths Chromium and
 * Safari render CSS dashes inconsistently — different dash counts
 * around the four edges, asymmetric corners, no control over dash
 * length or gap. An SVG path is the portable answer: every engine
 * renders `stroke-dasharray` the same way, corners are clean, and we
 * get pixel-accurate control over the pattern.
 *
 * Alignment handling mirrors the solid path:
 *   - 'inside'   → inset by stroke width / 2 so the stroke sits inside
 *   - 'center'   → exactly on the node boundary
 *   - 'outside'  → outset by stroke width / 2 so the stroke hangs out
 *
 * For 'dotted', we draw a zero-length dash with round line caps — this
 * is how CSS `border-style: dotted` is traditionally implemented and
 * produces evenly spaced, round dots that track the border radius.
 */
function StrokeOverlay({
  stroke,
  width,
  height,
  cornerRadius,
}: {
  stroke: Stroke
  width: number
  height: number
  cornerRadius: number
}) {
  const w = stroke.width
  const half = w / 2
  let inset = 0
  if (stroke.align === 'inside') inset = half
  else if (stroke.align === 'outside') inset = -half
  // center leaves inset = 0

  const rectX = inset
  const rectY = inset
  const rectW = Math.max(0, width - inset * 2)
  const rectH = Math.max(0, height - inset * 2)
  // SVG rect `rx` clamps to half the shortest side automatically, but
  // we also shrink it by inset to keep the curve concentric with the
  // parent's border-radius when the stroke is inside.
  const rx = Math.max(0, cornerRadius - inset)

  const dashArray =
    stroke.style === 'dotted'
      ? // Zero-length paint + round cap produces round dots; gap is
        // double the stroke width so dots don't bleed into each other.
        `0 ${Math.max(1, w * 2)}`
      : stroke.style === 'dashed'
        ? `${Math.max(0, stroke.dashLength ?? 6)} ${Math.max(0, stroke.dashGap ?? 4)}`
        : undefined

  // Gradient path: serialize the fill into an SVG <linearGradient> or
  // <radialGradient>. Stable id per render — the fill changes trigger
  // a re-render, so a new id is fine. `objectBoundingBox` units let us
  // keep the gradient coords in 0..1 matching the Inspector's model.
  const fill = stroke.fill ?? null
  const gradientId = fill && fill.kind !== 'solid' ? `sg-${gradientCounter++}` : null
  const strokePaint = gradientId ? `url(#${gradientId})` : (fill?.kind === 'solid' ? fill.color : stroke.color)

  return (
    <svg
      aria-hidden
      style={{
        position: 'absolute',
        // When outside-aligned, the stroke extends past the node box,
        // so the SVG has to render without being clipped by its own
        // viewport. Give it room in both directions via negative inset
        // + matching extra width/height.
        left: Math.min(0, inset),
        top: Math.min(0, inset),
        width: width + Math.max(0, -inset) * 2,
        height: height + Math.max(0, -inset) * 2,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {gradientId && fill ? (
        <defs>
          {fill.kind === 'linear' ? (
            // CSS linear-gradient angle 0 points up, angle 90 points
            // right. SVG's default x1/y1 → x2/y2 with 0/0 at top-left
            // points DOWN for 0°. Convert: x2 = 0.5 + 0.5*sin(a), etc.
            // A 180° CSS angle means top→bottom, which matches SVG's
            // (0,0)→(0,1). sin/cos math below reproduces that mapping.
            (() => {
              const a = ((fill.angle - 90) * Math.PI) / 180
              const x1 = 0.5 - Math.cos(a) * 0.5
              const y1 = 0.5 - Math.sin(a) * 0.5
              const x2 = 0.5 + Math.cos(a) * 0.5
              const y2 = 0.5 + Math.sin(a) * 0.5
              return (
                <linearGradient id={gradientId} x1={x1} y1={y1} x2={x2} y2={y2}>
                  {fill.stops.map((s, i) => (
                    <stop key={i} offset={s.at} stopColor={s.color} />
                  ))}
                </linearGradient>
              )
            })()
          ) : fill.kind === 'radial' ? (
            <radialGradient
              id={gradientId}
              cx={fill.cx}
              cy={fill.cy}
              r={0.5}
              // 'circle' keeps falloff isotropic; 'ellipse' lets it
              // stretch with the box. objectBoundingBox is the default.
              gradientUnits="objectBoundingBox"
            >
              {fill.stops.map((s, i) => (
                <stop key={i} offset={s.at} stopColor={s.color} />
              ))}
            </radialGradient>
          ) : null}
        </defs>
      ) : null}
      <rect
        x={rectX - Math.min(0, inset)}
        y={rectY - Math.min(0, inset)}
        width={rectW}
        height={rectH}
        rx={rx}
        ry={rx}
        fill="none"
        stroke={strokePaint}
        strokeWidth={w}
        strokeDasharray={dashArray}
        strokeLinecap={stroke.style === 'dotted' ? 'round' : 'butt'}
      />
    </svg>
  )
}

// Monotonic counter used to mint unique SVG gradient ids. Incrementing
// on every render would waste ids, but given the (element-count ×
// render-rate) product is tiny, the simplicity wins — no cleanup, no
// collisions, and React remounts don't leak because the SVG DOM node
// is GCed with the overlay.
let gradientCounter = 0

// Re-export for tests or any out-of-module caller — the fields hook tree
// may eventually want to know "is anything selected inside the canvas".
export type { SolvedLayout }

// ---------------------------------------------------------------------------
// Camera viewfinder gizmo
// ---------------------------------------------------------------------------

/**
 * On-canvas representation of the camera. Without this the camera was
 * a "ghost" node — selectable only from the Layers panel, with no
 * visual presence on the canvas. Now we draw:
 *   - A rectangle showing the camera's visible scene area at the
 *     current pose. Default camera (centered, identity scale) overlaps
 *     the artboard exactly. As the camera pans / zooms / rotates, the
 *     rectangle shifts / shrinks / tilts so the user can see where
 *     the lens is pointed.
 *   - A center crosshair at the camera's transform.x/y so the camera
 *     pivot is grabbable.
 *
 * Drawn OUTSIDE the camera's own transform wrapper — otherwise the
 * gizmo would compose with the very view it represents and always
 * appear identical to the artboard. This sits in scene-space so when
 * the camera moves, the gizmo moves to match.
 *
 * Pointer-events go through the rectangle outline; the inside is
 * click-through so users can still grab scene content under the
 * gizmo. Clicking the rectangle border or crosshair selects the
 * camera node.
 */
function CameraGizmo({
  camera,
  cameraAnim,
  canvasWidth,
  canvasHeight,
  zoom,
  selected,
}: {
  camera: CameraNode
  cameraAnim: AnimatedValue | undefined
  canvasWidth: number
  canvasHeight: number
  zoom: number
  selected: boolean
}) {
  const setSelection = useUI((s) => s.setSelection)

  // Effective camera pose — animation overrides static if present.
  const cx = cameraAnim?.x ?? camera.transform.x
  const cy = cameraAnim?.y ?? camera.transform.y
  const r = cameraAnim?.rotation ?? camera.transform.rotation
  const sx = cameraAnim?.scaleX ?? camera.transform.scaleX
  const sy = cameraAnim?.scaleY ?? camera.transform.scaleY

  // Visible scene area: the camera's view fits canvasWidth × canvasHeight
  // of pixels into the artboard. Scaling up means the camera shows a
  // smaller scene region (zoom in); scaling down shows more (zoom out).
  const viewW = canvasWidth / Math.max(0.0001, sx)
  const viewH = canvasHeight / Math.max(0.0001, sy)
  const left = cx - viewW / 2
  const top = cy - viewH / 2

  // Stroke widths are scaled by 1/zoom so the outline reads as 1px on
  // screen at any zoom level — same pattern selection chrome uses.
  const stroke = (selected ? 1.5 : 1) / Math.max(zoom, 0.001)
  const dotSize = 8 / Math.max(zoom, 0.001)

  const onSelect = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setSelection([camera.id])
  }

  // Label badge — 12px text scaled inverse to zoom so it stays
  // readable at any zoom level.
  const labelFontSize = 11 / Math.max(zoom, 0.001)
  const labelPadX = 6 / Math.max(zoom, 0.001)
  const labelPadY = 2 / Math.max(zoom, 0.001)
  const dashGap = 6 / Math.max(zoom, 0.001)
  const dashLen = 8 / Math.max(zoom, 0.001)

  return (
    <>
      {/* Viewfinder rectangle. Always uses the accent color so it's
          unmistakable as camera chrome (as opposed to a regular layer
          outline). Dashed border to differentiate from solid layer
          selections. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left,
          top,
          width: viewW,
          height: viewH,
          borderWidth: stroke * 1.5,
          borderStyle: 'dashed',
          borderColor: 'var(--color-accent)',
          opacity: selected ? 1 : 0.55,
          transform: r !== 0 ? `rotate(${r}deg)` : undefined,
          transformOrigin: 'center center',
          // Prevent the long dashes from looking blurry at low zoom.
          backgroundImage: 'none',
          // Tweak dash stroke to follow the same scale-with-zoom rule.
          borderImage: 'none',
          ['--dash-len' as string]: `${dashLen}px`,
          ['--dash-gap' as string]: `${dashGap}px`,
        }}
      />
      {/* Camera label — badge at the top-left of the viewfinder so the
          rectangle is unambiguously identified as the camera, not a
          stray frame outline. */}
      <div
        onPointerDown={onSelect}
        className="absolute cursor-pointer rounded font-mono uppercase tracking-wider text-white"
        style={{
          left,
          top,
          transform: `translate(0, calc(-100% - ${4 / Math.max(zoom, 0.001)}px))`,
          background: 'var(--color-accent)',
          padding: `${labelPadY}px ${labelPadX}px`,
          fontSize: labelFontSize,
          opacity: selected ? 1 : 0.7,
          pointerEvents: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        ◉ Camera
      </div>
      {/* Center pivot — accent-colored dot at the camera's position.
          Always visible (not just when selected) so the user can
          locate the camera at a glance. Soft halo when selected for
          extra emphasis. */}
      <div
        onPointerDown={onSelect}
        title="Camera"
        className="absolute cursor-pointer rounded-full"
        style={{
          left: cx - dotSize / 2,
          top: cy - dotSize / 2,
          width: dotSize,
          height: dotSize,
          background: 'var(--color-accent)',
          border: `${stroke}px solid white`,
          boxShadow: selected
            ? `0 0 0 ${stroke * 3}px var(--color-accent-soft), 0 1px 3px rgba(0,0,0,0.3)`
            : `0 1px 3px rgba(0,0,0,0.3)`,
          pointerEvents: 'auto',
        }}
      />
    </>
  )
}