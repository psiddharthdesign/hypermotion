// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type {
  Node,
  NodeId,
  VectorDocument,
  VectorItem,
  VectorStroke,
} from '@/scene/types'
import {
  createVectorItem,
  defaultVectorStroke,
  solidVectorPaint,
} from '@/scene/vector/model'
import { parseSvgPathData } from '@/scene/vector/path'
import {
  CURSOR_ASSET_PAYLOAD_VERSION,
  CURSOR_ASSETS,
  CURSOR_COMPONENT_SIZE,
  CURSOR_MOTION_HOTSPOT,
  CURSOR_STATES,
  type CursorState,
} from './cursorAssets'

export const CURSOR_COMPONENT_ID = 'hypermotion.builtin.cursor.v1'

const EMPTY_LAYOUT = {
  mode: 'none' as const,
  direction: 'row' as const,
  justify: 'start' as const,
  align: 'start' as const,
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  wrap: false,
  columns: 1,
  rowGap: 0,
  columnGap: 0,
}

const TRANSPARENT_APPEARANCE = {
  opacity: 1,
  fill: null,
  stroke: null,
  cornerRadius: 0,
  blendMode: 'normal' as const,
  effects: [],
}

/**
 * Return the existing healthy built-in cursor master, even if the user has
 * renamed it. Identity is stored on the vector children so no scene schema
 * extension is required.
 */
export function findCursorComponent(api: SceneAPI): NodeId | null {
  for (const id of api.getAllNodeIds()) {
    const node = api.getNode(id)
    if (
      !node ||
      node.kind !== 'component' ||
      node.parent !== null ||
      !node.workspaceOnly
    ) {
      continue
    }
    const states = new Set<CursorState>()
    for (const child of api.getChildren(node.id)) {
      if (child.kind !== 'vector') continue
      const metadata = child.source?.metadata
      if (metadata?.builtInId !== CURSOR_COMPONENT_ID) continue
      const state = metadata.state
      if (isCursorState(state)) states.add(state)
    }
    if (CURSOR_STATES.every((state) => states.has(state))) return node.id
  }
  return null
}

/**
 * Identify a built-in cursor instance by its component structure, not its
 * editable layer name. This keeps cursor-only editor affordances working after
 * the user renames either the instance or the hidden component master.
 */
export function isCursorInstance(
  api: SceneAPI,
  candidate: Node | NodeId | null | undefined,
): boolean {
  const node =
    typeof candidate === 'string' ? api.getNode(candidate) : candidate
  if (!node || node.kind !== 'instance') return false
  const componentId = findCursorComponent(api)
  return componentId !== null && node.componentId === componentId
}

/**
 * Build an in-scene, workspace-only component master with one vector child per
 * state. Instances use normal component materialization, so every renderer and
 * exporter sees ordinary VectorNodes without a cursor-specific rendering path.
 */
export function createCursorComponent(api: SceneAPI): NodeId {
  const vectors = new Map<CursorState, VectorDocument>()
  for (const state of CURSOR_STATES) {
    vectors.set(
      state,
      cursorVectorDocumentFromSvg(CURSOR_ASSETS[state].svg, state),
    )
  }

  let componentId = ''
  const stateNodeIds = new Map<CursorState, NodeId>()
  api.doc.transact(() => {
    componentId = api.createNode('component', null, {
      name: 'Cursor',
      workspaceOnly: true,
      visible: false,
      locked: true,
      position: 'absolute',
      size: {
        width: CURSOR_COMPONENT_SIZE,
        height: CURSOR_COMPONENT_SIZE,
      },
      layout: EMPTY_LAYOUT,
      appearance: TRANSPARENT_APPEARANCE,
      transform: {
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
        scaleX: 1,
        scaleY: 1,
        anchorX: CURSOR_MOTION_HOTSPOT.x,
        anchorY: CURSOR_MOTION_HOTSPOT.y,
        anchorZ: 0,
      },
      variants: [{ name: 'State', values: [...CURSOR_STATES] }],
      defaultSelection: { State: 'Default' },
      variantOverrides: [],
      componentProperties: [],
      variantTransition: { duration: 0, easing: 'linear' },
      timelines: {},
      interactions: [],
    })

    for (const state of CURSOR_STATES) {
      const asset = CURSOR_ASSETS[state]
      const childId = api.createNode('vector', componentId, {
        name: `Cursor / ${state}`,
        position: 'absolute',
        size: { width: 'fill', height: 'fill' },
        transform: {
          x: 0,
          y: 0,
          z: 0,
          rotation: 0,
          rotationX: 0,
          rotationY: 0,
          scaleX: asset.scale,
          scaleY: asset.scale,
        },
        appearance: {
          ...TRANSPARENT_APPEARANCE,
          opacity: state === 'Default' ? 1 : 0,
        },
        viewBox: { ...asset.viewBox },
        vector: vectors.get(state)!,
        trimStart: 0,
        trimEnd: 1,
        trimOffset: 0,
        source: {
          provider: 'svg',
          originalSvg: asset.svg,
          payloadVersion: CURSOR_ASSET_PAYLOAD_VERSION,
          unsupportedFeatures: ['filter'],
          metadata: {
            builtInId: CURSOR_COMPONENT_ID,
            state,
            sourceIcon: asset.sourceIcon,
            ...(asset.derivedFrom ? { derivedFrom: asset.derivedFrom } : {}),
          },
        },
        // Preserves the published drop shadow. The canonical path graph
        // remains available when a user trims or edits the vector.
        importFidelity: 'preserved',
      })
      stateNodeIds.set(state, childId)
    }

    const variantOverrides = CURSOR_STATES.map((activeState) => ({
      match: { State: activeState },
      overrides: Object.fromEntries(
        CURSOR_STATES.map((state) => [
          stateNodeIds.get(state)!,
          { appearance: { opacity: state === activeState ? 1 : 0 } },
        ]),
      ),
    }))
    api.setNodeProperty(
      componentId,
      'variantOverrides' as never,
      variantOverrides as never,
    )
  })

  return componentId
}

