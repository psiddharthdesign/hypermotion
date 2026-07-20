// SPDX-License-Identifier: Apache-2.0

import type {
  GradientStop,
  VectorDocument,
  VectorGeometry,
  VectorItem,
  VectorMatrix,
  VectorPaint,
  VectorStroke,
  VectorViewBox,
} from '@/scene/types'
import { createVectorItem } from './model'
import { parseSvgPathData, VectorPathBuilder } from './path'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_SVG_BYTES = 5 * 1024 * 1024
const MAX_SVG_ELEMENTS = 100_000

const SAFE_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'mask', 'pattern', 'image', 'title', 'desc', 'metadata', 'marker',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
  'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology',
  'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile',
  'feTurbulence',
].map((name) => name.toLowerCase()))

const DROP_WITH_CONTENT = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video',
  'canvas', 'style', 'animate', 'animatemotion', 'animatetransform', 'set',
])

const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src'])
const URL_VALUE_ATTRIBUTES = new Set([
  'fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid',
  'marker-end', 'style',
])

export interface SanitizeSvgOptions {
  /** Prefixes defs IDs and all local references, preventing collisions on canvas. */
  idNamespace?: string
  maxBytes?: number
  maxElements?: number
}

export interface SanitizedSvg {
  svg: string
  warnings: string[]
}

export interface ParsedSvgDocument {
  vector: VectorDocument
  viewBox: VectorViewBox
  width: number
  height: number
  sanitizedSvg: string
  warnings: string[]
  unsupportedFeatures: string[]
}

/**
 * Parse SVG as inert XML and remove every active/external capability before it
 * can reach a renderer. This never inserts markup into the live document.
 */
