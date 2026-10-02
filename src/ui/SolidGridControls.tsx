// SPDX-License-Identifier: Apache-2.0

import { useUI } from '@/state/ui'

export function SolidGridControls() {
  const enabled = useUI(state => state.solidGridSnapEnabled)
  const spacing = useUI(state => state.solidGridSize)
  const setEnabled = useUI(state => state.setSolidGridSnapEnabled)
  const setSpacing = useUI(state => state.setSolidGridSize)
  return <div className="space-y-2 border-t border-border pt-4" aria-label="3D grid snapping">
    <label className="flex items-center justify-between gap-2 text-xs font-medium text-text">
      <span>Snap to grid</span>
      <input type="checkbox" aria-label="Snap to grid" checked={enabled} onChange={event => setEnabled(event.target.checked)}
        className="h-4 w-4 cursor-pointer accent-accent" />
    </label>
    <label className="flex items-center justify-between gap-3 text-[11px] text-text-muted">
      <span>Grid spacing</span>
      <select aria-label="3D grid spacing" value={spacing} disabled={!enabled} onChange={event => setSpacing(Number(event.target.value))}
        className="hm-control-surface h-8 rounded-md px-2 text-[11px] text-text outline-none disabled:cursor-not-allowed disabled:opacity-40">
        {[16, 32, 64, 128].map(value => <option key={value} value={value}>{value} px</option>)}
      </select>
    </label>
    <p className="text-[11px] leading-4 text-text-muted">Hold Option/Alt to bypass while dragging.</p>
  </div>
}
