// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import {
  CURSOR_ASSET_PAYLOAD_VERSION,
  CURSOR_ASSETS,
  CURSOR_COMPONENT_SIZE,
  CURSOR_MOTION_HOTSPOT,
  CURSOR_STATES,
  type CursorState,
} from '@/scene/builtins/cursorAssets'
import {
  CURSOR_COMPONENT_ID,
  cursorVectorDocumentFromSvg,
} from '@/scene/builtins/cursorComponent'

const BUILTIN_ID_PREFIX = 'hypermotion.builtin.'
const BUILTIN_ID_SUFFIX = 'cursor.v1'
const CURSOR_NAME = 'Cursor'
const CURSOR_INSTANCE_NAME = 'Cursor instance'
const CURSOR_METADATA_KEYS = new Set([
  'builtInId',
  'state',
  'sourceIcon',
  'derivedFrom',
])

interface CursorMaster {
  id: string
  node: Y.Map<unknown>
  previousName: string
  states: Map<CursorState, Y.Map<unknown>>
  stateBySourceId: Map<string, CursorState>
}

/**
 * Remove obsolete provider-facing cursor labels and metadata from persisted
 * scenes. Recognition is structural: a hidden built-in component must contain
 * the complete seven-state cursor set. That lets old scenes migrate without
 * carrying a provider name in application code or generated bundles.
 */
export function migrateCursorComponents(doc: Y.Doc): string[] {
  const scene = doc.getMap<unknown>('scene')
  const nodesValue = scene.get('nodes')
  if (!(nodesValue instanceof Y.Map)) return []
  const nodes = nodesValue as Y.Map<Y.Map<unknown>>
  const tracksValue = scene.get('tracks')
  const tracks =
    tracksValue instanceof Y.Map
      ? (tracksValue as Y.Map<Y.Map<unknown>>)
      : null
  const masters = findCursorMasters(nodes)
  if (masters.length === 0) return []

  const changed = new Set<string>()
  doc.transact(() => {
    for (const master of masters) {
      const usesLegacyArtwork = [...master.states].some(([state, vector]) => {
        const source = asRecord(vector.get('source'))
        return (
          source?.payloadVersion !== CURSOR_ASSET_PAYLOAD_VERSION ||
          source.originalSvg !== CURSOR_ASSETS[state].svg
        )
      })

      if (master.node.get('name') !== CURSOR_NAME) {
        master.node.set('name', CURSOR_NAME)
        changed.add(master.id)
      }
      if (
        !sizeMatches(
          master.node.get('size'),
          CURSOR_COMPONENT_SIZE,
          CURSOR_COMPONENT_SIZE,
        )
      ) {
        master.node.set('size', {
          width: CURSOR_COMPONENT_SIZE,
          height: CURSOR_COMPONENT_SIZE,
        })
        changed.add(master.id)
      }
      if (normalizeCursorMotionHotspot(master.node, tracks, master.id)) {
        changed.add(master.id)
      }

      for (const [state, vector] of master.states) {
        if (normalizeCursorVector(vector, state)) {
          changed.add(String(vector.get('id') ?? ''))
        }
      }

      for (const [nodeId, node] of nodes.entries()) {
        if (
          !(node instanceof Y.Map) ||
          node.get('kind') !== 'instance' ||
          node.get('componentId') !== master.id
        ) {
          continue
        }

        const initializesAlwaysOnTop =
          node.get('alwaysOnTop') === undefined
        if (initializesAlwaysOnTop) {
          node.set('alwaysOnTop', true)
          changed.add(nodeId)
          if (moveNodeToFront(nodes, nodeId, node)) {
            changed.add(nodeId)
          }
        }

        const hadLegacySize = sizeMatches(node.get('size'), 32, 32)
        if (hadLegacySize) {
          node.set('size', {
            width: CURSOR_COMPONENT_SIZE,
            height: CURSOR_COMPONENT_SIZE,
          })
          changed.add(nodeId)
        }
        if (normalizeCursorMotionHotspot(node, tracks, nodeId)) {
          changed.add(nodeId)
        }
        if (removeCursorMotionPath(node, tracks, nodeId)) {
          changed.add(nodeId)
        }

        // The old cursor painted only about 11×17 px inside its nominal
        // 32×32 plane. A common workaround was scaling the entire instance to
        // several hundred percent, which produced the huge blurry selection
        // shown in the editor. Repair only unanimated, clearly compensatory
        // legacy scales; authored cursor-scale animation remains untouched.
        if (
          usesLegacyArtwork &&
          hadLegacySize &&
          !hasScaleTrack(tracks, nodeId) &&
          normalizeCompensatoryCursorScale(node)
        ) {
          changed.add(nodeId)
        }

        const name = String(node.get('name') ?? '')
        if (
          name === `${master.previousName} instance` ||
          (name !== CURSOR_INSTANCE_NAME &&
            name.toLowerCase().endsWith(' cursor instance'))
        ) {
          node.set('name', CURSOR_INSTANCE_NAME)
          changed.add(nodeId)
        }

        for (const descendantId of descendantIds(nodes, node)) {
          const descendant = nodes.get(descendantId)
          if (!(descendant instanceof Y.Map) || descendant.get('kind') !== 'vector') {
            continue
          }
          const state =
            cursorStateFromVector(descendant) ??
            master.stateBySourceId.get(
              String(descendant.get('componentSourceId') ?? ''),
            )
          if (state && normalizeCursorVector(descendant, state)) {
            changed.add(descendantId)
          }
        }
      }
    }
  }, migrateCursorComponents)

  return [...changed].filter(Boolean)
}

