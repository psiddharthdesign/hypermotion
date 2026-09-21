// SPDX-License-Identifier: Apache-2.0
import { orderedCameraCuts } from '@/sequence/cameraCuts'
import type { CompositionScene } from '@/sequence/types'

export function cameraDissolveAt(scene: CompositionScene, time: number) {
  const cuts = orderedCameraCuts(scene.cameraCuts).filter(c => scene.cameraIds.includes(c.cameraId))
  let previous = scene.defaultCameraId
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i]!
    const duration = Math.max(0, Math.min(cut.dissolveDuration ?? 0, (cuts[i + 1]?.time ?? scene.duration) - cut.time))
    if (previous && previous !== cut.cameraId && duration > 0 && time >= cut.time && time < cut.time + duration) {
      return { from: previous, to: cut.cameraId, progress: (time - cut.time) / duration }
    }
    if (cut.time > time) break
    previous = cut.cameraId
  }
  return null
}