export function sanitizeSvgSource(
  source: string,
  options: SanitizeSvgOptions = {},
): SanitizedSvg {
  if (new TextEncoder().encode(source).byteLength > (options.maxBytes ?? MAX_SVG_BYTES)) {
    throw new Error('SVG exceeds the safe import size limit')
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error('SVG document types and entities are not allowed')
  }
  const document = parseXml(source)
  const root = document.documentElement
  if (root.namespaceURI !== SVG_NS || root.localName.toLowerCase() !== 'svg') {
    throw new Error('Imported XML is not an SVG document')
  }
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  if (elements.length > (options.maxElements ?? MAX_SVG_ELEMENTS)) {
    throw new Error('SVG contains too many elements')
  }

  const warnings = new Set<string>()
  for (const element of [...elements].reverse()) {
    const name = element.localName.toLowerCase()
    if (DROP_WITH_CONTENT.has(name)) {
      warnings.add(`Removed unsafe <${element.localName}> element`)
      element.remove()
      continue
    }
    if (!SAFE_ELEMENTS.has(name)) {
      warnings.add(`Removed unsupported <${element.localName}> wrapper`)
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (attributeName.startsWith('on')) {
        element.removeAttribute(attribute.name)
        warnings.add(`Removed event attribute ${attribute.name}`)
        continue
      }
      if (attributeName === 'style' && !isSafeStyle(value)) {
        element.removeAttribute(attribute.name)
        warnings.add('Removed unsafe inline style')
        continue
      }
      if (URL_ATTRIBUTES.has(attributeName) && !isSafeHref(value)) {
        element.removeAttribute(attribute.name)
        warnings.add(`Removed external ${attribute.name}`)
        continue
      }
      if (
        (URL_VALUE_ATTRIBUTES.has(attributeName) || /url\s*\(/i.test(value)) &&
        !hasOnlyLocalUrls(value)
      ) {
        element.removeAttribute(attribute.name)
        warnings.add(`Removed external URL from ${attribute.name}`)
      }
    }
  }

  if (options.idNamespace) namespaceIds(root, safeNamespace(options.idNamespace))
  // XMLSerializer is guaranteed by the app's browser/Electron renderer.
  return { svg: new XMLSerializer().serializeToString(root), warnings: [...warnings] }
}

/** Convert supported SVG shapes into the canonical editable vector model. */
export function parseSvgDocument(
  source: string,
  options: SanitizeSvgOptions = {},
): ParsedSvgDocument {
  const sanitized = sanitizeSvgSource(source, options)
  const document = parseXml(sanitized.svg)
  const root = document.documentElement
  const viewBox = readViewBox(root)
  const width = readLength(root.getAttribute('width'), viewBox.width)
  const height = readLength(root.getAttribute('height'), viewBox.height)
  const warnings = new Set(sanitized.warnings)
  const unsupported = new Set<string>()
  const items: VectorItem[] = []
  const shapeElements = root.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')

  for (const [index, element] of Array.from(shapeElements).entries()) {
    if (element.closest('defs,clipPath,mask,symbol,marker')) continue
    if (inheritedAttribute(element, 'display') === 'none') continue
    const id = element.getAttribute('id') || `svg-item-${index + 1}`
    let geometry: VectorGeometry
    try {
      geometry = geometryForElement(element, id)
    } catch (error) {
      warnings.add(`Could not normalize ${element.localName}#${id}: ${errorMessage(error)}`)
      unsupported.add(element.localName)
      continue
    }
    if (geometry.contours.length === 0) continue
    const fills = readFills(element, document, `${id}-fill`, warnings)
    const strokes = readStrokes(element, document, `${id}-stroke`, warnings)
    items.push(createVectorItem({
      id,
      name: element.getAttribute('data-name') ?? undefined,
      geometry,
      fills,
      strokes,
      transform: accumulatedTransform(element, root),
      opacity: clamp01(readNumber(inheritedAttribute(element, 'opacity'), 1)),
      blendMode: 'normal',
      visible: inheritedAttribute(element, 'visibility') !== 'hidden',
    }))
  }

  for (const feature of ['filter', 'mask', 'clipPath', 'pattern', 'image', 'use', 'text']) {
    if (root.querySelector(feature)) unsupported.add(feature)
  }
  return {
    vector: { version: 1, items },
    viewBox,
    width: width > 0 ? width : viewBox.width,
    height: height > 0 ? height : viewBox.height,
    sanitizedSvg: sanitized.svg,
    warnings: [...warnings],
    unsupportedFeatures: [...unsupported],
  }
}

function geometryForElement(element: Element, id: string): VectorGeometry {
  const tag = element.localName.toLowerCase()
  const fillRule = inheritedAttribute(element, 'fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero'
  if (tag === 'path') {
    return parseSvgPathData(element.getAttribute('d') ?? '', { idPrefix: id, fillRule })
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const rx = tag === 'circle'
      ? readNumber(element.getAttribute('r'), 0)
      : readNumber(element.getAttribute('rx'), 0)
    const ry = tag === 'circle'
      ? rx
      : readNumber(element.getAttribute('ry'), 0)
    return ellipseGeometry(
      id,
      readNumber(element.getAttribute('cx'), 0),
      readNumber(element.getAttribute('cy'), 0),
      rx,
      ry,
      fillRule,
    )
  }
  if (tag === 'line') {
    return new VectorPathBuilder(id)
      .moveTo(readNumber(element.getAttribute('x1'), 0), readNumber(element.getAttribute('y1'), 0))
      .lineTo(readNumber(element.getAttribute('x2'), 0), readNumber(element.getAttribute('y2'), 0))
      .build()
  }
  if (tag === 'polyline' || tag === 'polygon') {
    const numbers = parseNumberList(element.getAttribute('points') ?? '')
    const builder = new VectorPathBuilder(id, fillRule)
    for (let pointIndex = 0; pointIndex + 1 < numbers.length; pointIndex += 2) {
      if (pointIndex === 0) builder.moveTo(numbers[pointIndex]!, numbers[pointIndex + 1]!)
      else builder.lineTo(numbers[pointIndex]!, numbers[pointIndex + 1]!)
    }
    if (tag === 'polygon') builder.closePath()
    return builder.build()
  }
  if (tag === 'rect') return rectGeometry(element, id, fillRule)
  return { points: {}, segments: {}, contours: [] }
}

function ellipseGeometry(
  id: string,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  fillRule: 'nonzero' | 'evenodd',
): VectorGeometry {
  const rx = Math.max(0, radiusX)
  const ry = Math.max(0, radiusY)
  const k = 0.5522847498307936
  return new VectorPathBuilder(id, fillRule)
    .moveTo(cx + rx, cy)
    .cubicTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry)
    .cubicTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy)
    .cubicTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry)
    .cubicTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy)
    .closePath()
    .build()
}