/**
 * Built-in cursors behave as scene annotations, so their layer row should
 * communicate the same frontmost stacking as their compositor flag. Cursor
 * instances are absolute-positioned; reordering them never changes layout.
 */
function moveNodeToFront(
  nodes: Y.Map<Y.Map<unknown>>,
  nodeId: string,
  node: Y.Map<unknown>,
): boolean {
  const parentId = node.get('parent')
  if (typeof parentId !== 'string') return false
  const parent = nodes.get(parentId)
  if (!(parent instanceof Y.Map)) return false
  const children = parent.get('children')
  if (!(children instanceof Y.Array)) return false
  const index = children.toArray().indexOf(nodeId)
  if (index <= 0) return false
  children.delete(index, 1)
  children.insert(0, [nodeId])
  return true
}

function normalizeCursorMotionHotspot(
  node: Y.Map<unknown>,
  tracks: Y.Map<Y.Map<unknown>> | null,
  nodeId: string,
): boolean {
  if (hasAnchorTrack(tracks, nodeId)) return false
  const transform = asRecord(node.get('transform'))
  if (!transform) return false
  const anchorX = finiteNumber(transform.anchorX, 0.5)
  const anchorY = finiteNumber(transform.anchorY, 0.5)
  // Preserve an explicitly customized pivot. Only the historical centered
  // default is upgraded to the cursor's true click hotspot.
  if (Math.abs(anchorX - 0.5) > 0.0001 || Math.abs(anchorY - 0.5) > 0.0001) {
    return false
  }
  node.set('transform', {
    ...transform,
    anchorX: CURSOR_MOTION_HOTSPOT.x,
    anchorY: CURSOR_MOTION_HOTSPOT.y,
    anchorZ: finiteNumber(transform.anchorZ, 0),
  })
  return true
}

/**
 * Cursor movement is authored with the normal transform channels. Remove the
 * retired curve rail and its dedicated Progress track from older local scenes
 * so the timeline cannot keep showing a control that no longer has an editor.
 */
function removeCursorMotionPath(
  node: Y.Map<unknown>,
  tracks: Y.Map<Y.Map<unknown>> | null,
  nodeId: string,
): boolean {
  let changed = false
  if (node.get('motionPath') !== undefined && node.get('motionPath') !== null) {
    node.set('motionPath', null)
    changed = true
  }
  if (!tracks) return changed

  const obsoleteTrackIds: string[] = []
  for (const [trackId, track] of tracks.entries()) {
    if (
      track instanceof Y.Map &&
      track.get('nodeId') === nodeId &&
      track.get('propertyId') === 'motionPath.progress'
    ) {
      obsoleteTrackIds.push(trackId)
    }
  }
  for (const trackId of obsoleteTrackIds) {
    tracks.delete(trackId)
    changed = true
  }
  return changed
}

