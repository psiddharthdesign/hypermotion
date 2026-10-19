import { useRef } from 'react'
import type { CameraNode } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { useUI } from '@/state/ui'
import { CAMERA_COMPOSITION_GUIDE_OPTIONS, normalizeCameraCompositionGuide, type CameraCompositionGuide } from '@/scene/cameraCompositionGuide'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export function CanvasGuidesControl({ camera, api }: { camera: CameraNode | null; api: SceneAPI }) {
  const value = normalizeCameraCompositionGuide(camera?.compositionGuide)
  const ref = useRef<HTMLDetailsElement>(null)
  const strength = useUI(state => state.compositionGuideStrength)
  const spacingScale = useUI(state => state.compositionGridSpacingScale)
  const snapEnabled = useUI(state => state.solidGridSnapEnabled)
  const snapSize = useUI(state => state.solidGridSize)
  const setStrength = useUI(state => state.setCompositionGuideStrength)
  const setSpacingScale = useUI(state => state.setCompositionGridSpacingScale)
  const setSnapEnabled = useUI(state => state.setSolidGridSnapEnabled)
  const setSnapSize = useUI(state => state.setSolidGridSize)
  const supportsGridSpacing = value === 'isometric' || value === 'diamond-grid' || value === 'grid'
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
    <div role="group" aria-label="Composition guide options" className="absolute bottom-9 right-0 z-50 w-60 rounded-md border border-zinc-300 bg-white p-2 text-zinc-950 shadow-lg">
      {CAMERA_COMPOSITION_GUIDE_OPTIONS.map(option => <button key={option.value} type="button" aria-pressed={option.value === value}
        className="block w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-zinc-100 aria-pressed:bg-zinc-100"
        onClick={() => {
          if (!camera) return
          api.doc.transact(() => api.setNodeProperty(camera.id, 'compositionGuide', option.value as CameraCompositionGuide), UNDOABLE_GESTURE_ORIGIN)
        }}>{option.label}</button>)}
      {value !== 'none' && <div className="mt-2 border-t border-zinc-200 pt-2">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Guide appearance</div>
        <label className="mb-2 block text-[11px]">
          <span className="mb-1 flex justify-between"><span>Strength</span><span>{Math.round(strength * 100)}%</span></span>
          <input aria-label="Composition guide strength" type="range" min="0" max="0.5" step="0.01" value={strength}
            onChange={event => setStrength(Number(event.currentTarget.value))} className="w-full accent-blue-600" />
        </label>
        {supportsGridSpacing && <label className="mb-2 block text-[11px]">
          <span className="mb-1 flex justify-between"><span>Grid spacing</span><span>{spacingScale.toFixed(1)}×</span></span>
          <input aria-label="Composition grid spacing" type="range" min="0.5" max="3" step="0.1" value={spacingScale}
            onChange={event => setSpacingScale(Number(event.currentTarget.value))} className="w-full accent-blue-600" />
        </label>}
      </div>}
      <div className="mt-2 border-t border-zinc-200 pt-2">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Solid editing</div>
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={snapEnabled} onChange={event => setSnapEnabled(event.currentTarget.checked)} className="accent-blue-600" />
          Snap 3D face drags
        </label>
        {snapEnabled && <label className="mt-2 flex items-center justify-between gap-2 text-[11px]">
          Snap size
          <input aria-label="3D face snap size" type="number" min="1" max="1024" step="1" value={snapSize}
            onChange={event => setSnapSize(Number(event.currentTarget.value))} className="w-20 rounded border border-zinc-300 px-1.5 py-1" />
        </label>}
      </div>
    </div>
  </details>
}
