// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react'
import type { AnimatedValue } from '@/anim'
import type { CameraNode } from '@/scene'
import { cameraSpaceDepth, resolveCamera3D, type ViewportSize } from '@/render3d/scene3d'
import { cameraPreviewStore, mergeCameraAnimationPreview } from './cameraPreviewStore'
import { setFocusPlaneDepth } from './focusPlaneGeometry'
import type { FocusPlanePositionPatch } from './FocusPlaneOverlay'
import { FieldRow } from './fields/FieldRow'
import { NumberField } from './fields/NumberField'

/** Subscribe only this field to live drags so the whole Inspector needn't rerender per packet. */
export function FocusPlaneDistanceField({ camera, cameraAnim, viewport, onCommit, onPreview, onScrubCommit, onCancel }: {
  camera: CameraNode
  cameraAnim?: AnimatedValue
  viewport: ViewportSize
  onCommit: (patch: FocusPlanePositionPatch) => void
  onPreview: (patch: FocusPlanePositionPatch) => void
  onScrubCommit: (patch: FocusPlanePositionPatch) => void
  onCancel: () => void
}) {
  const preview = useSyncExternalStore(cameraPreviewStore.subscribe, cameraPreviewStore.getSnapshot, cameraPreviewStore.getSnapshot)
  const resolved = resolveCamera3D(camera, mergeCameraAnimationPreview(cameraAnim,
    preview?.cameraId === camera.id ? preview.value : undefined), viewport)
  const distance = cameraSpaceDepth(resolved.focusWorld, resolved)
  const positionAt = (value: number): FocusPlanePositionPatch => {
    const point = setFocusPlaneDepth(resolved, resolved.focusWorld, value)
    return { focusPlaneX: point.x, focusPlaneY: point.y, focusPlaneZ: point.z }
  }
  return <>
    <FieldRow label="Distance from camera" reserveAction>
      <NumberField ariaLabel="Focus plane distance" value={distance} min={resolved.nearClip} step={1} suffix="px"
        disabled={camera.locked}
        onCommit={value => onCommit(positionAt(value))}
        onScrubPreview={value => onPreview(positionAt(value))}
        onScrubCommit={value => onScrubCommit(positionAt(value))}
        onScrubCancel={onCancel} />
    </FieldRow>
    <p className="text-[11px] leading-relaxed text-text-muted">
      Distance to the plane’s centre along the camera view. Hold Shift while dragging or using arrow keys for 10× steps.
    </p>
  </>
}