function findCursorMasters(
  nodes: Y.Map<Y.Map<unknown>>,
): CursorMaster[] {
  const masters: CursorMaster[] = []
  for (const [id, node] of nodes.entries()) {
    if (
      !(node instanceof Y.Map) ||
      node.get('kind') !== 'component' ||
      node.get('parent') !== null ||
      node.get('workspaceOnly') !== true
    ) {
      continue
    }

    const states = new Map<CursorState, Y.Map<unknown>>()
    const stateBySourceId = new Map<string, CursorState>()
    for (const childId of readStringArray(node.get('children'))) {
      const child = nodes.get(childId)
      if (!(child instanceof Y.Map) || child.get('kind') !== 'vector') continue
      const state = cursorStateFromVector(child)
      if (!state) continue
      states.set(state, child)
      stateBySourceId.set(childId, state)
    }

    if (!CURSOR_STATES.every((state) => states.has(state))) continue
    masters.push({
      id,
      node,
      previousName: String(node.get('name') ?? CURSOR_NAME),
      states,
      stateBySourceId,
    })
  }
  return masters
}

function cursorStateFromVector(node: Y.Map<unknown>): CursorState | null {
  const source = asRecord(node.get('source'))
  const metadata = asRecord(source?.metadata)
  if (!isCursorBuiltInId(metadata?.builtInId)) return null
  return isCursorState(metadata?.state) ? metadata.state : null
}

function isCursorBuiltInId(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith(BUILTIN_ID_PREFIX) &&
    value.endsWith(BUILTIN_ID_SUFFIX)
  )
}

function isCursorState(value: unknown): value is CursorState {
  return (
    typeof value === 'string' &&
    (CURSOR_STATES as readonly string[]).includes(value)
  )
}

function normalizeCursorVector(
  node: Y.Map<unknown>,
  state: CursorState,
): boolean {
  const asset = CURSOR_ASSETS[state]
  const expectedMetadata = {
    builtInId: CURSOR_COMPONENT_ID,
    state,
    sourceIcon: asset.sourceIcon,
    ...(asset.derivedFrom ? { derivedFrom: asset.derivedFrom } : {}),
  }
  const source = asRecord(node.get('source'))
  const metadata = asRecord(source?.metadata)
  const itemPrefix = `cursor-${state.toLowerCase()}-`
  const vector = asRecord(node.get('vector'))
  const items = Array.isArray(vector?.items) ? vector.items : []
  const vectorIdsAreGeneric =
    items.length > 0 &&
    items.every(
      (item) =>
        asRecord(item) &&
        typeof asRecord(item)?.id === 'string' &&
        String(asRecord(item)?.id).startsWith(itemPrefix),
    )
  const sourceIsGeneric =
    source?.provider === 'svg' &&
    source.originalSvg === asset.svg &&
    source.payloadVersion === CURSOR_ASSET_PAYLOAD_VERSION &&
    Array.isArray(source.unsupportedFeatures) &&
    source.unsupportedFeatures.length === 1 &&
    source.unsupportedFeatures[0] === 'filter' &&
    metadataMatches(metadata, expectedMetadata)
  const expectedName = `Cursor / ${state}`
  const transform = asRecord(node.get('transform'))
  const geometryIsGeneric =
    node.get('position') === 'absolute' &&
    sizeMatches(node.get('size'), 'fill', 'fill') &&
    viewBoxMatches(node.get('viewBox'), asset.viewBox) &&
    transform?.x === 0 &&
    transform.y === 0 &&
    transform.scaleX === asset.scale &&
    transform.scaleY === asset.scale &&
    node.get('importFidelity') === 'preserved'

  if (
    node.get('name') === expectedName &&
    sourceIsGeneric &&
    vectorIdsAreGeneric &&
    geometryIsGeneric
  ) {
    return false
  }

  node.set('name', expectedName)
  node.set('position', 'absolute')
  node.set('size', { width: 'fill', height: 'fill' })
  node.set('viewBox', { ...asset.viewBox })
  node.set('transform', {
    ...transform,
    x: 0,
    y: 0,
    scaleX: asset.scale,
    scaleY: asset.scale,
  })
  node.set('importFidelity', 'preserved')
  node.set('source', {
    provider: 'svg',
    originalSvg: asset.svg,
    payloadVersion: CURSOR_ASSET_PAYLOAD_VERSION,
    unsupportedFeatures: ['filter'],
    metadata: expectedMetadata,
  })
  if (!vectorIdsAreGeneric) {
    node.set(
      'vector',
      cursorVectorDocumentFromSvg(asset.svg, state),
    )
  }
  return true
}