function rectGeometry(
  element: Element,
  id: string,
  fillRule: 'nonzero' | 'evenodd',
): VectorGeometry {
  const x = readNumber(element.getAttribute('x'), 0)
  const y = readNumber(element.getAttribute('y'), 0)
  const width = Math.max(0, readNumber(element.getAttribute('width'), 0))
  const height = Math.max(0, readNumber(element.getAttribute('height'), 0))
  let rx = Math.max(0, readNumber(element.getAttribute('rx'), 0))
  let ry = Math.max(0, readNumber(element.getAttribute('ry'), rx))
  rx = Math.min(rx, width / 2)
  ry = Math.min(ry, height / 2)
  if (rx === 0 || ry === 0) {
    return new VectorPathBuilder(id, fillRule)
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineTo(x + width, y + height)
      .lineTo(x, y + height)
      .closePath()
      .build()
  }
  const k = 0.5522847498307936
  return new VectorPathBuilder(id, fillRule)
    .moveTo(x + rx, y)
    .lineTo(x + width - rx, y)
    .cubicTo(x + width - rx + rx * k, y, x + width, y + ry - ry * k, x + width, y + ry)
    .lineTo(x + width, y + height - ry)
    .cubicTo(x + width, y + height - ry + ry * k, x + width - rx + rx * k, y + height, x + width - rx, y + height)
    .lineTo(x + rx, y + height)
    .cubicTo(x + rx - rx * k, y + height, x, y + height - ry + ry * k, x, y + height - ry)
    .lineTo(x, y + ry)
    .cubicTo(x, y + ry - ry * k, x + rx - rx * k, y, x + rx, y)
    .closePath()
    .build()
}

function readFills(
  element: Element,
  document: Document,
  id: string,
  warnings: Set<string>,
): VectorPaint[] {
  const value = inheritedAttribute(element, 'fill') ?? '#000000'
  const paint = readPaint(value, element, document, id, warnings)
  if (!paint) return []
  paint.opacity *= clamp01(readNumber(inheritedAttribute(element, 'fill-opacity'), 1))
  return [paint]
}

function readStrokes(
  element: Element,
  document: Document,
  id: string,
  warnings: Set<string>,
): VectorStroke[] {
  const value = inheritedAttribute(element, 'stroke') ?? 'none'
  const paint = readPaint(value, element, document, `${id}-paint`, warnings)
  if (!paint) return []
  return [{
    id,
    paint,
    width: Math.max(0, readNumber(inheritedAttribute(element, 'stroke-width'), 1)),
    align: 'center',
    cap: parseCap(inheritedAttribute(element, 'stroke-linecap')),
    join: parseJoin(inheritedAttribute(element, 'stroke-linejoin')),
    miterLimit: Math.max(0, readNumber(inheritedAttribute(element, 'stroke-miterlimit'), 4)),
    dash: parseNumberList(inheritedAttribute(element, 'stroke-dasharray') ?? ''),
    dashOffset: readNumber(inheritedAttribute(element, 'stroke-dashoffset'), 0),
    opacity: clamp01(readNumber(inheritedAttribute(element, 'stroke-opacity'), 1)),
    visible: true,
  }]
}

