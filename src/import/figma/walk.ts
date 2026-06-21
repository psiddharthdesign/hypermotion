// SPDX-License-Identifier: Apache-2.0

import type {
  Appearance,
  CornerRadii,
  Effect as SceneEffect,
  NodeId,
  NodeKind,
  Position,
} from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { figmaToFill, figmaToStroke } from './fillMap'
import { figmaToLayout, figmaToSize, figmaToTransform } from './layoutMap'
import { figmaToText } from './textMap'
import type {
  FigmaCapturedFrame,
  FigmaCapturedNode,
  FigmaCapturedEffect,
  FigmaCapturedText,
  FigmaCapturedVector,
  FigmaPayload,
} from './types'
import {
  FIGMA_PAYLOAD_FORMAT,
  FIGMA_PAYLOAD_VERSION,
} from './types'

/**
 * Run a Figma payload through our scene model.
 *
 * The whole import lives inside one Yjs transaction so undo treats it
 * as a single step and downstream subscribers (engine, renderer,
 * inspector) only fire once.
 *
 * Each captured root node becomes a child of `parentId` in DFS order.
 * Returns the new top-level node ids — callers typically set selection
 * to this list so the user sees the imported design highlighted.
 *
 * Error handling: nodes whose `type` we don't yet support get skipped
 * with a console warning instead of crashing. The user gets a partial
 * import (better than nothing) plus a hint about what failed.
 */
export function importFigmaPayload(
  payload: FigmaPayload,
  api: SceneAPI,
  parentId: NodeId,
): NodeId[] {
  const created: NodeId[] = []
  api.doc.transact(() => {
    // Defensively flip the scene root to mode='none' before importing.
    // If the root has auto-layout enabled (flex/grid), Yoga will own
    // every child's position — the import's own transform.x/y is
    // ignored and the new frame flows somewhere unexpected. Free-canvas
    // mode lets us drop the import where we want and have it stay there.
    ensureFreeCanvasRoot(api, parentId)
    for (const node of payload.nodes) {
      const id = walk(node, api, parentId, payload.assets, null)
      if (id) created.push(id)
    }
    if (created.length > 0) {
      centerImportOnArtboard(api, created)
      recenterCameraOnArtboard(api)
    }
  })
  return created
}

/**
 * Make sure the import target is a free-canvas frame. Auto-layout on
 * the scene root makes imports invisible / unplaceable because Yoga
 * decides positions, ignoring the transform we set.
 */
function ensureFreeCanvasRoot(api: SceneAPI, rootId: NodeId): void {
  const root = api.getNode(rootId)
  if (!root || !('layout' in root)) return
  if (root.layout.mode === 'none') return
  api.setNodeProperty(rootId, 'layout', { ...root.layout, mode: 'none' })
}

/**
 * Translate the freshly-imported root nodes so their union bounding
 * box lands centered on the destination artboard.
 *
 * Why this matters:
 *   - Figma frame x/y are relative to the Figma canvas, which is
 *     effectively unbounded — designers routinely lay out at
 *     (11879, 6587). Pasted as-is, the import renders far off-screen.
 *   - Even at (0, 0), a frame smaller than the artboard would land in
 *     the top-left corner where users don't naturally look first.
 *
 * Centering puts the import where the user is already looking — the
 * middle of the visible artboard. The relative arrangement of multiple
 * selected roots is preserved (their union shifts as one block).
 */
