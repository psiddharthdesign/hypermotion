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

import { readFirstTextStyle } from './textStyle'

const FIGMA_PAYLOAD_FORMAT = 'hyper-motion/figma'
const FIGMA_PAYLOAD_VERSION = 3
const VECTOR_EXPORT_TIMEOUT_MS = 1_000
const IMAGE_BYTES_TIMEOUT_MS = 2_000
const PROGRESS_YIELD_INTERVAL = 10

// Initialize the capture revision before starting the first capture. The
// plugin bundle targets older JavaScript and lowers this `let` to `var`; if
// prepareSelection runs first, ++undefined becomes NaN and the revision guard
// silently discards the initial progress and payload forever.
let selectionRevision = 0

figma.showUI(__html__, { width: 280, height: 220, themeColors: true })

prepareSelection()
figma.on('selectionchange', prepareSelection)

figma.ui.onmessage = (msg: { kind: string }) => {
  if (msg.kind === 'close') {
    figma.closePlugin()
  }
}

// Payloads are prepared before the user clicks Copy. This keeps the actual
// clipboard operation synchronous with the click, which is required by
// browsers that deny async clipboard access to Figma's plugin iframe.
//
// Captures can overlap when the user changes selection quickly. Only the most
// recent revision may update the UI, preventing a slower old capture from
// replacing the payload for the current selection.
function prepareSelection(): void {
  const revision = ++selectionRevision
  const selection = [...figma.currentPage.selection]
  const totalNodes = countSceneNodes(selection)

  figma.ui.postMessage({
    kind: 'selection',
    count: selection.length,
    totalNodes,
  })
  if (selection.length === 0) return

  const progress: CaptureProgress = {
    totalNodes,
    processedNodes: 0,
    currentNode: '',
    lastReportedAt: 0,
    lastYieldedAt: 0,
    report(snapshot) {
      if (revision !== selectionRevision) return
      figma.ui.postMessage({ kind: 'progress', ...snapshot })
    },
  }

  void buildPayload(selection, progress)
    .then((payload) => {
      if (revision !== selectionRevision) return
      figma.ui.postMessage({ kind: 'payload', json: JSON.stringify(payload) })
    })
    .catch((err: unknown) => {
      if (revision !== selectionRevision) return
      figma.ui.postMessage({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    })
}

function countSceneNodes(nodes: readonly SceneNode[]): number {
  let count = 0
  for (const node of nodes) {
    count += 1
    if ('children' in node) {
      count += countSceneNodes(node.children)
    }
  }
  return count
}

function reportCaptureProgress(
  progress: CaptureProgress,
  force = false,
): void {
  const now = Date.now()
  if (!force && now - progress.lastReportedAt < 100) return
  progress.lastReportedAt = now
  progress.report({
    processedNodes: progress.processedNodes,
    totalNodes: progress.totalNodes,
    currentNode: progress.currentNode,
  })
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

interface CaptureProgress {
  totalNodes: number
  processedNodes: number
  currentNode: string
  lastReportedAt: number
  lastYieldedAt: number
  report: (snapshot: {
    processedNodes: number
    totalNodes: number
    currentNode: string
  }) => void
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
  relativeTransform?: CapturedTransform
  layoutPositioning?: 'AUTO' | 'ABSOLUTE'
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
  minWidth?: number | null
  maxWidth?: number | null
  minHeight?: number | null
  maxHeight?: number | null
  cornerRadius: [number, number, number, number]
  cornerSmoothing?: number
  fills: CapturedFill[]
  strokes: CapturedFill[]
  strokeWeight: number
  strokeWidths?: { top: number; right: number; bottom: number; left: number }
  strokeAlign: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  strokeDashes: number[]
  strokeDashOffset?: number
  strokeCap?: CapturedStrokeCap | 'MIXED'
  strokeJoin?: CapturedStrokeJoin | 'MIXED'
  strokeMiterLimit?: number
  blendMode: CapturedBlendMode
  effects: CapturedEffect[]
}

type CapturedTransform = [
  [number, number, number],
  [number, number, number],
]

type CapturedStrokeCap = Exclude<StrokeCap, PluginAPI['mixed']>
type CapturedStrokeJoin = Exclude<StrokeJoin, PluginAPI['mixed']>

interface CapturedFrame extends CapturedNodeBase {
  type: 'FRAME' | 'GROUP' | 'COMPONENT' | 'INSTANCE'
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID'
  gridRowCount?: number
  gridColumnCount?: number
  gridRowGap?: number
  gridColumnGap?: number
  strokesIncludedInLayout?: boolean
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
  arcData?: {
    startingAngle: number
    endingAngle: number
    innerRadius: number
  }
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
  textCase:
    | 'ORIGINAL'
    | 'UPPER'
    | 'LOWER'
    | 'TITLE'
    | 'SMALL_CAPS'
    | 'SMALL_CAPS_FORCED'
  textDecoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM'
  textAutoResize: 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT'
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
}

interface CapturedVector extends CapturedNodeBase {
  type: 'VECTOR'
  sourceKind:
    | 'VECTOR'
    | 'STAR'
    | 'POLYGON'
    | 'BOOLEAN_OPERATION'
    | 'LINE'
    | 'ELLIPSE'
  svg: string
  viewBox?: CapturedVectorViewBox
  vectorPaths?: CapturedVectorPath[]
  vectorNetwork?: CapturedVectorNetwork
  fillGeometry?: CapturedVectorPath[]
  strokeGeometry?: CapturedVectorPath[]
  primitive?: CapturedVectorPrimitive
  fidelity: 'editable' | 'partial' | 'preserved'
  unsupported?: string[]
  variableWidthStroke?: unknown
  complexStroke?: unknown
  rasterPng?: string
  rasterReason?: string
}

interface CapturedVectorViewBox {
  x: number
  y: number
  width: number
  height: number
}

interface CapturedVectorPath {
  windingRule: 'NONZERO' | 'EVENODD' | 'NONE'
  data: string
}

interface CapturedVectorVertex {
  x: number
  y: number
  strokeCap?: CapturedStrokeCap
  strokeJoin?: CapturedStrokeJoin
  cornerRadius?: number
  handleMirroring?: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH'
}

interface CapturedVectorSegment {
  start: number
  end: number
  tangentStart?: { x: number; y: number }
  tangentEnd?: { x: number; y: number }
}

interface CapturedVectorRegion {
  windingRule: 'NONZERO' | 'EVENODD'
  loops: number[][]
  fills?: CapturedFill[]
  fillStyleId?: string
}

interface CapturedVectorNetwork {
  vertices: CapturedVectorVertex[]
  segments: CapturedVectorSegment[]
  regions: CapturedVectorRegion[]
}

type CapturedVectorPrimitive =
  | { kind: 'star'; pointCount: number; innerRadius: number; cornerRadius: number }
  | { kind: 'polygon'; pointCount: number; cornerRadius: number }
  | { kind: 'ellipse'; startAngle: number; endAngle: number; innerRadius: number }
  | { kind: 'line' }
  | { kind: 'boolean'; operation: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE' }

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

type CapturedBlendMode =
  | 'PASS_THROUGH'
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'LINEAR_BURN'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'LINEAR_DODGE'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY'

interface SolidFill {
  type: 'SOLID'
  color: { r: number; g: number; b: number }
  opacity: number
  visible: boolean
  blendMode?: CapturedBlendMode
}

interface GradientFill {
  type:
    | 'GRADIENT_LINEAR'
    | 'GRADIENT_RADIAL'
    | 'GRADIENT_ANGULAR'
    | 'GRADIENT_DIAMOND'
  gradientHandlePositions: Array<{ x: number; y: number }>
  gradientTransform?: CapturedTransform
  gradientStops: Array<{
    position: number
    color: { r: number; g: number; b: number; a: number }
  }>
  opacity: number
  visible: boolean
  blendMode?: CapturedBlendMode
}

interface ImageFill {
  type: 'IMAGE'
  imageHash: string
  scaleMode: 'FILL' | 'FIT' | 'TILE' | 'CROP' | 'STRETCH'
  opacity: number
  visible: boolean
  blendMode?: CapturedBlendMode
  imageTransform?: CapturedTransform
  scalingFactor?: number
  rotation?: number
  filters?: ImageFilters
}

async function buildPayload(
  selection: readonly SceneNode[],
  progress: CaptureProgress,
): Promise<Payload> {
  if (selection.length === 0) throw new Error('Nothing selected')
  const assets: Record<string, string> = {}
  const nodes: CapturedNode[] = []
  for (const node of selection) {
    // Selection roots deliberately keep Figma's container-relative transform.
    // Descendants receive an explicit captured parent below so groups and
    // boolean operations can be converted to true direct-parent coordinates.
    const captured = await captureNode(node, assets, null, progress)
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
  capturedParent: SceneNode | null,
  progress: CaptureProgress,
): Promise<CapturedNode | null> {
  progress.processedNodes += 1
  progress.currentNode = node.name
  reportCaptureProgress(progress, true)
  if (
    progress.processedNodes === 1 ||
    progress.processedNodes - progress.lastYieldedAt >= PROGRESS_YIELD_INTERVAL
  ) {
    progress.lastYieldedAt = progress.processedNodes
    await yieldToEventLoop()
  }

  let captured: CapturedNode | null
  switch (node.type) {
    case 'FRAME':
    case 'GROUP':
    case 'COMPONENT':
    case 'INSTANCE':
      captured = await captureFrame(
        node as FrameNode,
        assets,
        capturedParent,
        progress,
      )
      break
    case 'RECTANGLE':
      captured = await captureRect(node as RectangleNode, assets, capturedParent)
      break
    case 'ELLIPSE':
      captured = await captureEllipse(
        node as EllipseNode,
        assets,
        capturedParent,
      )
      break
    case 'TEXT':
      captured = await captureText(node as TextNode, assets, capturedParent)
      break
    case 'VECTOR':
    case 'STAR':
    case 'POLYGON':
    case 'BOOLEAN_OPERATION':
    case 'LINE':
      captured = await captureVector(node, assets, capturedParent)
      break
    default:
      console.warn(
        `[hyper-motion] Skipping unsupported node type: ${node.type}`,
      )
      captured = null
      break
  }

  return captured
}

// ---------------------------------------------------------------------------
// Per-kind capture
// ---------------------------------------------------------------------------

async function captureFrame(
  node: FrameNode,
  assets: Record<string, string>,
  capturedParent: SceneNode | null,
  progress: CaptureProgress,
): Promise<CapturedFrame> {
  const base = await captureBase(node, assets, capturedParent)
  // GroupNode does not expose auto-layout properties. It reaches this helper
  // through the shared container path, so normalize it (and any older/missing
  // capture) to free positioning before serializing children.
  const layoutMode =
    node.layoutMode === 'HORIZONTAL' ||
    node.layoutMode === 'VERTICAL' ||
    node.layoutMode === 'GRID'
      ? node.layoutMode
      : 'NONE'
  const children: CapturedNode[] = []
  for (const child of node.children) {
    const c = await captureNode(child, assets, node, progress)
    if (c) children.push(c)
  }
  // Cast guards: the typed Figma API returns specific union members per
  // field; widen them to our schema's value space.
  return {
    ...base,
    type: nodeTypeAsFrame(node.type),
    layoutMode,
    ...(layoutMode === 'GRID'
      ? {
          gridRowCount: node.gridRowCount,
          gridColumnCount: node.gridColumnCount,
          gridRowGap: node.gridRowGap,
          gridColumnGap: node.gridColumnGap,
        }
      : {}),
    strokesIncludedInLayout: (node as unknown as {
      strokesIncludedInLayout?: boolean
    }).strokesIncludedInLayout,
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
    clipsContent: node.clipsContent ?? false,
    children,
  }
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
  capturedParent: SceneNode | null,
): Promise<CapturedRect> {
  return {
    ...(await captureBase(node, assets, capturedParent)),
    type: 'RECTANGLE',
  }
}

async function captureEllipse(
  node: EllipseNode,
  assets: Record<string, string>,
  capturedParent: SceneNode | null,
): Promise<CapturedEllipse> {
  return {
    ...(await captureBase(node, assets, capturedParent)),
    type: 'ELLIPSE',
    arcData: {
      startingAngle: node.arcData.startingAngle,
      endingAngle: node.arcData.endingAngle,
      innerRadius: node.arcData.innerRadius,
    },
  }
}

async function captureText(
  node: TextNode,
  assets: Record<string, string>,
  capturedParent: SceneNode | null,
): Promise<CapturedText> {
  const base = await captureBase(node, assets, capturedParent)
  // Mixed text runs use the first character. Empty text has no valid range,
  // so the helper falls back to the node-level style instead.
  const { fontName, fontSize, lineHeight, letterSpacing } =
    readFirstTextStyle(node)
  return {
    ...base,
    type: 'TEXT',
    characters: node.characters,
    fontFamily: fontName?.family ?? 'Inter',
    fontWeight: weightFromStyle(fontName?.style ?? 'Regular'),
    fontStyle: /Italic/i.test(fontName?.style ?? '') ? 'italic' : 'normal',
    fontSize,
    lineHeightPx: lineHeightToPx(lineHeight, fontSize),
    letterSpacingPx: letterSpacingToPx(letterSpacing, fontSize),
    textCase: firstTextCase(node),
    textDecoration: firstTextDecoration(node),
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
  capturedParent: SceneNode | null,
  rasterReason?: string,
): Promise<CapturedVector> {
  const base = await captureBase(
    node as unknown as SceneNode & GeometryMixin,
    assets,
    capturedParent,
  )
  const geometry = node as unknown as GeometryMixin
  const vectorPaths = readVectorPaths(node)
  const fillGeometry = cloneVectorPaths(geometry.fillGeometry)
  const strokeGeometry = cloneVectorPaths(geometry.strokeGeometry)
  const primitive = captureVectorPrimitive(node)
  // Most Figma vectors expose the same shape through vectorPaths and
  // fill/stroke geometry. Reading vectorNetwork as well can be extremely
  // expensive on imported icon sets, so only request it when the cheaper
  // native representations are absent.
  const hasDirectGeometry =
    vectorPaths.length > 0 ||
    fillGeometry.length > 0 ||
    strokeGeometry.length > 0
  const vectorNetwork = hasDirectGeometry
    ? undefined
    : await readVectorNetwork(node, assets)
  const advancedStroke = readAdvancedStrokeMetadata(node)
  const hasEditableGeometry =
    vectorPaths.length > 0 ||
    fillGeometry.length > 0 ||
    strokeGeometry.length > 0 ||
    !!vectorNetwork

  // Primitive metadata describes how Figma authored the layer but is not a
  // renderable path in Hyper Motion. Unsupported native features are likewise
  // only partially representable. Export SVG for either case while retaining
  // the native data for future editing support.
  const unsupportedBeforeSvg = detectUnsupportedVectorFeatures(
    node,
    base,
    '',
    vectorNetwork,
  )
  const needsSvgFallback =
    !hasEditableGeometry || unsupportedBeforeSvg.length > 0
  let svg = ''
  let reason = rasterReason
  if (needsSvgFallback) {
    try {
      svg = await withTimeout(
        (
          node as unknown as {
            exportAsync: (s: ExportSettingsSVGString) => Promise<string>
          }
        ).exportAsync({
          format: 'SVG_STRING',
          svgOutlineText: true,
          svgIdAttribute: true,
          // Preserve inside/outside strokes with Figma's precise mask form.
          svgSimplifyStroke: false,
        }),
        VECTOR_EXPORT_TIMEOUT_MS,
        `SVG export for "${node.name}"`,
      )
      svg = sanitizeSvgForTransport(svg)
    } catch (err) {
      console.warn('[hyper-motion] SVG export failed', err)
      reason =
        reason ??
        `Figma's SVG fallback did not finish within ${VECTOR_EXPORT_TIMEOUT_MS / 1000}s. Hyper Motion will try a PNG fallback.`
    }
  }

  const unsupported = detectUnsupportedVectorFeatures(
    node,
    base,
    svg,
    vectorNetwork,
  )
  const fidelity: CapturedVector['fidelity'] = !hasEditableGeometry
    ? 'preserved'
    : unsupported.length > 0
      ? 'partial'
      : 'editable'

  // A PNG is only generated when there is no usable SVG or the layer has
  // collapsed bounds. Normal vectors now remain native/editable and avoid
  // the large raster payload paid by every v1 capture.
  let rasterPng = ''
  const requiresRaster =
    (needsSvgFallback && !svg.trim()) || base.width < 1 || base.height < 1
  if (requiresRaster) {
    try {
      const bytes = await withTimeout(
        (
          node as unknown as {
            exportAsync: (s: ExportSettingsImage) => Promise<Uint8Array>
          }
        ).exportAsync({ format: 'PNG' }),
        VECTOR_EXPORT_TIMEOUT_MS,
        `PNG export for "${node.name}"`,
      )
      rasterPng = bytesToBase64(bytes)
    } catch (err) {
      console.warn('[hyper-motion] PNG vector fallback export failed', err)
      reason =
        reason ??
        'Figma could not export this vector as a fallback image. The SVG may not match exactly.'
    }
  }
  if (!svg.trim() && needsSvgFallback) {
    reason =
      reason ??
      'Figma returned an empty SVG for this vector. Hyper Motion used a PNG fallback to preserve the visual result.'
  } else if (base.width < 1 || base.height < 1) {
    reason =
      reason ??
      'Figma reported collapsed bounds for this stroked vector. Hyper Motion used a PNG fallback to preserve the visual result.'
  }
  const viewBox = readSvgViewBox(svg) ?? {
    x: 0,
    y: 0,
    width: Math.max(1, base.width),
    height: Math.max(1, base.height),
  }
  return {
    ...base,
    type: 'VECTOR',
    sourceKind: node.type as CapturedVector['sourceKind'],
    svg,
    viewBox,
    ...(vectorPaths.length > 0 ? { vectorPaths } : {}),
    ...(vectorNetwork ? { vectorNetwork } : {}),
    ...(fillGeometry.length > 0 ? { fillGeometry } : {}),
    ...(strokeGeometry.length > 0 ? { strokeGeometry } : {}),
    ...(primitive ? { primitive } : {}),
    fidelity,
    ...(unsupported.length > 0 ? { unsupported } : {}),
    ...(advancedStroke.variableWidthStroke
      ? { variableWidthStroke: advancedStroke.variableWidthStroke }
      : {}),
    ...(advancedStroke.complexStroke
      ? { complexStroke: advancedStroke.complexStroke }
      : {}),
    ...(rasterPng ? { rasterPng } : {}),
    ...(reason ? { rasterReason: reason } : {}),
  }
}

function cloneVectorPaths(paths: VectorPaths | undefined): CapturedVectorPath[] {
  if (!paths) return []
  return Array.from(paths, (path) => ({
    windingRule: path.windingRule,
    data: path.data,
  }))
}

function readVectorPaths(node: SceneNode): CapturedVectorPath[] {
  if (node.type !== 'VECTOR') return []
  try {
    return cloneVectorPaths(node.vectorPaths)
  } catch (err) {
    console.warn('[hyper-motion] Vector path capture failed', err)
    return []
  }
}

async function readVectorNetwork(
  node: SceneNode,
  assets: Record<string, string>,
): Promise<CapturedVectorNetwork | undefined> {
  if (node.type !== 'VECTOR') return undefined
  try {
    const network = node.vectorNetwork
    const regions: CapturedVectorRegion[] = []
    for (const region of network.regions ?? []) {
      regions.push({
        windingRule: region.windingRule,
        loops: region.loops.map((loop) => Array.from(loop)),
        ...(region.fills
          ? { fills: await capturePaints(region.fills, assets) }
          : {}),
        ...(region.fillStyleId ? { fillStyleId: region.fillStyleId } : {}),
      })
    }
    return {
      vertices: network.vertices.map((vertex) => ({
        x: vertex.x,
        y: vertex.y,
        ...(vertex.strokeCap ? { strokeCap: vertex.strokeCap } : {}),
        ...(vertex.strokeJoin ? { strokeJoin: vertex.strokeJoin } : {}),
        ...(typeof vertex.cornerRadius === 'number'
          ? { cornerRadius: vertex.cornerRadius }
          : {}),
        ...(vertex.handleMirroring
          ? { handleMirroring: vertex.handleMirroring }
          : {}),
      })),
      segments: network.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        ...(segment.tangentStart
          ? { tangentStart: { ...segment.tangentStart } }
          : {}),
        ...(segment.tangentEnd
          ? { tangentEnd: { ...segment.tangentEnd } }
          : {}),
      })),
      regions,
    }
  } catch (err) {
    console.warn('[hyper-motion] Vector network capture failed', err)
    return undefined
  }
}

function captureVectorPrimitive(node: SceneNode): CapturedVectorPrimitive | undefined {
  const radius = readUniformCornerRadius(node)
  switch (node.type) {
    case 'STAR':
      return {
        kind: 'star',
        pointCount: node.pointCount,
        innerRadius: node.innerRadius,
        cornerRadius: radius,
      }
    case 'POLYGON':
      return { kind: 'polygon', pointCount: node.pointCount, cornerRadius: radius }
    case 'ELLIPSE':
      return {
        kind: 'ellipse',
        startAngle: node.arcData.startingAngle,
        endAngle: node.arcData.endingAngle,
        innerRadius: node.arcData.innerRadius,
      }
    case 'LINE':
      return { kind: 'line' }
    case 'BOOLEAN_OPERATION':
      return { kind: 'boolean', operation: node.booleanOperation }
    default:
      return undefined
  }
}

function readUniformCornerRadius(node: SceneNode): number {
  const value = (node as unknown as { cornerRadius?: number | symbol }).cornerRadius
  return typeof value === 'number' ? value : 0
}

function detectUnsupportedVectorFeatures(
  node: SceneNode,
  base: CapturedNodeBase,
  svg: string,
  vectorNetwork: CapturedVectorNetwork | undefined,
): string[] {
  const unsupported: string[] = []
  const complex = node as unknown as {
    variableWidthStrokeProperties?: unknown
    complexStrokeProperties?: unknown
  }
  if (complex.variableWidthStrokeProperties) unsupported.push('variable-width-stroke')
  const complexType = (complex.complexStrokeProperties as { type?: string } | null)?.type
  if (complexType && complexType !== 'BASIC') unsupported.push('brush-or-dynamic-stroke')
  if (
    base.strokeCap &&
    base.strokeCap !== 'MIXED' &&
    base.strokeCap !== 'NONE' &&
    base.strokeCap !== 'ROUND' &&
    base.strokeCap !== 'SQUARE'
  ) {
    unsupported.push('decorative-stroke-cap')
  }
  if (base.strokeCap === 'MIXED' || base.strokeJoin === 'MIXED') {
    unsupported.push('mixed-stroke-style')
  }
  if (base.strokeAlign !== 'CENTER' && base.strokeWeight > 0) {
    unsupported.push('non-center-stroke')
  }
  if (
    vectorNetwork?.vertices.some(
      (vertex) => vertex.strokeCap !== undefined || vertex.strokeJoin !== undefined,
    )
  ) {
    unsupported.push('per-vertex-stroke-style')
  }
  if (vectorNetwork?.vertices.some((vertex) => (vertex.cornerRadius ?? 0) > 0)) {
    unsupported.push('per-vertex-corner-radius')
  }
  const paints = [
    ...readPaintArray((node as unknown as { fills?: ReadonlyArray<Paint> | symbol }).fills),
    ...readPaintArray((node as unknown as { strokes?: ReadonlyArray<Paint> | symbol }).strokes),
  ]
  for (const paint of paints) {
    if (paint.type === 'GRADIENT_DIAMOND') unsupported.push('diamond-gradient')
    if (paint.type === 'PATTERN') unsupported.push('pattern-paint')
    if (paint.type === 'VIDEO') unsupported.push('video-paint')
    if (paint.type === 'IMAGE' && paint.filters) unsupported.push('image-filters')
  }
  if (/<(?:filter|pattern|text|image)\b/i.test(svg)) {
    unsupported.push('advanced-svg-content')
  }
  return Array.from(new Set(unsupported))
}

function readPaintArray(
  value: ReadonlyArray<Paint> | symbol | undefined,
): ReadonlyArray<Paint> {
  return Array.isArray(value) ? value : []
}

function readAdvancedStrokeMetadata(node: SceneNode): {
  variableWidthStroke?: unknown
  complexStroke?: unknown
} {
  const value = node as unknown as {
    variableWidthStrokeProperties?: unknown
    complexStrokeProperties?: { type?: string } | null
  }
  return {
    ...(value.variableWidthStrokeProperties
      ? { variableWidthStroke: value.variableWidthStrokeProperties }
      : {}),
    ...(value.complexStrokeProperties?.type &&
    value.complexStrokeProperties.type !== 'BASIC'
      ? { complexStroke: value.complexStrokeProperties }
      : {}),
  }
}

function readSvgViewBox(svg: string): CapturedVectorViewBox | undefined {
  const raw = svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  if (!raw) return undefined
  const values = raw.trim().split(/[\s,]+/).map(Number)
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return undefined
  }
  return { x: values[0], y: values[1], width: values[2], height: values[3] }
}

function sanitizeSvgForTransport(source: string): string {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\s+(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|https?:|\/\/)[\s\S]*?\1/gi, '')
}

// ---------------------------------------------------------------------------
// Base capture (geometry + paint)
// ---------------------------------------------------------------------------

async function captureBase(
  node: SceneNode,
  assets: Record<string, string>,
  capturedParent: SceneNode | null,
): Promise<CapturedNodeBase> {
  const geo = node as SceneNode & {
    fills?: ReadonlyArray<Paint> | symbol
    strokes?: ReadonlyArray<Paint>
    strokeWeight?: number | symbol
    strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
    strokeTopWeight?: number
    strokeRightWeight?: number
    strokeBottomWeight?: number
    strokeLeftWeight?: number
    dashPattern?: ReadonlyArray<number>
    cornerRadius?: number | symbol
    cornerSmoothing?: number
    topLeftRadius?: number
    topRightRadius?: number
    bottomLeftRadius?: number
    bottomRightRadius?: number
    rotation?: number
    relativeTransform?: Transform
    layoutPositioning?: 'AUTO' | 'ABSOLUTE'
    layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
    layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
    minWidth?: number | null
    maxWidth?: number | null
    minHeight?: number | null
    maxHeight?: number | null
    opacity?: number
    blendMode?: BlendMode
    effects?: ReadonlyArray<Effect> | symbol
    strokeCap?: StrokeCap | symbol
    strokeJoin?: StrokeJoin | symbol
    strokeMiterLimit?: number
    dashOffset?: number
  }
  const fills = await capturePaints(
    Array.isArray(geo.fills) ? geo.fills : [],
    assets,
  )
  const strokes = await capturePaints(geo.strokes ?? [], assets)
  const strokeWeight =
    typeof geo.strokeWeight === 'number' ? geo.strokeWeight : 0
  const strokeWidths = strokeWidthsOf(
    {
      top: geo.strokeTopWeight,
      right: geo.strokeRightWeight,
      bottom: geo.strokeBottomWeight,
      left: geo.strokeLeftWeight,
    },
    strokeWeight,
  )
  const strokeAlign = geo.strokeAlign ?? 'INSIDE'
  const strokeDashes = Array.isArray(geo.dashPattern)
    ? Array.from(geo.dashPattern)
    : []
  const effects = Array.isArray(geo.effects) ? captureEffects(geo.effects) : []
  const relativeTransform = capturedParent
    ? transformRelativeToCapturedParent(node, capturedParent)
    : geo.relativeTransform
      ? cloneTransform(geo.relativeTransform)
      : undefined
  return {
    id: node.id,
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    opacity: typeof geo.opacity === 'number' ? geo.opacity : 1,
    x: relativeTransform?.[0][2] ?? node.x,
    y: relativeTransform?.[1][2] ?? node.y,
    width: node.width,
    height: node.height,
    rotation: typeof geo.rotation === 'number' ? geo.rotation : 0,
    ...(relativeTransform
      ? { relativeTransform }
      : {}),
    layoutPositioning: geo.layoutPositioning,
    layoutSizingHorizontal: geo.layoutSizingHorizontal,
    layoutSizingVertical: geo.layoutSizingVertical,
    minWidth: geo.minWidth,
    maxWidth: geo.maxWidth,
    minHeight: geo.minHeight,
    maxHeight: geo.maxHeight,
    cornerRadius: cornerRadiiOf(geo),
    ...(typeof geo.cornerSmoothing === 'number' &&
    Number.isFinite(geo.cornerSmoothing)
      ? { cornerSmoothing: Math.min(1, Math.max(0, geo.cornerSmoothing)) }
      : {}),
    fills,
    strokes,
    strokeWeight,
    ...(strokeWidths ? { strokeWidths } : {}),
    strokeAlign,
    strokeDashes,
    ...(typeof geo.dashOffset === 'number'
      ? { strokeDashOffset: geo.dashOffset }
      : {}),
    ...(typeof geo.strokeCap === 'string'
      ? { strokeCap: geo.strokeCap as CapturedStrokeCap }
      : geo.strokeCap
        ? { strokeCap: 'MIXED' as const }
        : {}),
    ...(typeof geo.strokeJoin === 'string'
      ? { strokeJoin: geo.strokeJoin as CapturedStrokeJoin }
      : geo.strokeJoin
        ? { strokeJoin: 'MIXED' as const }
        : {}),
    ...(typeof geo.strokeMiterLimit === 'number'
      ? { strokeMiterLimit: geo.strokeMiterLimit }
      : {}),
    blendMode: (geo.blendMode as CapturedBlendMode | undefined) ?? 'NORMAL',
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
  widths: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  },
  uniformWeight: number,
): { top: number; right: number; bottom: number; left: number } | undefined {
  if (
    typeof widths.top !== 'number' ||
    typeof widths.right !== 'number' ||
    typeof widths.bottom !== 'number' ||
    typeof widths.left !== 'number'
  ) {
    return undefined
  }
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
      blendMode: (paint.blendMode as CapturedBlendMode | undefined) ?? 'NORMAL',
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
      gradientTransform: cloneTransform(paint.gradientTransform),
      gradientStops: paint.gradientStops.map((s) => ({
        position: s.position,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
      })),
      opacity: paint.opacity ?? 1,
      visible,
      blendMode: (paint.blendMode as CapturedBlendMode | undefined) ?? 'NORMAL',
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
          const bytes = await withTimeout(
            image.getBytesAsync(),
            IMAGE_BYTES_TIMEOUT_MS,
            `Image read for ${paint.imageHash}`,
          )
          assets[paint.imageHash] = bytesToDataUrl(bytes)
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
      blendMode: (paint.blendMode as CapturedBlendMode | undefined) ?? 'NORMAL',
      ...(paint.imageTransform
        ? { imageTransform: cloneTransform(paint.imageTransform) }
        : {}),
      ...(typeof paint.scalingFactor === 'number'
        ? { scalingFactor: paint.scalingFactor }
        : {}),
      ...(typeof paint.rotation === 'number' ? { rotation: paint.rotation } : {}),
      ...(paint.filters ? { filters: { ...paint.filters } } : {}),
    }
  }
  return null
}