function readPaint(
  raw: string,
  element: Element,
  document: Document,
  id: string,
  warnings: Set<string>,
): VectorPaint | null {
  const value = raw.trim()
  if (!value || value === 'none') return null
  const reference = value.match(/^url\(\s*['"]?#([^'"\s)]+)['"]?\s*\)$/i)?.[1]
  if (!reference) {
    return { id, kind: 'solid', color: value === 'currentColor' ? inheritedAttribute(element, 'color') ?? '#000000' : value, visible: true, opacity: 1, blendMode: 'normal' }
  }
  const gradient = document.getElementById(reference)
  if (!gradient) {
    warnings.add(`Missing paint definition #${reference}`)
    return null
  }
  const stops = readGradientStops(gradient)
  const transform = parseTransform(gradient.getAttribute('gradientTransform'))
  const coordinateSpace = gradient.getAttribute('gradientUnits') === 'userSpaceOnUse'
    ? 'userSpaceOnUse'
    : 'objectBoundingBox'
  const spread = readGradientSpread(gradient.getAttribute('spreadMethod'))
  if (gradient.localName.toLowerCase() === 'lineargradient') {
    return {
      id,
      kind: 'linear',
      stops,
      start: {
        x: readCoordinate(gradient.getAttribute('x1'), 0),
        y: readCoordinate(gradient.getAttribute('y1'), 0),
      },
      end: {
        x: readCoordinate(gradient.getAttribute('x2'), 1),
        y: readCoordinate(gradient.getAttribute('y2'), 0),
      },
      transform,
      coordinateSpace,
      spread,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
    }
  }
  if (gradient.localName.toLowerCase() === 'radialgradient') {
    const radius = readCoordinate(gradient.getAttribute('r'), 0.5)
    return {
      id,
      kind: 'radial',
      stops,
      center: {
        x: readCoordinate(gradient.getAttribute('cx'), 0.5),
        y: readCoordinate(gradient.getAttribute('cy'), 0.5),
      },
      radiusX: radius,
      radiusY: radius,
      rotation: 0,
      transform,
      coordinateSpace,
      spread,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
    }
  }
  warnings.add(`Unsupported paint definition #${reference}`)
  return null
}

function readGradientStops(gradient: Element): GradientStop[] {
  return Array.from(gradient.querySelectorAll('stop')).map((stop) => {
    const style = styleMap(stop.getAttribute('style'))
    const opacity = clamp01(readNumber(stop.getAttribute('stop-opacity') ?? style['stop-opacity'], 1))
    const color = stop.getAttribute('stop-color') ?? style['stop-color'] ?? '#000000'
    return { at: clamp01(readCoordinate(stop.getAttribute('offset'), 0)), color: applyOpacity(color, opacity) }
  })
}

function accumulatedTransform(element: Element, root: Element): VectorMatrix {
  const chain: Element[] = []
  let cursor: Element | null = element
  while (cursor) {
    chain.push(cursor)
    if (cursor === root) break
    cursor = cursor.parentElement
  }
  return chain.reverse().reduce<VectorMatrix>(
    (result, current) => multiplyMatrices(result, parseTransform(current.getAttribute('transform'))),
    [1, 0, 0, 1, 0, 0],
  )
}

export function parseTransform(raw: string | null): VectorMatrix {
  if (!raw) return [1, 0, 0, 1, 0, 0]
  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let result: VectorMatrix = [1, 0, 0, 1, 0, 0]
  for (const match of raw.matchAll(expression)) {
    const values = parseNumberList(match[2] ?? '')
    let next: VectorMatrix = [1, 0, 0, 1, 0, 0]
    switch ((match[1] ?? '').toLowerCase()) {
      case 'matrix':
        if (values.length >= 6) next = values.slice(0, 6) as VectorMatrix
        break
      case 'translate':
        next = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0]
        break
      case 'scale':
        next = [values[0] ?? 1, 0, 0, values[1] ?? values[0] ?? 1, 0, 0]
        break
      case 'rotate': {
        const radians = ((values[0] ?? 0) * Math.PI) / 180
        const rotation: VectorMatrix = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]
        if (values.length >= 3) {
          const x = values[1] ?? 0
          const y = values[2] ?? 0
          next = multiplyMatrices(multiplyMatrices([1, 0, 0, 1, x, y], rotation), [1, 0, 0, 1, -x, -y])
        } else next = rotation
        break
      }
      case 'skewx':
        next = [1, 0, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
        break
      case 'skewy':
        next = [1, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
        break
    }
    result = multiplyMatrices(result, next)
  }
  return result
}

export function multiplyMatrices(left: VectorMatrix, right: VectorMatrix): VectorMatrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function parseXml(source: string): Document {
  if (typeof DOMParser === 'undefined') {
    throw new Error('SVG parsing requires a browser DOMParser')
  }
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (document.querySelector('parsererror')) throw new Error('SVG contains malformed XML')
  return document
}

