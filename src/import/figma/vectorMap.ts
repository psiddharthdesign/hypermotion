// SPDX-License-Identifier: Apache-2.0

import type {
  BlendMode,
  VectorContour,
  VectorDocument,
  VectorGeometry,
  VectorItem,
  VectorPoint,
  VectorRegion,
  VectorSegment,
  VectorViewBox,
} from '@/scene'
import { parseSvgPathData, sanitizeSvgSource } from '@/scene/vector'
import { figmaToVectorPaints, figmaToVectorStrokes } from './fillMap'
import { figmaVectorItemTransform } from './layoutMap'
import type {
  FigmaCapturedVector,
  FigmaCapturedVectorNetwork,
  FigmaCapturedVectorPath,
  FigmaPayloadVersion,
} from './types'

export interface MappedFigmaVector {
  viewBox: VectorViewBox
  vector: VectorDocument
  sanitizedSvg: string
  fidelity: 'editable' | 'preserved' | 'raster-fallback'
  unsupported: string[]
}

/** Convert a payload-v2 Figma vector into Hyper Motion's native graph. */
export function figmaToVectorDocument(
  node: FigmaCapturedVector,
  assets: Record<string, string>,
  payloadVersion: FigmaPayloadVersion,
): MappedFigmaVector | null {
  const sanitizedSvg = sanitizeFigmaSvg(node.svg, `figma-${node.id}`)
  const viewBox = node.viewBox ?? readSvgViewBox(sanitizedSvg) ?? {
    x: 0,
    y: 0,
    width: Math.max(1, node.width),
    height: Math.max(1, node.height),
  }

  let geometry: VectorGeometry | null = null
  if (payloadVersion >= 2 && node.vectorNetwork) {
    geometry = geometryFromNetwork(node.vectorNetwork)
  }
  if (!geometry || Object.keys(geometry.segments).length === 0) {
    const paths =
      node.vectorPaths?.length
        ? node.vectorPaths
        : node.fillGeometry?.length
          ? node.fillGeometry
          : node.strokeGeometry ?? []
    geometry = geometryFromPaths(paths)
  }

  const unsupported = [...(node.unsupported ?? [])]
  if (!geometry || Object.keys(geometry.segments).length === 0) {
    if (!sanitizedSvg) return null
    // Returning an empty VectorDocument would render blank because all vector
    // renderers consume canonical items. Signal the walker to use the safe
    // inline-SVG image path instead, retaining visual fidelity.
    return null
  }

  const fills = figmaToVectorPaints(
    node.fills,
    assets,
    viewBox.width,
    viewBox.height,
  )
  if (node.vectorNetwork?.regions && geometry.regions) {
    node.vectorNetwork.regions.forEach((region, regionIndex) => {
      if (!region.fills?.length) return
      const regionPaints = figmaToVectorPaints(
        region.fills,
        assets,
        viewBox.width,
        viewBox.height,
        `region-${regionIndex}-fill`,
      )
      fills.push(...regionPaints)
      const mappedRegion = geometry.regions?.[regionIndex]
      if (mappedRegion && regionPaints.length > 0) {
        mappedRegion.fillIds = regionPaints.map((paint) => paint.id)
      }
    })
  }
  const strokes = figmaToVectorStrokes(
    node.strokes,
    assets,
    viewBox.width,
    viewBox.height,
    {
      width: node.strokeWeight,
      align: node.strokeAlign,
      dashes: node.strokeDashes,
      dashOffset: node.strokeDashOffset,
      cap: node.strokeCap,
      join: node.strokeJoin,
      miterLimit: node.strokeMiterLimit,
    },
  )

  const item: VectorItem = {
    id: stableId(node.id, 'item'),
    name: node.name,
    transform: figmaVectorItemTransform(node),
    geometry,
    fills,
    strokes,
    opacity: 1,
    blendMode: figmaBlendMode(node.blendMode),
    visible: node.visible,
  }
  return {
    viewBox,
    vector: { version: 1, items: [item] },
    sanitizedSvg,
    fidelity:
      node.fidelity === 'preserved' ||
      node.fidelity === 'partial' ||
      unsupported.length > 0
        ? 'preserved'
        : 'editable',
    unsupported: unique(unsupported),
  }
}

export function sanitizeFigmaSvg(source: string, idNamespace?: string): string {
  if (!source) return ''
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    try {
      return sanitizeSvgSource(source, { idNamespace }).svg
    } catch (error) {
      console.warn('[figma-import] Rejected unsafe or malformed SVG fallback', error)
      return ''
    }
  }
  // Import tests run without a browser DOM. The Figma plugin already applies
  // the same transport restrictions; this fallback keeps v1 payload tests pure.
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(
      /\s+(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|https?:|\/\/)[\s\S]*?\1/gi,
      '',
    )
    .trim()
}