function cloneTransform(transform: Transform): CapturedTransform {
  return [
    [transform[0][0], transform[0][1], transform[0][2]],
    [transform[1][0], transform[1][1], transform[1][2]],
  ]
}

/**
 * Figma's `relativeTransform` skips groups and boolean-operation parents: it
 * is relative to the nearest container. Hyper Motion persists every captured
 * parent, so descendants need a true direct-parent matrix or nested vectors
 * are translated twice after import.
 */
function transformRelativeToCapturedParent(
  node: SceneNode,
  capturedParent: SceneNode,
): CapturedTransform {
  const childAbsolute = cloneTransform(node.absoluteTransform)
  const parentAbsolute = cloneTransform(capturedParent.absoluteTransform)
  const inverseParent = invertTransform(parentAbsolute)
  if (!inverseParent) {
    return cloneTransform(node.relativeTransform)
  }
  return multiplyTransforms(inverseParent, childAbsolute)
}

function invertTransform(transform: CapturedTransform): CapturedTransform | null {
  const [[a, c, e], [b, d, f]] = transform
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 1e-12) return null
  return [
    [d / determinant, -c / determinant, (c * f - d * e) / determinant],
    [-b / determinant, a / determinant, (b * e - a * f) / determinant],
  ]
}

function multiplyTransforms(
  left: CapturedTransform,
  right: CapturedTransform,
): CapturedTransform {
  const [[la, lc, le], [lb, ld, lf]] = left
  const [[ra, rc, re], [rb, rd, rf]] = right
  return [
    [
      normalizedTransformValue(la * ra + lc * rb),
      normalizedTransformValue(la * rc + lc * rd),
      normalizedTransformValue(la * re + lc * rf + le),
    ],
    [
      normalizedTransformValue(lb * ra + ld * rb),
      normalizedTransformValue(lb * rc + ld * rd),
      normalizedTransformValue(lb * re + ld * rf + lf),
    ],
  ]
}

function normalizedTransformValue(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

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

function firstTextCase(node: TextNode): CapturedText['textCase'] {
  const value =
    node.characters.length > 0 ? node.getRangeTextCase(0, 1) : node.textCase
  return typeof value === 'string' ? value : 'ORIGINAL'
}

function firstTextDecoration(
  node: TextNode,
): CapturedText['textDecoration'] {
  const value =
    node.characters.length > 0
      ? node.getRangeTextDecoration(0, 1)
      : node.textDecoration
  return typeof value === 'string' ? value : 'NONE'
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

function bytesToDataUrl(bytes: Uint8Array): string {
  return `data:${sniffImageMime(bytes)};base64,${bytesToBase64(bytes)}`
}

function sniffImageMime(bytes: Uint8Array): string {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif'
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return 'image/png'
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