/** Lazily create the cursor master once per scene. */
export function ensureCursorComponent(api: SceneAPI): NodeId {
  return findCursorComponent(api) ?? createCursorComponent(api)
}

/**
 * These strings are compile-time-owned, trusted cursor assets. A tiny path-only
 * reader keeps the factory usable in Node tests while the preserved original
 * SVG is still sanitized again at the browser render boundary.
 */
export function cursorVectorDocumentFromSvg(
  svg: string,
  state: CursorState,
): VectorDocument {
  const items: VectorItem[] = []
  const pathPattern = /<path\b([^>]*)>/gi
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pathPattern.exec(svg))) {
    const attributes = match[1] ?? ''
    const pathData = svgAttribute(attributes, 'd')
    if (!pathData) continue
    index += 1
    const itemId = `cursor-${state.toLowerCase()}-${index}`
    const fill = svgAttribute(attributes, 'fill')
    const strokeColor = svgAttribute(attributes, 'stroke')
    const fills =
      fill && fill.toLowerCase() !== 'none'
        ? [
            solidVectorPaint(fill, `${itemId}-fill`),
          ]
        : []
    if (fills[0]) {
      fills[0].opacity = finiteOpacity(
        svgAttribute(attributes, 'fill-opacity'),
      )
    }
    const strokes: VectorStroke[] = []
    if (strokeColor && strokeColor.toLowerCase() !== 'none') {
      const stroke = defaultVectorStroke(
        solidVectorPaint(strokeColor, `${itemId}-stroke-paint`),
        `${itemId}-stroke`,
      )
      stroke.width = finitePositive(svgAttribute(attributes, 'stroke-width'), 1)
      stroke.opacity = finiteOpacity(
        svgAttribute(attributes, 'stroke-opacity'),
      )
      stroke.cap = svgLineCap(svgAttribute(attributes, 'stroke-linecap'))
      stroke.join = svgLineJoin(svgAttribute(attributes, 'stroke-linejoin'))
      strokes.push(stroke)
    }
    items.push(
      createVectorItem({
        id: itemId,
        geometry: parseSvgPathData(pathData, {
          idPrefix: itemId,
          fillRule:
            svgAttribute(attributes, 'fill-rule') === 'evenodd'
              ? 'evenodd'
              : 'nonzero',
        }),
        fills,
        strokes,
        opacity: finiteOpacity(svgAttribute(attributes, 'opacity')),
      }),
    )
  }
  if (items.length === 0) {
    throw new Error(`${state} cursor SVG contains no editable paths`)
  }
  return { version: 1, items }
}

function svgAttribute(attributes: string, name: string): string | null {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${safeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'),
  )
  return match?.[1] ?? match?.[2] ?? null
}

function finiteOpacity(value: string | null): number {
  if (value == null) return 1
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1
}

function finitePositive(value: string | null, fallback: number): number {
  if (value == null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function svgLineCap(value: string | null): VectorStroke['cap'] {
  return value === 'round' || value === 'square' ? value : 'butt'
}

function svgLineJoin(value: string | null): VectorStroke['join'] {
  return value === 'round' || value === 'bevel' ? value : 'miter'
}

function isCursorState(value: unknown): value is CursorState {
  return (
    typeof value === 'string' &&
    (CURSOR_STATES as readonly string[]).includes(value)
  )
}