function centerImportOnArtboard(api: SceneAPI, rootIds: NodeId[]): void {
  // When the destination root is auto-layout, ZERO every imported
  // root's transform.x/y. The captured x/y came from Figma's canvas
  // coordinate system (often 5-digit values); leaving them in place
  // would just shift the Yoga-positioned children off their slots,
  // pushing them off the visible artboard. Yoga handles their
  // positions, so we strip the stale offsets here to keep the
  // import aligned with the parent's justify/align settings.
  const sceneRoot = api.getNode(api.getRoot())
  if (sceneRoot && 'layout' in sceneRoot && sceneRoot.layout.mode !== 'none') {
    for (const id of rootIds) {
      const n = api.getNode(id)
      if (!n) continue
      if (n.transform.x === 0 && n.transform.y === 0) continue
      api.setNodeProperty(n.id, 'transform', {
        ...n.transform,
        x: 0,
        y: 0,
      })
    }
    return
  }
  // Compute union bounding box of the imported roots, using each
  // root's transform position + its size (where size is concretely
  // pixel-known after the forceFixed pass).
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of rootIds) {
    const n = api.getNode(id)
    if (!n) continue
    const w = 'size' in n && typeof n.size.width === 'number' ? n.size.width : 0
    const h =
      'size' in n && typeof n.size.height === 'number' ? n.size.height : 0
    const x = n.transform.x
    const y = n.transform.y
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x + w > maxX) maxX = x + w
    if (y + h > maxY) maxY = y + h
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return
  const meta = api.getMeta()
  const importW = maxX - minX
  const importH = maxY - minY
  // Target: the union center sits at the artboard center.
  const targetX = meta.canvas.width / 2 - importW / 2
  const targetY = meta.canvas.height / 2 - importH / 2
  const dx = targetX - minX
  const dy = targetY - minY
  if (dx === 0 && dy === 0) return
  for (const id of rootIds) {
    const n = api.getNode(id)
    if (!n) continue
    api.setNodeProperty(n.id, 'transform', {
      ...n.transform,
      x: n.transform.x + dx,
      y: n.transform.y + dy,
    })
  }
}

/**
 * Reset the active camera to the artboard center.
 *
 * The render layer treats the camera's position as the world point
 * that should appear at the screen center. When that position drifts
 * from the artboard center (for example after a scene resize, or
 * because a previous edit moved it), the camera's view transform
 * stops being identity — selection chrome, distance overlays, and
 * draw previews shift relative to the artboard fill (which renders
 * outside the camera wrapper). The result reads as "the scene is
 * disconnected from the camera," which is the bug users have been
 * hitting after Figma imports.
 *
 * Snapping the camera to (W/2, H/2) on every import guarantees the
 * pasted design appears centered on the artboard with chrome
 * properly aligned.
 */
function recenterCameraOnArtboard(api: SceneAPI): void {
  const camera = api.getActiveCamera()
  if (!camera) return
  const meta = api.getMeta()
  const targetX = meta.canvas.width / 2
  const targetY = meta.canvas.height / 2
  if (
    camera.transform.x === targetX &&
    camera.transform.y === targetY &&
    camera.transform.rotation === 0 &&
    camera.transform.scaleX === 1 &&
    camera.transform.scaleY === 1
  ) {
    return
  }
  api.setNodeProperty(camera.id, 'transform', {
    x: targetX,
    y: targetY,
    z: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
  })
}

/**
 * Validate that a clipboard string is a Figma payload we can handle.
 * Returns the parsed payload on success, null on anything else (random
 * text the user pasted, an old format we don't speak, etc.).
 */
