// SPDX-License-Identifier: Apache-2.0

import type { NodeId } from '@/scene'

export interface CameraTimelineDisclosure {
  cameraId: NodeId
  /** The camera currently feeding the editor's resolved Program preview. */
  active: boolean
  /** Whether this camera's property rows are hidden. */
  collapsed: boolean
}

/**
 * Resolve camera timeline accordion state without filtering any cameras.
 *
 * Program activity and disclosure are deliberately independent. A cut can
 * move Program to a camera the user has collapsed, but it must not make that
 * camera disappear or unexpectedly change timeline height during playback.
 * The UI can highlight the active header and leave expansion under explicit
 * user control.
 */
export function resolveCameraTimelineDisclosures({
  cameraIds,
  activeCameraId,
  collapsedCameraIds,
}: {
  cameraIds: readonly NodeId[]
  activeCameraId: NodeId | null
  collapsedCameraIds: ReadonlySet<NodeId>
}): CameraTimelineDisclosure[] {
  return cameraIds.map((cameraId) => ({
    cameraId,
    active: cameraId === activeCameraId,
    collapsed: collapsedCameraIds.has(cameraId),
  }))
}

/**
 * Toggle one camera accordion while dropping stale ids left behind by deleted
 * cameras. Camera ids are stable across rename and reorder, so this state can
 * safely remain editor-local.
 */
export function toggleCameraTimelineDisclosure(
  cameraIds: readonly NodeId[],
  collapsedCameraIds: ReadonlySet<NodeId>,
  cameraId: NodeId,
): Set<NodeId> {
  const liveIds = new Set(cameraIds)
  const next = new Set(
    [...collapsedCameraIds].filter((id) => liveIds.has(id)),
  )
  if (!liveIds.has(cameraId)) return next
  if (next.has(cameraId)) next.delete(cameraId)
  else next.add(cameraId)
  return next
}

/**
 * A camera disclosure may hide relationships owned entirely by that camera,
 * but it must not swallow a cross-layer group merely because the camera is
 * the group's first timeline host.
 */
export function shouldShowHostedCameraTimelineRelationship({
  collapsed,
  cameraId,
  memberNodeIds,
}: {
  collapsed: boolean
  cameraId: NodeId
  memberNodeIds: readonly (NodeId | null | undefined)[]
}): boolean {
  if (!collapsed) return true
  return memberNodeIds.some(
    (memberNodeId) =>
      memberNodeId != null && memberNodeId !== cameraId,
  )
}