function normalizeCompensatoryCursorScale(node: Y.Map<unknown>): boolean {
  const transform = asRecord(node.get('transform'))
  const scaleX = transform?.scaleX
  const scaleY = transform?.scaleY
  if (
    typeof scaleX !== 'number' ||
    typeof scaleY !== 'number' ||
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX < 4 ||
    scaleY < 4 ||
    Math.abs(scaleX - scaleY) > 0.01
  ) {
    return false
  }
  node.set('transform', {
    ...transform,
    scaleX: 1,
    scaleY: 1,
  })
  return true
}

function hasScaleTrack(
  tracks: Y.Map<Y.Map<unknown>> | null,
  nodeId: string,
): boolean {
  if (!tracks) return false
  for (const track of tracks.values()) {
    if (!(track instanceof Y.Map) || track.get('nodeId') !== nodeId) continue
    const propertyId = track.get('propertyId')
    if (
      propertyId === 'transform.scaleX' ||
      propertyId === 'transform.scaleY'
    ) {
      return true
    }
  }
  return false
}

function hasAnchorTrack(
  tracks: Y.Map<Y.Map<unknown>> | null,
  nodeId: string,
): boolean {
  if (!tracks) return false
  for (const track of tracks.values()) {
    if (!(track instanceof Y.Map) || track.get('nodeId') !== nodeId) continue
    const propertyId = track.get('propertyId')
    if (
      propertyId === 'transform.anchorX' ||
      propertyId === 'transform.anchorY' ||
      propertyId === 'transform.anchorZ'
    ) {
      return true
    }
  }
  return false
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback
}

function sizeMatches(
  value: unknown,
  width: number | 'fill',
  height: number | 'fill',
): boolean {
  const size = asRecord(value)
  return size?.width === width && size.height === height
}

function viewBoxMatches(
  value: unknown,
  expected: { x: number; y: number; width: number; height: number },
): boolean {
  const viewBox = asRecord(value)
  return (
    viewBox?.x === expected.x &&
    viewBox.y === expected.y &&
    viewBox.width === expected.width &&
    viewBox.height === expected.height
  )
}

function metadataMatches(
  actual: Record<string, unknown> | null,
  expected: Record<string, unknown>,
): boolean {
  if (!actual) return false
  const keys = Object.keys(actual)
  if (
    keys.length !== Object.keys(expected).length ||
    keys.some((key) => !CURSOR_METADATA_KEYS.has(key))
  ) {
    return false
  }
  return Object.entries(expected).every(([key, value]) => actual[key] === value)
}

function descendantIds(
  nodes: Y.Map<Y.Map<unknown>>,
  root: Y.Map<unknown>,
): string[] {
  const out: string[] = []
  const queue = [...readStringArray(root.get('children'))]
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) continue
    out.push(id)
    const node = nodes.get(id)
    if (node instanceof Y.Map) {
      queue.push(...readStringArray(node.get('children')))
    }
  }
  return out
}

function readStringArray(value: unknown): string[] {
  const raw = value instanceof Y.Array ? value.toArray() : value
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