function namespaceIds(root: Element, namespace: string): void {
  const mapping = new Map<string, string>()
  for (const element of [root, ...Array.from(root.querySelectorAll('[id]'))]) {
    const id = element.getAttribute('id')
    if (id) mapping.set(id, `${namespace}-${id}`)
  }
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const id = element.getAttribute('id')
    if (id && mapping.has(id)) element.setAttribute('id', mapping.get(id)!)
    for (const attribute of Array.from(element.attributes)) {
      const value = namespaceSvgLocalReferences(attribute.value, mapping)
      if (value !== attribute.value) element.setAttribute(attribute.name, value)
    }
  }
}

/**
 * Rewrite fragment references in one pass. The previous implementation walked
 * every known id for every attribute, making a definition-heavy Figma SVG
 * O(elements × ids) and capable of freezing the import UI near the safety cap.
 */
export function namespaceSvgLocalReferences(
  value: string,
  mapping: ReadonlyMap<string, string>,
): string {
  if (value.startsWith('#')) {
    const replacement = mapping.get(value.slice(1))
    if (replacement) return `#${replacement}`
  }
  return value.replace(
    /url\(\s*(['"]?)#([^'"\s)]+)\1\s*\)/gi,
    (match, _quote: string, id: string) => {
      const replacement = mapping.get(id)
      return replacement ? `url(#${replacement})` : match
    },
  )
}

function readViewBox(root: Element): VectorViewBox {
  const numbers = parseNumberList(root.getAttribute('viewBox') ?? '')
  if (numbers.length >= 4 && (numbers[2] ?? 0) > 0 && (numbers[3] ?? 0) > 0) {
    return { x: numbers[0]!, y: numbers[1]!, width: numbers[2]!, height: numbers[3]! }
  }
  const width = Math.max(1, readLength(root.getAttribute('width'), 100))
  const height = Math.max(1, readLength(root.getAttribute('height'), 100))
  return { x: 0, y: 0, width, height }
}

function inheritedAttribute(element: Element, name: string): string | null {
  let cursor: Element | null = element
  while (cursor) {
    const direct = cursor.getAttribute(name)
    if (direct !== null) return direct
    const styled = styleMap(cursor.getAttribute('style'))[name]
    if (styled !== undefined) return styled
    cursor = cursor.parentElement
  }
  return null
}

function styleMap(raw: string | null): Record<string, string> {
  if (!raw) return {}
  const result: Record<string, string> = {}
  for (const declaration of raw.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator < 0) continue
    result[declaration.slice(0, separator).trim().toLowerCase()] = declaration.slice(separator + 1).trim()
  }
  return result
}

function isSafeStyle(value: string): boolean {
  return !/(?:javascript\s*:|expression\s*\(|@import|behavior\s*:|-moz-binding)/i.test(value) && hasOnlyLocalUrls(value)
}

function hasOnlyLocalUrls(value: string): boolean {
  for (const match of value.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) {
    if (!(match[1] ?? '').startsWith('#')) return false
  }
  return true
}

function isSafeHref(value: string): boolean {
  return value.startsWith('#') || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)
}

function safeNamespace(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+/, '') || 'hm-svg'
}

function readLength(value: string | null, fallback: number): number {
  if (!value) return fallback
  const match = value.trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)\s*(?:px)?$/i)
  return match ? readNumber(match[1], fallback) : fallback
}

function readCoordinate(value: string | null, fallback: number): number {
  if (!value) return fallback
  if (value.trim().endsWith('%')) return readNumber(value, fallback * 100) / 100
  return readNumber(value, fallback)
}

function readNumber(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseNumberList(value: string): number[] {
  return (value.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [])
    .map(Number)
    .filter(Number.isFinite)
}

function parseCap(value: string | null): VectorStroke['cap'] {
  return value === 'round' || value === 'square' ? value : 'butt'
}

function parseJoin(value: string | null): VectorStroke['join'] {
  return value === 'round' || value === 'bevel' ? value : 'miter'
}

function readGradientSpread(value: string | null): 'pad' | 'reflect' | 'repeat' {
  return value === 'reflect' || value === 'repeat' ? value : 'pad'
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function applyOpacity(color: string, opacity: number): string {
  if (opacity >= 1) return color
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return color
  return `#${hex}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