function geometryFromNetwork(network: FigmaCapturedVectorNetwork): VectorGeometry {
  const points: Record<string, VectorPoint> = {}
  network.vertices.forEach((vertex, index) => {
    const id = `point-${index}`
    points[id] = {
      id,
      x: vertex.x,
      y: vertex.y,
      ...(typeof vertex.cornerRadius === 'number'
        ? { cornerRadius: vertex.cornerRadius }
        : {}),
      ...(vertex.handleMirroring
        ? { handleMode: handleMode(vertex.handleMirroring) }
        : {}),
    }
  })

  const segments: Record<string, VectorSegment> = {}
  network.segments.forEach((segment, index) => {
    const start = network.vertices[segment.start]
    const end = network.vertices[segment.end]
    if (!start || !end) return
    const id = `segment-${index}`
    const tangentStart = segment.tangentStart ?? { x: 0, y: 0 }
    const tangentEnd = segment.tangentEnd ?? { x: 0, y: 0 }
    const isCubic =
      tangentStart.x !== 0 ||
      tangentStart.y !== 0 ||
      tangentEnd.x !== 0 ||
      tangentEnd.y !== 0
    segments[id] = {
      id,
      startPointId: `point-${segment.start}`,
      endPointId: `point-${segment.end}`,
      kind: isCubic ? 'cubic' : 'line',
      ...(isCubic
        ? {
            controlStart: {
              x: start.x + tangentStart.x,
              y: start.y + tangentStart.y,
            },
            controlEnd: {
              x: end.x + tangentEnd.x,
              y: end.y + tangentEnd.y,
            },
          }
        : {}),
    }
  })

  const contours: VectorContour[] = []
  const regions: VectorRegion[] = []
  const used = new Set<number>()
  network.regions.forEach((region, regionIndex) => {
    const contourIds: string[] = []
    region.loops.forEach((loop, loopIndex) => {
      const segmentIds = loop
        .filter((index) => !!segments[`segment-${index}`])
        .map((index) => {
          used.add(index)
          return `segment-${index}`
        })
      if (segmentIds.length === 0) return
      const id = `region-${regionIndex}-contour-${loopIndex}`
      contourIds.push(id)
      contours.push({
        id,
        segmentIds,
        closed: true,
        fillRule: region.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero',
      })
    })
    if (contourIds.length > 0) {
      regions.push({
        id: `region-${regionIndex}`,
        contourIds,
        fillRule: region.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero',
      })
    }
  })

  // Open/unfilled network edges are still real stroke geometry. Keep them as
  // individual contours rather than dropping them when no region references them.
  network.segments.forEach((_segment, index) => {
    if (used.has(index) || !segments[`segment-${index}`]) return
    contours.push({
      id: `open-contour-${index}`,
      segmentIds: [`segment-${index}`],
      closed: false,
      fillRule: 'nonzero',
    })
  })
  return { points, segments, contours, ...(regions.length ? { regions } : {}) }
}

function geometryFromPaths(paths: FigmaCapturedVectorPath[]): VectorGeometry {
  const geometry: VectorGeometry = { points: {}, segments: {}, contours: [] }
  const regions: VectorRegion[] = []
  paths.forEach((path, pathIndex) => {
    try {
      const parsed = parseSvgPathData(path.data, {
        idPrefix: `figma-path-${pathIndex}`,
        fillRule: path.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero',
      })
      Object.assign(geometry.points, parsed.points)
      Object.assign(geometry.segments, parsed.segments)
      geometry.contours.push(...parsed.contours)
      if (path.windingRule !== 'NONE' && parsed.contours.length > 0) {
        regions.push({
          id: `figma-path-${pathIndex}-region`,
          contourIds: parsed.contours.map((contour) => contour.id),
          fillRule: path.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero',
        })
      }
    } catch (error) {
      console.warn('[figma-import] Could not parse editable vector path', error)
    }
  })
  if (regions.length > 0) geometry.regions = regions
  return geometry
}

function readSvgViewBox(svg: string): VectorViewBox | null {
  const raw = svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
  if (!raw) return null
  const values = raw.trim().split(/[\s,]+/).map(Number)
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null
  return { x: values[0], y: values[1], width: values[2], height: values[3] }
}

function handleMode(
  mode: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH',
): VectorPoint['handleMode'] {
  if (mode === 'ANGLE_AND_LENGTH') return 'mirrored'
  if (mode === 'ANGLE') return 'aligned'
  return 'independent'
}

function figmaBlendMode(mode: FigmaCapturedVector['blendMode']): BlendMode {
  if (!mode || mode === 'PASS_THROUGH') return 'normal'
  if (mode === 'LINEAR_BURN') return 'color-burn'
  if (mode === 'LINEAR_DODGE') return 'color-dodge'
  return mode.toLowerCase().replace(/_/g, '-') as BlendMode
}

function stableId(source: string, suffix: string): string {
  return `${source.replace(/[^a-zA-Z0-9_-]/g, '-')}-${suffix}`
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