export function parseFigmaPayload(text: string): FigmaPayload | null {
  if (!text) return null
  // Cheap pre-check: skip the JSON.parse cost for text that obviously
  // isn't ours. The payload always begins with `{"format":"hyper-motion/figma"`
  // (or with whitespace before the brace).
  if (!text.includes(FIGMA_PAYLOAD_FORMAT)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Partial<FigmaPayload>
  if (p.format !== FIGMA_PAYLOAD_FORMAT) return null
  if (p.version !== FIGMA_PAYLOAD_VERSION) {
    console.warn(
      `[figma-import] unsupported payload version ${p.version}; ` +
        `expected ${FIGMA_PAYLOAD_VERSION}. Reinstall the plugin.`,
    )
    return null
  }
  if (!Array.isArray(p.nodes)) return null
  if (typeof p.assets !== 'object' || p.assets === null) return null
  return parsed as FigmaPayload
}

// ---------------------------------------------------------------------------
// Node-by-node walk
// ---------------------------------------------------------------------------

function walk(
  node: FigmaCapturedNode,
  api: SceneAPI,
  parentId: NodeId,
  assets: Record<string, string>,
  parentLayoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID' | null,
): NodeId | null {
  // We force PIXEL SIZING on every imported frame, not just the
  // top-level root. Reasons:
  //   - Yoga's FILL on a child whose grandparent isn't a fixed-size
  //     ancestor resolves to weird percentages — the imported frame
  //     ends up oddly sized, often square instead of the wide pill the
  //     user designed.
  //   - HUG depends on intrinsic measurement; for text nodes that
  //     means font metrics — and Hyper Motion's Inter rendering may
  //     not match Figma's exactly, producing slightly different
  //     widths and breaking the layout.
  //   - Pinning every imported frame to its captured Figma pixel size
  //     makes the import a faithful "snapshot" of what the user saw,
  //     while preserving auto-layout fields (mode, direction, gap,
  //     padding, alignment) so animation tweaks still feel like
  //     adjusting an auto-layout structure.
  //
  // Users who want responsive (FILL/HUG) sizing can flip individual
  // frames in the Inspector after import.
  const isImportRoot = parentLayoutMode === null
  void isImportRoot
  const kind = pickKind(node)
  if (!kind) {
    console.warn(`[figma-import] unsupported node type ${node.type}; skipping`)
    return null
  }
  const transform = figmaToTransform(node, parentLayoutMode)
  const cornerRadii = perCornerRadiiFromFigma(node.cornerRadius)
  const appearance: Appearance = {
    opacity: node.opacity,
    fill: figmaToFill(node.fills, assets),
    stroke: figmaToStroke(
      node.strokes,
      node.strokeWeight,
      node.strokeAlign,
      node.strokeDashes,
      assets,
      node.strokeWidths,
    ),
    cornerRadius: averageCornerRadius(node.cornerRadius),
    // Preserve Figma's per-corner radii when they're non-uniform. The
    // uniform `cornerRadius` above stays populated as the fallback so
    // any code path that hasn't been per-corner-aware yet still gets a
    // sensible value.
    ...(cornerRadii ? { cornerRadii } : {}),
    effects: figmaToEffects(node.effects ?? []),
  }
  // Free-canvas children should NOT participate in the parent's flex/
  // grid solve. Auto-layout children DO. Set `position` accordingly so
  // the Yoga adapter knows which path to take.
  const position: Position =
    parentLayoutMode === null || parentLayoutMode === 'NONE'
      ? 'flow'
      : 'flow'
  // (Both branches currently use 'flow' — we may flip free-canvas
  // children to 'absolute' once the canvas's free-position semantics
  // need it. Keeping the branch in place so the call site documents
  // the decision point.)

  switch (kind) {
    case 'frame':
      return createFrame(
        node as FigmaCapturedFrame,
        api,
        parentId,
        assets,
        transform,
        appearance,
        position,
        true, // forceFixed: every frame, see comment in walk()
      )
    case 'rect':
    case 'ellipse':
      return createShape(
        node,
        kind,
        api,
        parentId,
        transform,
        appearance,
        position,
      )
    case 'text':
      return createText(
        node as FigmaCapturedText,
        api,
        parentId,
        assets,
        transform,
        appearance,
        position,
      )
    case 'image':
      return createVectorAsImage(
        node as FigmaCapturedVector,
        api,
        parentId,
        transform,
        appearance,
        position,
      )
    default:
      return null
  }
}

function pickKind(node: FigmaCapturedNode): NodeKind | null {
  switch (node.type) {
    case 'FRAME':
    case 'GROUP':
    case 'COMPONENT':
    case 'INSTANCE':
      return 'frame'
    case 'RECTANGLE':
      return 'rect'
    case 'ELLIPSE':
      return 'ellipse'
    case 'TEXT':
      return 'text'
    case 'VECTOR':
      // Vectors arrive as inline-SVG and round-trip as image fills on
      // a synthetic image node. We use the 'image' NodeKind to take
      // advantage of the existing ImageNode renderer.
      return 'image'
    default:
      return null
  }
}

function createFrame(
  node: FigmaCapturedFrame,
  api: SceneAPI,
  parentId: NodeId,
  assets: Record<string, string>,
  transform: ReturnType<typeof figmaToTransform>,
  appearance: Appearance,
  position: Position,
  forceFixed: boolean,
): NodeId {
  const layout = figmaToLayout(node)
  const size = figmaToSize(node, forceFixed)
  // Clip heuristic. Figma's default for frames is clipsContent=true,
  // which is fine in Figma because their renderer's font metrics match
  // exactly what their layout solver was sized against — content always
  // fits perfectly inside its parent. Our renderer uses fallback fonts
  // (Inter when the Figma family isn't on our Google Fonts allowlist)
  // and Yoga, so glyph widths can differ by a few pixels from what
  // Figma measured at capture time. A frame that JUST fits in Figma
  // overflows by 2–3px in our app and gets clipped — text disappearing
  // mid-word ("Invite new members, manage roles, and ass") and entire
  // right-side controls vanishing inside the card.
  //
  // The fix: only preserve clipsContent on import when the frame has
  // a non-zero corner radius. Rounded corners are the visually load-
  // bearing reason to clip (a rounded card with overflow shows ugly
  // square children poking past the curve). Plain rectangle frames
  // are layout containers — their clip in Figma is incidental, not
  // intentional, and dropping it lets the design render fully even
  // when our fonts add a couple pixels.
  //
  // Designers can re-enable clip per-frame in the Inspector for any
  // case the heuristic gets wrong.
  const corner = maxCornerRadius(appearance)
  const importedClips = node.clipsContent && corner > 0
  console.log(
    `[figma-import]   frame "${node.name}" → ${size.width}×${size.height} ` +
      `layout=${layout.mode}/${layout.direction} gap=${layout.gap} ` +
      `padding=${layout.padding.top}/${layout.padding.right}/` +
      `${layout.padding.bottom}/${layout.padding.left} ` +
      `clip=${importedClips}(figma=${node.clipsContent},corner=${corner})`,
  )
  const id = api.createNode('frame', parentId, {
    name: node.name || 'Frame',
    visible: node.visible,
    locked: node.locked,
    transform,
    appearance,
    position,
    size,
    layout,
    clipsContent: importedClips,
  })
  for (const child of node.children) {
    walk(child, api, id, assets, node.layoutMode)
  }
  return id
}

function createShape(
  node: FigmaCapturedNode,
  kind: 'rect' | 'ellipse',
  api: SceneAPI,
  parentId: NodeId,
  transform: ReturnType<typeof figmaToTransform>,
  appearance: Appearance,
  position: Position,
): NodeId {
  const size = figmaToSize(node)
  return api.createNode(kind, parentId, {
    name: node.name || (kind === 'rect' ? 'Rectangle' : 'Ellipse'),
    visible: node.visible,
    locked: node.locked,
    transform,
    appearance,
    position,
    size,
  })
}

function createText(
  node: FigmaCapturedText,
  api: SceneAPI,
  parentId: NodeId,
  assets: Record<string, string>,
  transform: ReturnType<typeof figmaToTransform>,
  appearance: Appearance,
  position: Position,
): NodeId {
  const text = figmaToText(node, assets)
  return api.createNode('text', parentId, {
    name: node.name || 'Text',
    visible: node.visible,
    locked: node.locked,
    transform,
    appearance,
    position,
    ...text,
  })
}

function createVectorAsImage(
  node: FigmaCapturedVector,
  api: SceneAPI,
  parentId: NodeId,
  transform: ReturnType<typeof figmaToTransform>,
  appearance: Appearance,
  position: Position,
): NodeId | null {
  // Encode the captured SVG markup as a data URL and store as an image
  // node. Renders correctly in the existing image path; users can
  // resize and animate transform / opacity. Replacing this with a real
  // SVG node type is a follow-up once vector authoring lands.
  const svg = node.svg.trim()
  const shouldUseRasterFallback =
    !!node.rasterPng &&
    (!!node.rasterReason || !svg || node.width < 1 || node.height < 1)
  if (!svg && !node.rasterPng) return null
  const intrinsicSize = readSvgIntrinsicSize(svg)
  const size = {
    width: pickVectorAxisSize(node.width, intrinsicSize?.width, node.strokeWeight),
    height: pickVectorAxisSize(node.height, intrinsicSize?.height, node.strokeWeight),
  }
  const svgEncoded = encodeURIComponent(svg)
  const src = shouldUseRasterFallback
    ? `data:image/png;base64,${node.rasterPng}`
    : `data:image/svg+xml;charset=utf-8,${svgEncoded}`
  const importWarning = shouldUseRasterFallback
    ? [
        node.rasterReason ??
          'Figma SVG export was not reliable for this vector, so Hyper Motion imported a PNG fallback.',
        'The visual appearance is preserved, but this layer is not editable as vector paths. If you need editable SVG, outline or flatten unusual strokes in Figma and copy again.',
      ].join(' ')
    : undefined
  return api.createNode('image', parentId, {
    name: node.name || 'Vector',
    visible: node.visible,
    locked: node.locked,
    transform,
    appearance: {
      ...appearance,
      fill: null,
      stroke: null,
    },
    position,
    size,
    src,
    fit: 'contain',
    ...(importWarning ? { importWarning } : {}),
  })
}

function pickVectorAxisSize(
  captured: number,
  intrinsic: number | undefined,
  strokeWeight: number | undefined,
): number {
  if (Number.isFinite(captured) && captured >= 1) return captured
  if (intrinsic !== undefined && Number.isFinite(intrinsic) && intrinsic > 0) return intrinsic
  if (strokeWeight !== undefined && Number.isFinite(strokeWeight) && strokeWeight > 0) return strokeWeight
  return 1
}

function readSvgIntrinsicSize(svg: string): { width?: number; height?: number } | null {
  const width = readSvgLength(svg, 'width')
  const height = readSvgLength(svg, 'height')
  if (width !== undefined || height !== undefined) return { width, height }

  const viewBox = svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  if (!viewBox) return null
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null
  return { width: Math.abs(parts[2]), height: Math.abs(parts[3]) }
}

function readSvgLength(svg: string, attr: 'width' | 'height'): number | undefined {
  const raw = svg.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]
  if (!raw) return undefined
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Reduce Figma's per-corner radii to our single uniform cornerRadius.
 * Always populated as a fallback for code paths that haven't been
 * per-corner-aware yet. Picks the average rather than min/max so
 * rounded-but-not-uniform corners read roughly right when the
 * per-corner override is cleared.
 */
function averageCornerRadius(corners: [number, number, number, number]): number {
  const sum = corners.reduce((a, b) => a + b, 0)
  return sum / 4
}

/**
 * Promote Figma's per-corner array `[tl, tr, br, bl]` to a `CornerRadii`
 * object only if the corners are NOT uniform. Returns null when all
 * four corners are equal — in that case the uniform `cornerRadius`
 * field already captures the value and a per-corner override would just
 * be noise. Tolerates floating-point dust with a small epsilon.
 */
function perCornerRadiiFromFigma(
  corners: [number, number, number, number],
): CornerRadii | null {
  const [tl, tr, br, bl] = corners
  const eps = 0.01
  const isUniform =
    Math.abs(tl - tr) < eps &&
    Math.abs(tl - br) < eps &&
    Math.abs(tl - bl) < eps
  if (isUniform) return null
  return { tl, tr, br, bl }
}

function maxCornerRadius(appearance: Appearance): number {
  const radii = appearance.cornerRadii
  return radii
    ? Math.max(radii.tl, radii.tr, radii.br, radii.bl)
    : appearance.cornerRadius
}

function figmaToEffects(effects: FigmaCapturedEffect[]): SceneEffect[] {
  return effects.map((effect) => {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      return {
        kind: effect.type === 'DROP_SHADOW' ? 'shadow' : 'inner-shadow',
        visible: effect.visible,
        color: figmaColorToRgba(effect.color),
        offsetX: effect.offset.x,
        offsetY: effect.offset.y,
        blur: effect.radius,
        spread: effect.spread,
      }
    }
    return {
      kind: 'blur',
      visible: effect.visible,
      amount: effect.radius,
    }
  })
}

function figmaColorToRgba(color: {
  r: number
  g: number
  b: number
  a: number
}): string {
  const r = Math.round(clamp01(color.r) * 255)
  const g = Math.round(clamp01(color.g) * 255)
  const b = Math.round(clamp01(color.b) * 255)
  const a = clamp01(color.a)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
