import type { CameraNode } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { CAMERA_COMPOSITION_GUIDE_OPTIONS, normalizeCameraCompositionGuide, type CameraCompositionGuide } from '@/scene/cameraCompositionGuide'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export function CanvasGuidesControl({ camera, api }: { camera: CameraNode | null; api: SceneAPI }) {
  const value = normalizeCameraCompositionGuide(camera?.compositionGuide)
  return <label title={camera ? `Composition guides: ${CAMERA_COMPOSITION_GUIDE_OPTIONS.find(option => option.value === value)?.label}` : 'Enable a camera to show composition guides'}
    className={`relative flex h-7 w-[52px] items-center gap-2 rounded-md border border-border bg-control pl-2 ${value !== 'none' ? 'ring-1 ring-accent/40' : ''}`}>
    <img src="./camera-inspector/grid.svg" alt="" />
    <img src="./camera-inspector/grid-chevron.svg" alt="" />
    <select aria-label="Canvas composition guides" value={value} disabled={!camera}
      className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      onChange={event => {
        if (!camera) return
        api.doc.transact(() => api.setNodeProperty(camera.id, 'compositionGuide', event.target.value as CameraCompositionGuide), UNDOABLE_GESTURE_ORIGIN)
      }}>
      {CAMERA_COMPOSITION_GUIDE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
}
