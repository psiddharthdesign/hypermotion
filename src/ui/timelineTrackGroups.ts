// SPDX-License-Identifier: Apache-2.0

import type { NodeId, Track } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { listTimelineCameras } from '@/ui/cameraActions'

export interface TimelineTrackGroup {
  nodeId: NodeId
  nodeName: string
  nodeKind: string
  tracks: Track[]
}

export interface TimelineTrackGroupOptions {
  /**
   * Keep owned cameras in the result before their first keyframe is authored.
   * Ordinary scene layers still appear only when they contain animation.
   */
  includeEmptyCameras?: boolean
}

export interface TimelineCameraTrackPlaceholder {
  nodeId: NodeId
  nodeName: string
}

function visibleTracksForNode(
  api: SceneAPI,
  nodeId: NodeId,
  nodeKind: string,
): Track[] {
  const tracks = api.getTracksForNode(nodeId)
  if (nodeKind !== 'camera') return tracks

  // Cameras expose one uniform scale. The renderer ignores legacy scaleY
  // tracks, so neither the track list nor its empty-state policy should count
  // one as usable camera animation.
  return tracks.filter(
    (track) => track.propertyId !== 'transform.scaleY',
  )
}

/**
 * Describe the active camera only while it has no usable animation tracks.
 *
 * Keeping this separate from the animated group collector lets the timeline
 * show a compact authoring hint without making empty cameras behave like real
 * track groups in selection, grouping, or keyframe commands.
 */
export function resolveTimelineCameraTrackPlaceholder(
  api: SceneAPI,
  visibleCameraId: NodeId | null,
): TimelineCameraTrackPlaceholder | null {
  if (!visibleCameraId) return null
  const camera = listTimelineCameras(api).find(
    (candidate) => candidate.id === visibleCameraId,
  )
  if (!camera) return null
  if (visibleTracksForNode(api, camera.id, camera.kind).length > 0) {
    return null
  }
  return {
    nodeId: camera.id,
    nodeName: camera.name,
  }
}

/**
 * Collect animated nodes in timeline order.
 *
 * Cameras are scene-level nodes, so they sit outside the artboard tree. Add
 * every owned camera before walking the root, while keeping the walk
 * deduplicated for malformed or legacy documents that also reference a camera
 * from the tree. Program state belongs to the timeline UI rather than this
 * structural collector: all camera groups remain available across cuts.
 */
export function collectTimelineTrackGroups(
  api: SceneAPI,
  options: TimelineTrackGroupOptions = {},
): TimelineTrackGroup[] {
  const rootId = api.getRoot()
  const orderedIds: NodeId[] = []
  const orderedSet = new Set<NodeId>()
  const ownedCameras = listTimelineCameras(api)
  const ownedCameraIds = new Set(ownedCameras.map((camera) => camera.id))

  const append = (id: NodeId) => {
    if (!id || orderedSet.has(id)) return
    orderedSet.add(id)
    orderedIds.push(id)
  }

  for (const camera of ownedCameras) {
    append(camera.id)
  }

  const visited = new Set<NodeId>()
  const walk = (id: NodeId) => {
    if (!id || visited.has(id)) return
    visited.add(id)
    // The scene root is a real animatable frame (for example its fill
    // drives the scene background). It will still be filtered out below
    // while empty, but authored root tracks must remain visible.
    append(id)
    for (const child of api.getChildren(id)) walk(child.id)
  }
  walk(rootId)

  const groups: TimelineTrackGroup[] = []
  for (const id of orderedIds) {
    const node = api.getNode(id)
    if (!node) continue
    // Camera ownership is composition-local. Never surface a parentless
    // camera merely because a malformed legacy tree references it.
    if (node.kind === 'camera' && !ownedCameraIds.has(node.id)) continue
    const tracks = visibleTracksForNode(api, id, node.kind)
    if (
      tracks.length === 0 &&
      !(node.kind === 'camera' && options.includeEmptyCameras)
    ) {
      continue
    }

    groups.push({
      nodeId: id,
      nodeName: node.name,
      nodeKind: node.kind,
      tracks,
    })
  }
  return groups
}
