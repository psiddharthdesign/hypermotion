// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'

const REMOVED_NODE_KIND = 'primitive3d'

/**
 * Remove documents authored while standalone GPU objects were briefly
 * available. This runs on raw Yjs data before the typed scene reader sees it,
 * so old autosaves and .hype files cannot surface an unsupported node kind.
 *
 * The literal kind intentionally lives only in this compatibility cleanup;
 * it is not part of the public scene model or authoring API.
 */
export function removeLegacy3DObjects(doc: Y.Doc): string[] {
  const scene = doc.getMap<unknown>('scene')
  const nodesValue = scene.get('nodes')
  if (!(nodesValue instanceof Y.Map)) return []

  const nodes = nodesValue as Y.Map<Y.Map<unknown>>
  const removedNodeIds = new Set<string>()
  const visitRemovedSubtree = (nodeId: string) => {
    if (removedNodeIds.has(nodeId)) return
    removedNodeIds.add(nodeId)
    const node = nodes.get(nodeId)
    if (!(node instanceof Y.Map)) return
    for (const childId of readStringArray(node.get('children'))) {
      visitRemovedSubtree(childId)
    }
  }

  for (const [nodeId, node] of nodes.entries()) {
    if (
      node instanceof Y.Map &&
      node.get('kind') === REMOVED_NODE_KIND
    ) {
      visitRemovedSubtree(nodeId)
    }
  }
  if (removedNodeIds.size === 0) return []

  doc.transact(() => {
    for (const [nodeId, node] of nodes.entries()) {
      if (!(node instanceof Y.Map) || removedNodeIds.has(nodeId)) continue
      removeIdsFromNodeChildren(node, removedNodeIds)

      if (removedNodeIds.has(String(node.get('focusTargetNodeId') ?? ''))) {
        node.set('focusTargetNodeId', null)
        node.set('focusMode', 'screen')
      }
      if (removedNodeIds.has(String(node.get('sourceNodeId') ?? ''))) {
        node.delete('sourceNodeId')
      }
      if (removedNodeIds.has(String(node.get('componentSourceId') ?? ''))) {
        node.set('componentSourceId', null)
      }
    }

    const removedTrackIds = new Set<string>()
    const removedKeyframeIds = new Set<string>()
    const tracksValue = scene.get('tracks')
    if (tracksValue instanceof Y.Map) {
      const tracks = tracksValue as Y.Map<Y.Map<unknown>>
      for (const [trackId, track] of tracks.entries()) {
        if (
          !(track instanceof Y.Map) ||
          !removedNodeIds.has(String(track.get('nodeId') ?? ''))
        ) {
          continue
        }
        removedTrackIds.add(trackId)
        for (const keyframe of readRecordArray(track.get('keyframes'))) {
          if (typeof keyframe.id === 'string') {
            removedKeyframeIds.add(keyframe.id)
          }
        }
        tracks.delete(trackId)
      }
    }

    cleanUiState(
      scene.get('uiState'),
      removedNodeIds,
      removedTrackIds,
      removedKeyframeIds,
    )

    for (const nodeId of removedNodeIds) nodes.delete(nodeId)
    if (removedNodeIds.has(String(scene.get('root') ?? ''))) {
      scene.set('root', '')
    }
    if (removedNodeIds.has(String(scene.get('activeCameraId') ?? ''))) {
      scene.set('activeCameraId', '')
    }
  }, removeLegacy3DObjects)

  return [...removedNodeIds]
}

function removeIdsFromNodeChildren(
  node: Y.Map<unknown>,
  removedNodeIds: ReadonlySet<string>,
) {
  const value = node.get('children')
  const next = readStringArray(value).filter((id) => !removedNodeIds.has(id))
  if (value instanceof Y.Array) {
    if (next.length === value.length) return
    value.delete(0, value.length)
    if (next.length > 0) value.push(next)
    return
  }
  if (Array.isArray(value) && next.length !== value.length) {
    node.set('children', next)
  }
}

function cleanUiState(
  value: unknown,
  removedNodeIds: ReadonlySet<string>,
  removedTrackIds: ReadonlySet<string>,
  removedKeyframeIds: ReadonlySet<string>,
) {
  if (!(value instanceof Y.Map)) return
  const uiState = value as Y.Map<unknown>

  const rawTrackGroups = uiState.get('trackGroups')
  if (isRecord(rawTrackGroups)) {
    const trackGroups: Record<string, unknown> = {}
    for (const [groupId, rawGroup] of Object.entries(rawTrackGroups)) {
      if (!isRecord(rawGroup) || !Array.isArray(rawGroup.trackIds)) continue
      const trackIds = rawGroup.trackIds.filter(
        (id): id is string =>
          typeof id === 'string' && !removedTrackIds.has(id),
      )
      if (trackIds.length > 0) {
        trackGroups[groupId] = { ...rawGroup, trackIds }
      }
    }
    uiState.set('trackGroups', trackGroups)
  }

  const rawKeyframeGroups = uiState.get('kfGroups')
  const keyframeGroups: Record<string, string[]> = {}
  if (isRecord(rawKeyframeGroups)) {
    for (const [groupId, rawIds] of Object.entries(rawKeyframeGroups)) {
      if (!Array.isArray(rawIds)) continue
      const ids = rawIds.filter(
        (id): id is string =>
          typeof id === 'string' && !removedKeyframeIds.has(id),
      )
      if (ids.length > 0) keyframeGroups[groupId] = ids
    }
    uiState.set('kfGroups', keyframeGroups)
  }

  const rawCollapsed = uiState.get('kfGroupCollapsed')
  if (isRecord(rawKeyframeGroups) && isRecord(rawCollapsed)) {
    uiState.set(
      'kfGroupCollapsed',
      Object.fromEntries(
        Object.entries(rawCollapsed).filter(([groupId]) =>
          Object.hasOwn(keyframeGroups, groupId),
        ),
      ),
    )
  }

  const rawStaggerSets = uiState.get('staggerSets')
  if (isRecord(rawStaggerSets)) {
    const staggerSets: Record<string, unknown> = {}
    for (const [setId, rawSet] of Object.entries(rawStaggerSets)) {
      if (!isRecord(rawSet) || !Array.isArray(rawSet.layerIds)) continue
      const layerIds = rawSet.layerIds.filter(
        (id): id is string =>
          typeof id === 'string' && !removedNodeIds.has(id),
      )
      if (layerIds.length === 0) continue

      const members: Record<string, unknown> = {}
      if (isRecord(rawSet.members)) {
        for (const [nodeId, rawProperties] of Object.entries(rawSet.members)) {
          if (removedNodeIds.has(nodeId) || !isRecord(rawProperties)) continue
          members[nodeId] = Object.fromEntries(
            Object.entries(rawProperties).map(([propertyId, rawIds]) => [
              propertyId,
              Array.isArray(rawIds)
                ? rawIds.filter(
                    (id) =>
                      typeof id === 'string' && !removedKeyframeIds.has(id),
                  )
                : rawIds,
            ]),
          )
        }
      }
      staggerSets[setId] = { ...rawSet, layerIds, members }
    }
    uiState.set('staggerSets', staggerSets)
  }
}

function readStringArray(value: unknown): string[] {
  const list = value instanceof Y.Array ? value.toArray() : value
  return Array.isArray(list)
    ? list.filter((item): item is string => typeof item === 'string')
    : []
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  const list = value instanceof Y.Array ? value.toArray() : value
  return Array.isArray(list)
    ? list.filter(isRecord)
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
