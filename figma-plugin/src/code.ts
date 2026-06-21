// SPDX-License-Identifier: Apache-2.0

/**
 * Hyper Motion Import — sandboxed plugin code.
 *
 * Runs in Figma's plugin sandbox: no DOM, no fetch, no clipboard. We
 * walk the user's selection, build a JSON payload that matches the
 * format Hyper Motion's paste handler expects, and hand it off to the
 * UI iframe (which DOES have clipboard access).
 *
 * The schema mirrors src/import/figma/types.ts in the Hyper Motion
 * repo. Keep them in sync — both files declare the same constants
 * (FIGMA_PAYLOAD_FORMAT + FIGMA_PAYLOAD_VERSION) so the importer can
 * detect/reject mismatched plugin builds.
 */

const FIGMA_PAYLOAD_FORMAT = 'hyper-motion/figma'
const FIGMA_PAYLOAD_VERSION = 1

figma.showUI(__html__, { width: 280, height: 220, themeColors: true })

postSelectionCount()
figma.on('selectionchange', postSelectionCount)

figma.ui.onmessage = async (msg: { kind: string }) => {
  if (msg.kind === 'copy') {
    try {
      const payload = await buildPayload(figma.currentPage.selection)
      const json = JSON.stringify(payload)
      figma.ui.postMessage({ kind: 'payload', json })
    } catch (err) {
      figma.ui.postMessage({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (msg.kind === 'close') {
    figma.closePlugin()
  }
}

function postSelectionCount() {
  const sel = figma.currentPage.selection
  figma.ui.postMessage({ kind: 'selection', count: sel.length })
}

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

interface Payload {
  format: typeof FIGMA_PAYLOAD_FORMAT
  version: typeof FIGMA_PAYLOAD_VERSION
  nodes: CapturedNode[]
  assets: Record<string, string>
}

type CapturedNode =
  | CapturedFrame
  | CapturedRect
  | CapturedEllipse
  | CapturedText
  | CapturedVector

interface CapturedNodeBase {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  x: number
  y: number
  width: number
  height: number
  rotation: number
  cornerRadius: [number, number, number, number]
  fills: CapturedFill[]
  strokes: CapturedFill[]
  strokeWeight: number
  strokeWidths?: { top: number; right: number; bottom: number; left: number }
  strokeAlign: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  strokeDashes: number[]
  effects: CapturedEffect[]
}

interface CapturedFrame extends CapturedNodeBase {
  type: 'FRAME' | 'GROUP' | 'COMPONENT' | 'INSTANCE'
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID'
  primaryAxisSizingMode: 'FIXED' | 'AUTO'
  counterAxisSizingMode: 'FIXED' | 'AUTO'
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
  primaryAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN'
  counterAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE'
  itemSpacing: number
  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
  layoutWrap: 'NO_WRAP' | 'WRAP'
  clipsContent: boolean
  children: CapturedNode[]
}

interface CapturedRect extends CapturedNodeBase {
  type: 'RECTANGLE'
}

interface CapturedEllipse extends CapturedNodeBase {
  type: 'ELLIPSE'
}

interface CapturedText extends CapturedNodeBase {
  type: 'TEXT'
  characters: string
  fontFamily: string
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  fontSize: number
  lineHeightPx: number
  letterSpacingPx: number
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM'
  textAutoResize: 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT'
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
}

interface CapturedVector extends CapturedNodeBase {
  type: 'VECTOR'
  svg: string
  rasterPng?: string
  rasterReason?: string
}

type CapturedEffect =
  | {
      type: 'DROP_SHADOW' | 'INNER_SHADOW'
      visible: boolean
      color: { r: number; g: number; b: number; a: number }
      offset: { x: number; y: number }
      radius: number
      spread: number
    }
  | {
      type: 'LAYER_BLUR'
      visible: boolean
      radius: number
    }

type CapturedFill = SolidFill | GradientFill | ImageFill

interface SolidFill {
  type: 'SOLID'
  color: { r: number; g: number; b: number }
  opacity: number
  visible: boolean
}

interface GradientFill {
  type:
    | 'GRADIENT_LINEAR'
    | 'GRADIENT_RADIAL'
    | 'GRADIENT_ANGULAR'
    | 'GRADIENT_DIAMOND'
  gradientHandlePositions: Array<{ x: number; y: number }>
  gradientStops: Array<{
    position: number
    color: { r: number; g: number; b: number; a: number }
  }>
  opacity: number
  visible: boolean
}

interface ImageFill {
  type: 'IMAGE'
  imageHash: string
  scaleMode: 'FILL' | 'FIT' | 'TILE' | 'CROP' | 'STRETCH'
  opacity: number
  visible: boolean
}

async function buildPayload(selection: readonly SceneNode[]): Promise<Payload> {
  if (selection.length === 0) throw new Error('Nothing selected')
  const assets: Record<string, string> = {}
  const nodes: CapturedNode[] = []
  for (const node of selection) {
    const captured = await captureNode(node, assets)
    if (captured) nodes.push(captured)
  }
  return {
    format: FIGMA_PAYLOAD_FORMAT,
    version: FIGMA_PAYLOAD_VERSION,
    nodes,
    assets,
  }
}

async function captureNode(
  node: SceneNode,
  assets: Record<string, string>,
): Promise<CapturedNode | null> {
  switch (node.type) {
    case 'FRAME':
    case 'GROUP':
    case 'COMPONENT':
    case 'INSTANCE':
      if (shouldRasterizeVectorTree(node)) {
        return captureVector(
          node,
          assets,
          'Figma exported this icon as nested vector fragments, so Hyper Motion imports it as a PNG to preserve the exact appearance.',
        )
      }
      return captureFrame(node as FrameNode, assets)
    case 'RECTANGLE':
      return captureRect(node as RectangleNode, assets)
    case 'ELLIPSE':
      return captureEllipse(node as EllipseNode, assets)
    case 'TEXT':
      return captureText(node as TextNode, assets)
    case 'VECTOR':
    case 'STAR':
    case 'POLYGON':
    case 'BOOLEAN_OPERATION':
    case 'LINE':
      return captureVector(node, assets)
    default:
      console.warn(
        `[hyper-motion] Skipping unsupported node type: ${node.type}`,
      )
      return null
  }
}

// ---------------------------------------------------------------------------
// Per-kind capture
// ---------------------------------------------------------------------------

async function captureFrame(
  node: FrameNode,
  assets: Record<string, string>,
): Promise<CapturedFrame> {
  const base = await captureBase(node, assets)
  const children: CapturedNode[] = []
  for (const child of node.children) {
    const c = await captureNode(child, assets)
    if (c) children.push(c)
  }
  // Cast guards: the typed Figma API returns specific union members per
  // field; widen them to our schema's value space.
  return {
    ...base,
    type: nodeTypeAsFrame(node.type),
    layoutMode: node.layoutMode as CapturedFrame['layoutMode'],
    primaryAxisSizingMode:
      (node.primaryAxisSizingMode as CapturedFrame['primaryAxisSizingMode']) ??
      'FIXED',
    counterAxisSizingMode:
      (node.counterAxisSizingMode as CapturedFrame['counterAxisSizingMode']) ??
      'FIXED',
    layoutSizingHorizontal: (node as unknown as {
      layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
    }).layoutSizingHorizontal,
    layoutSizingVertical: (node as unknown as {
      layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
    }).layoutSizingVertical,
    primaryAxisAlignItems:
      (node.primaryAxisAlignItems as CapturedFrame['primaryAxisAlignItems']) ??
      'MIN',
    counterAxisAlignItems:
      (node.counterAxisAlignItems as CapturedFrame['counterAxisAlignItems']) ??
      'MIN',
    itemSpacing: node.itemSpacing ?? 0,
    paddingLeft: node.paddingLeft ?? 0,
    paddingRight: node.paddingRight ?? 0,
    paddingTop: node.paddingTop ?? 0,
    paddingBottom: node.paddingBottom ?? 0,
    layoutWrap:
      (node.layoutWrap as CapturedFrame['layoutWrap']) ?? 'NO_WRAP',
    clipsContent: node.clipsContent,
    children,
  }
}

function shouldRasterizeVectorTree(node: SceneNode): boolean {
  if (
    node.type !== 'FRAME' &&
    node.type !== 'GROUP' &&
    node.type !== 'COMPONENT' &&
    node.type !== 'INSTANCE'
  ) {
    return false
  }
  const children = (node as ChildrenMixin).children
  if (!children || children.length === 0) return false
  const layoutMode = (node as Partial<FrameNode>).layoutMode
  if (layoutMode && layoutMode !== 'NONE') return false
  return children.every(isVectorTreeNode)
}

function isVectorTreeNode(node: SceneNode): boolean {
  if (!node.visible) return true
  if (
    node.type === 'VECTOR' ||
    node.type === 'STAR' ||
    node.type === 'POLYGON' ||
    node.type === 'BOOLEAN_OPERATION' ||
    node.type === 'LINE'
  ) {
    return true
  }
  if (
    node.type === 'FRAME' ||
    node.type === 'GROUP' ||
    node.type === 'COMPONENT' ||
    node.type === 'INSTANCE'
  ) {
    const children = (node as ChildrenMixin).children
    if (!children || children.length === 0) return false
    const layoutMode = (node as Partial<FrameNode>).layoutMode
    if (layoutMode && layoutMode !== 'NONE') return false
    return children.every(isVectorTreeNode)
  }
  return false
}

function nodeTypeAsFrame(t: string): CapturedFrame['type'] {
  if (t === 'FRAME' || t === 'GROUP' || t === 'COMPONENT' || t === 'INSTANCE') {
    return t
  }
  return 'FRAME'
}

async function captureRect(
  node: RectangleNode,
  assets: Record<string, string>,
): Promise<CapturedRect> {
  return { ...(await captureBase(node, assets)), type: 'RECTANGLE' }
}

async function captureEllipse(
  node: EllipseNode,
  assets: Record<string, string>,
): Promise<CapturedEllipse> {
  return { ...(await captureBase(node, assets)), type: 'ELLIPSE' }
}

async function captureText(
  node: TextNode,
  assets: Record<string, string>,
): Promise<CapturedText> {
  const base = await captureBase(node, assets)
  // Mixed font/size across runs in a single text node returns
  // figma.mixed (a Symbol). For MVP we read the first run by passing
  // index 0; richer per-run capture is a follow-up.
  const fontName = node.getRangeFontName(0, 1) as FontName
  const fontSize = node.getRangeFontSize(0, 1) as number
  const lineHeight = node.getRangeLineHeight(0, 1) as LineHeight
  const letterSpacing = node.getRangeLetterSpacing(0, 1) as LetterSpacing
  return {
    ...base,
    type: 'TEXT',
    characters: node.characters,
    fontFamily: fontName?.family ?? 'Inter',
    fontWeight: weightFromStyle(fontName?.style ?? 'Regular'),
    fontStyle: /Italic/i.test(fontName?.style ?? '') ? 'italic' : 'normal',
    fontSize: typeof fontSize === 'number' ? fontSize : 14,
    lineHeightPx: lineHeightToPx(lineHeight, fontSize),
    letterSpacingPx: letterSpacingToPx(letterSpacing, fontSize),
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    textAutoResize: node.textAutoResize as CapturedText['textAutoResize'],
    layoutSizingHorizontal: (node as unknown as {
      layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
    }).layoutSizingHorizontal,
    layoutSizingVertical: (node as unknown as {
      layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
    }).layoutSizingVertical,
  }
}

async function captureVector(
  node: SceneNode,
  assets: Record<string, string>,
  rasterReason?: string,
): Promise<CapturedVector> {
  const base = await captureBase(
    node as unknown as SceneNode & GeometryMixin,
    assets,
  )
  // Round-trip vectors as inline SVG. exportAsync returns a Uint8Array
  // when format is SVG; decode to text. The importer wraps the SVG in
  // a data URL and renders it as an image fill — same as how external
  // images get treated.
  let svg = ''
  try {
    const bytes = await (
      node as unknown as { exportAsync: (s: ExportSettings) => Promise<Uint8Array> }
    ).exportAsync({ format: 'SVG' })
    svg = bytesToString(bytes)
  } catch (err) {
    console.warn('[hyper-motion] SVG export failed', err)
  }
  let rasterPng = ''
  let reason = rasterReason
  try {
    const bytes = await (
      node as unknown as { exportAsync: (s: ExportSettings) => Promise<Uint8Array> }
    ).exportAsync({ format: 'PNG' })
    rasterPng = bytesToBase64(bytes)
  } catch (err) {
    console.warn('[hyper-motion] PNG vector fallback export failed', err)
    reason =
      reason ??
      'Figma could not export this vector as a fallback image. The SVG may not match exactly.'
  }
  if (!svg.trim()) {
    reason =
      reason ??
      'Figma returned an empty SVG for this vector. Hyper Motion used a PNG fallback to preserve the visual result.'
  } else if (base.width < 1 || base.height < 1) {
    reason =
      reason ??
      'Figma reported collapsed bounds for this stroked vector. Hyper Motion used a PNG fallback to preserve the visual result.'
  }
  return {
    ...base,
    type: 'VECTOR',
    svg,
    ...(rasterPng ? { rasterPng } : {}),
    ...(reason ? { rasterReason: reason } : {}),
  }
}

// ---------------------------------------------------------------------------
// Base capture (geometry + paint)
// ---------------------------------------------------------------------------

async function captureBase(
  node: SceneNode,
  assets: Record<string, string>,
): Promise<CapturedNodeBase> {
  const geo = node as SceneNode & {
    fills?: ReadonlyArray<Paint> | symbol
    strokes?: ReadonlyArray<Paint>
    strokeWeight?: number | symbol
    strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
    individualStrokeWeights?: {
      top: number
      right: number
      bottom: number
      left: number
    } | symbol
    dashPattern?: ReadonlyArray<number>
    cornerRadius?: number | symbol
    topLeftRadius?: number
    topRightRadius?: number
    bottomLeftRadius?: number
    bottomRightRadius?: number
    rotation?: number
    opacity?: number
    effects?: ReadonlyArray<Effect> | symbol
  }
  const fills = await capturePaints(
    Array.isArray(geo.fills) ? geo.fills : [],
    assets,
  )
  const strokes = await capturePaints(geo.strokes ?? [], assets)
  const strokeWeight =
    typeof geo.strokeWeight === 'number' ? geo.strokeWeight : 0
  const strokeWidths = strokeWidthsOf(geo.individualStrokeWeights, strokeWeight)
  const strokeAlign = geo.strokeAlign ?? 'INSIDE'
  const strokeDashes = Array.isArray(geo.dashPattern)
    ? Array.from(geo.dashPattern)
    : []
  const effects = Array.isArray(geo.effects) ? captureEffects(geo.effects) : []
  return {
    id: node.id,
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    opacity: typeof geo.opacity === 'number' ? geo.opacity : 1,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: typeof geo.rotation === 'number' ? geo.rotation : 0,
    cornerRadius: cornerRadiiOf(geo),
    fills,
    strokes,
    strokeWeight,
    ...(strokeWidths ? { strokeWidths } : {}),
    strokeAlign,
    strokeDashes,
    effects,
  }
}

function captureEffects(effects: ReadonlyArray<Effect>): CapturedEffect[] {
  const out: CapturedEffect[] = []
  for (const effect of effects) {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      out.push({
        type: effect.type,
        visible: effect.visible !== false,
        color: effect.color,
        offset: { x: effect.offset.x, y: effect.offset.y },
        radius: effect.radius,
        spread: effect.spread ?? 0,
      })
    } else if (effect.type === 'LAYER_BLUR') {
      out.push({
        type: 'LAYER_BLUR',
        visible: effect.visible !== false,
        radius: effect.radius,
      })
    }
  }
  return out
}

function strokeWidthsOf(
  widths:
    | {
        top: number
        right: number
        bottom: number
        left: number
      }
    | symbol
    | undefined,
  uniformWeight: number,
): { top: number; right: number; bottom: number; left: number } | undefined {
  if (!widths || typeof widths === 'symbol') return undefined
  const out = {
    top: widths.top,
    right: widths.right,
    bottom: widths.bottom,
    left: widths.left,
  }
  const eps = 0.01
  const isUniform =
    Math.abs(out.top - uniformWeight) < eps &&
    Math.abs(out.right - uniformWeight) < eps &&
    Math.abs(out.bottom - uniformWeight) < eps &&
    Math.abs(out.left - uniformWeight) < eps
  return isUniform ? undefined : out
}

function cornerRadiiOf(geo: {
  cornerRadius?: number | symbol
  topLeftRadius?: number
  topRightRadius?: number
  bottomLeftRadius?: number
  bottomRightRadius?: number
}): [number, number, number, number] {
  // Per-corner first; uniform second; default zeros.
  const tl = geo.topLeftRadius ?? 0
  const tr = geo.topRightRadius ?? 0
  const br = geo.bottomRightRadius ?? 0
  const bl = geo.bottomLeftRadius ?? 0
  if (tl || tr || br || bl) return [tl, tr, br, bl]
  if (typeof geo.cornerRadius === 'number') {
    const c = geo.cornerRadius
    return [c, c, c, c]
  }
  return [0, 0, 0, 0]
}

async function capturePaints(
  paints: ReadonlyArray<Paint>,
  assets: Record<string, string>,
): Promise<CapturedFill[]> {
  const out: CapturedFill[] = []
  for (const p of paints) {
    const c = await capturePaint(p, assets)
    if (c) out.push(c)
  }
  return out
}

async function capturePaint(
  paint: Paint,
  assets: Record<string, string>,
): Promise<CapturedFill | null> {
  const visible = (paint as { visible?: boolean }).visible !== false
  if (!visible) return null
  if (paint.type === 'SOLID') {
    return {
      type: 'SOLID',
      color: { r: paint.color.r, g: paint.color.g, b: paint.color.b },
      opacity: paint.opacity ?? 1,
      visible,
    }
  }
  if (
    paint.type === 'GRADIENT_LINEAR' ||
    paint.type === 'GRADIENT_RADIAL' ||
    paint.type === 'GRADIENT_ANGULAR' ||
    paint.type === 'GRADIENT_DIAMOND'
  ) {
    // The plugin API exposes gradientTransform (a 2×3 affine matrix
    // mapping LAYER UV space → GRADIENT unit space). The wire format
    // uses three handle positions in LAYER UV space — the gradient's
    // start, end, and width-defining points. Invert the matrix and
    // apply to (0,0), (1,0), (0,1) in gradient space to get them.
    return {
      type: paint.type,
      gradientHandlePositions: gradientHandlesFromTransform(
        paint.gradientTransform,
      ),
      gradientStops: paint.gradientStops.map((s) => ({
        position: s.position,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
      })),
      opacity: paint.opacity ?? 1,
      visible,
    }
  }
  if (paint.type === 'IMAGE') {
    if (!paint.imageHash) return null
    // Cache image bytes per hash so multiple references to the same
    // image dedupe in the payload.
    if (!assets[paint.imageHash]) {
      try {
        const image = figma.getImageByHash(paint.imageHash)
        if (image) {
          const bytes = await image.getBytesAsync()
          assets[paint.imageHash] = bytesToBase64(bytes)
        }
      } catch (err) {
        console.warn('[hyper-motion] Image bytes fetch failed', err)
      }
    }
    return {
      type: 'IMAGE',
      imageHash: paint.imageHash,
      scaleMode: paint.scaleMode as ImageFill['scaleMode'],
      opacity: paint.opacity ?? 1,
      visible,
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function weightFromStyle(style: string): number {
  // Figma style names → numeric CSS font-weight.
  const map: Record<string, number> = {
    Thin: 100,
    'Extra Light': 200,
    ExtraLight: 200,
    Light: 300,
    Regular: 400,
    Medium: 500,
    'Semi Bold': 600,
    SemiBold: 600,
    Bold: 700,
    'Extra Bold': 800,
    ExtraBold: 800,
    Black: 900,
  }
  // Strip italic suffix before lookup; italic/style is captured separately.
  const key = style.replace(/Italic/i, '').trim()
  return map[key] ?? 400
}

function lineHeightToPx(lh: LineHeight, fontSize: number): number {
  if (typeof fontSize !== 'number') return 0
  if (!lh || (lh as { unit?: string }).unit === 'AUTO') return fontSize * 1.2
  if ((lh as { unit?: string }).unit === 'PIXELS') {
    return (lh as { value: number }).value
  }
  if ((lh as { unit?: string }).unit === 'PERCENT') {
    return ((lh as { value: number }).value / 100) * fontSize
  }
  return fontSize * 1.2
}

function letterSpacingToPx(ls: LetterSpacing, fontSize: number): number {
  if (typeof fontSize !== 'number') return 0
  if (!ls) return 0
  if ((ls as { unit?: string }).unit === 'PIXELS') {
    return (ls as { value: number }).value
  }
  if ((ls as { unit?: string }).unit === 'PERCENT') {
    return ((ls as { value: number }).value / 100) * fontSize
  }
  return 0
}

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid `btoa(String.fromCharCode(...bytes))` — chunked apply blows
  // the call stack on large images. Build in chunks to keep memory flat.
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, Array.from(chunk))
  }
  // Plugin sandbox exposes `btoa`.
  return btoa(binary)
}

/**
 * Derive the three Figma-style "gradient handle positions" from the
 * 2×3 `gradientTransform` matrix the plugin API gives us.
 *
 * Forward gradientTransform: LAYER UV (0..1) → GRADIENT unit (0..1).
 * The handles we want are the LAYER UV positions of the gradient's
 * (0,0), (1,0), (0,1) points — i.e. the inverse of the transform
 * applied to those reference points.
 */
function gradientHandlesFromTransform(
  t: Transform,
): Array<{ x: number; y: number }> {
  const a = t[0][0]
  const b = t[0][1]
  const tx = t[0][2]
  const c = t[1][0]
  const d = t[1][1]
  const ty = t[1][2]
  const det = a * d - b * c
  if (det === 0) {
    // Degenerate transform — return a sane top-to-bottom default so the
    // importer still produces something visible.
    return [
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 },
    ]
  }
  const invA = d / det
  const invB = -b / det
  const invC = -c / det
  const invD = a / det
  const invTx = -(invA * tx + invB * ty)
  const invTy = -(invC * tx + invD * ty)
  const apply = (px: number, py: number) => ({
    x: invA * px + invB * py + invTx,
    y: invC * px + invD * py + invTy,
  })
  return [apply(0, 0), apply(1, 0), apply(0, 1)]
}

function bytesToString(bytes: Uint8Array): string {
  // SVG export is UTF-8; decode it directly.
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes)
  }
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}
