import type { CameraNode } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { CAMERA_COMPOSITION_GUIDE_OPTIONS, normalizeCameraCompositionGuide, type CameraCompositionGuide } from '@/scene/cameraCompositionGuide'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export function CanvasGuidesControl({ camera, api }: { camera: CameraNode | null; api: SceneAPI }) {
  const value = normalizeCameraCompositionGuide(camera?.compositionGuide)
  const ref = useRef<HTMLDetailsElement>(null)
  return <details ref={ref} data-canvas-control="1" className="relative"
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Escape' && ref.current) ref.current.open = false }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && ref.current) ref.current.open = false }}>
    <summary role="button" aria-label="Canvas composition guides" aria-disabled={!camera}
      onClick={event => { if (!camera) event.preventDefault() }}
      title={camera ? `Composition guides: ${CAMERA_COMPOSITION_GUIDE_OPTIONS.find(option => option.value === value)?.label}` : 'Enable a camera to show composition guides'}
      className={`flex h-7 w-[52px] cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-white pl-2 [&::-webkit-details-marker]:hidden ${value !== 'none' ? 'ring-1 ring-accent/40' : ''}`}>
      <img src="./camera-inspector/grid.svg" alt="" />
      <img src="./camera-inspector/grid-chevron.svg" alt="" />
    </summary>
    <div role="group" aria-label="Composition guide options" className="absolute bottom-9 right-0 z-50 w-44 rounded-md border border-zinc-300 bg-white p-1 text-zinc-950 shadow-lg">
      {CAMERA_COMPOSITION_GUIDE_OPTIONS.map(option => <button key={option.value} type="button" aria-pressed={option.value === value}
        className="block w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-zinc-100 aria-pressed:bg-zinc-100"
        onClick={() => {
          if (!camera) return
          api.doc.transact(() => api.setNodeProperty(camera.id, 'compositionGuide', option.value as CameraCompositionGuide), UNDOABLE_GESTURE_ORIGIN)
          if (ref.current) ref.current.open = false
        }}>{option.label}</button>)}
    </div>
  </details>
}
import { useRef } from 'react'
