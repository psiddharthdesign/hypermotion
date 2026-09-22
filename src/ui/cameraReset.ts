// SPDX-License-Identifier: Apache-2.0

import { addKeyframe, findTrack } from '@/anim'
import type { NodeId, PropertyId, Transform } from '@/scene'
import type { SceneAPI } from '@/scene/doc'

export type CameraTransformResetGroup = 'position' | 'rotation'

const KEYFRAME_TIME_EPSILON = 0.01

const GROUP_PROPERTIES: Record<
  CameraTransformResetGroup,
  ReadonlyArray<{
    key: keyof Pick<
      Transform,
      'x' | 'y' | 'z' | 'rotation' | 'rotationX' | 'rotationY'
    >
    propertyId: PropertyId
  }>
> = {
  position: [
    { key: 'x', propertyId: 'transform.x' },
    { key: 'y', propertyId: 'transform.y' },
    { key: 'z', propertyId: 'transform.z' },
  ],
  rotation: [
    { key: 'rotationX', propertyId: 'transform.rotationX' },
    { key: 'rotationY', propertyId: 'transform.rotationY' },
    { key: 'rotation', propertyId: 'transform.rotation' },
  ],
}

/**
 * Upsert a reset keyframe while retaining metadata on a keyframe already at
 * the playhead. The generic addKeyframe helper intentionally constructs a
 * fresh keyframe when replacing one; reset is different because it should
 * change only the value, not erase authored easing or preset provenance.
 */
function upsertResetKeyframe(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
  playhead: number,
  value: number,
): void {
  const track = findTrack(api, nodeId, propertyId)
  const existing = track?.keyframes.find(
    (keyframe) => Math.abs(keyframe.time - playhead) < KEYFRAME_TIME_EPSILON,
  )

  if (!track || !existing) {
    addKeyframe(api, nodeId, propertyId, playhead, value)
    return
  }

  const keyframes = track.keyframes
    .map((keyframe) =>
      keyframe.id === existing.id
        ? { ...keyframe, time: playhead, value }
        : keyframe,
    )
    .sort((a, b) => a.time - b.time)
  api.setTrack({ ...track, keyframes })
}

/**
 * Restore one camera transform group to the scene's neutral view and stamp
 * every affected axis at the supplied playhead.
 *
 * Position resets to the current canvas centre and z=0. Rotation resets all
 * three axes to 0. Missing tracks are created; existing tracks and their
 * older keyframes are retained. Static transform and all track writes share
 * one Yjs transaction so reset is one scene update / undo step.
 */
export function resetCameraTransformGroup(
  api: SceneAPI,
  cameraId: NodeId,
  group: CameraTransformResetGroup,
  playhead: number,
): boolean {
  const candidate = api.getNode(cameraId)
  if (!candidate || candidate.kind !== 'camera') return false

  api.doc.transact(() => {
    // Read again inside the transaction so we merge over the freshest static
    // transform instead of a React render's potentially stale node snapshot.
    const camera = api.getNode(cameraId)
    if (!camera || camera.kind !== 'camera') return

    const canvas = api.getMeta().canvas
    const patch =
      group === 'position'
        ? { x: canvas.width / 2, y: canvas.height / 2, z: 0 }
        : { rotationX: 0, rotationY: 0, rotation: 0 }

    api.setNodeProperty(cameraId, 'transform', {
      ...camera.transform,
      ...patch,
    })

    for (const { key, propertyId } of GROUP_PROPERTIES[group]) {
      const value = patch[key]
      if (value === undefined) continue
      upsertResetKeyframe(api, cameraId, propertyId, playhead, value)
    }
  })

  return true
}
