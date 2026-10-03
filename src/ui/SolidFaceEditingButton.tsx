// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'react'
import { Move3D } from 'lucide-react'
import type { NodeId, SceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import { selectedSolidNodeIds } from './solidFaceSelection'

export function SolidFaceEditingButton({ api, selection }: { api: SceneAPI; selection: readonly NodeId[] }) {
  const enabled = useUI(state => state.solidFaceEditing)
  const setEnabled = useUI(state => state.setSolidFaceEditing)
  const available = selectedSolidNodeIds(api, selection).size > 0
  useEffect(() => {
    if (!enabled) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEnabled(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [enabled, setEnabled])
  if (!available) return null
  return <div className="space-y-2">
    <button type="button" aria-pressed={enabled} onClick={() => setEnabled(!enabled)}
      className={`hm-control-surface flex h-9 w-full items-center justify-center gap-2 rounded-md px-3 text-xs ${enabled ? 'text-accent ring-1 ring-accent' : 'text-text hover:text-accent'}`}>
      <Move3D size={15} aria-hidden />{enabled ? 'Finish editing faces' : 'Edit 3D faces'}
    </button>
    {enabled && <p className="text-[11px] leading-4 text-text-muted">Drag a face to extend it. Drag a cylinder’s side to resize its diameter. Hold Shift for 10× movement. Esc cancels.</p>}
  </div>
}
