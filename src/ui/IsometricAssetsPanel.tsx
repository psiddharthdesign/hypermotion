// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { Box, Cylinder, Server, Rotate3D, Cable } from 'lucide-react'
import type { NodeId } from '@/scene/types'
import type { SceneAPI } from '@/scene/doc'
import { NumberField } from '@/ui/fields/NumberField'
import { createIsometricAsset, ISOMETRIC_ASSETS, type IsometricAssetKind } from './isometricAssetAuthoring'
import { applyIsometricLoop, type IsometricLoopOptions } from './isometricLoopAuthoring'
import { createFlowConnection, validateFlowConnectionSelection } from './flowConnectionAuthoring'
import { SolidFaceEditingButton } from './SolidFaceEditingButton'
import { SolidGridControls } from './SolidGridControls'

interface IsometricAssetsPanelProps {
  api: SceneAPI
  parentId?: NodeId
  selection: readonly NodeId[]
  currentTime: number
  onCreated: (nodeId: NodeId) => void
  onViewIsometric: () => void
  onLoopCreated?: (range: { start: number; end: number }) => void
}

const ICONS = { block: Box, platform: Cylinder, server: Server }
const control = 'hm-control-surface h-8 w-full rounded-md px-2 text-[11px] text-text outline-none'

export function IsometricAssetsPanel({ api, parentId, selection, currentTime, onCreated, onViewIsometric, onLoopCreated }: IsometricAssetsPanelProps) {
  const [kind, setKind] = useState<IsometricLoopOptions['kind']>('float')
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>('z')
  const [customDuration, setCustomDuration] = useState<number | null>(null)
  const [amplitude, setAmplitude] = useState(40)
  const [message, setMessage] = useState('')
  const [conflictKey, setConflictKey] = useState<string | null>(null)
  const meta = api.getMeta()
  const remaining = Math.max(0, meta.duration - currentTime)
  const duration = Math.min(customDuration ?? remaining, remaining)
  const minimumDuration = 4 / Math.max(1, meta.frameRate)
  const options = { kind, axis, startTime: currentTime, duration, amplitude }
  const requestKey = JSON.stringify({ selection, options })
  const hasConflict = conflictKey === requestKey
  const connectionSelection = validateFlowConnectionSelection(api, selection)

  const insert = (asset: IsometricAssetKind) => {
    try {
      const id = createIsometricAsset(api, asset, { parentId })
      onCreated(id)
      setMessage('Asset added. Select its parts to edit their size, color, or depth.')
      setConflictKey(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The asset could not be added.')
    }
  }
  const connectAssets = () => {
    try {
      const id = createFlowConnection(api, selection)
      onCreated(id)
      setMessage('Connection added. Move either asset and the line follows. Change its route and flow in Properties.')
      setConflictKey(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The connection could not be added.')
    }
  }
  const createLoop = (replaceExisting = false) => {
    const result = applyIsometricLoop(api, selection, { ...options, replaceExisting })
    if (result.status === 'applied') {
      setMessage(`Loop keys added from ${result.start.toFixed(2)}s to ${result.end.toFixed(2)}s. Every keyframe remains editable.`)
      setConflictKey(null)
      onLoopCreated?.({ start: result.start, end: result.end })
    } else {
      setMessage(result.message)
      setConflictKey(result.status === 'conflict' ? requestKey : null)
    }
  }

  return (
    <section className="space-y-4 p-3" aria-label="Isometric assets">
      <div className="space-y-2">
        <div className="text-xs font-semibold text-text">Isometric assets</div>
        <p className="text-[11px] leading-relaxed text-text-dim">Start with editable shapes, then adjust their depth and animate them.</p>
        <button type="button" onClick={onViewIsometric} className={`${control} flex items-center justify-center gap-2 hover:text-accent`}>
          <Rotate3D size={14} aria-hidden /> View in isometric
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {ISOMETRIC_ASSETS.map((asset) => {
          const Icon = ICONS[asset.id]
          return (
            <button key={asset.id} type="button" title={asset.description} onClick={() => insert(asset.id)} className="hm-control-surface flex min-h-20 flex-col items-center justify-center gap-2 rounded-md px-1 py-3 text-[10px] text-text hover:text-accent">
              <Icon size={23} strokeWidth={1.5} className="text-accent" aria-hidden />
              <span>{asset.name}</span>
            </button>
          )
        })}
      </div>
      <SolidFaceEditingButton api={api} selection={selection} />
      <SolidGridControls />
      <div className="space-y-2 border-t border-border pt-4">
        <button type="button" onClick={connectAssets} disabled={!connectionSelection.valid}
          className={`${control} flex items-center justify-center gap-2 font-medium hover:text-accent disabled:cursor-not-allowed disabled:opacity-40`}>
          <Cable size={14} aria-hidden /> Connect selected assets
        </button>
        <p className="text-[11px] leading-relaxed text-text-dim">{connectionSelection.valid
          ? 'Add a line with animated flow. It stays attached when either asset moves.'
          : connectionSelection.message}</p>
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        <div className="text-xs font-semibold text-text">Motion loop</div>
        <p className="text-[11px] leading-relaxed text-text-dim">Select an asset or layer. Create one cycle starting at the playhead. Match the scene duration for a continuous exported loop.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-[10px] text-text-dim">
            <span>Motion</span>
            <select aria-label="Loop motion" className={control} value={kind} onChange={(event) => { setKind(event.target.value as IsometricLoopOptions['kind']); setMessage('') }}>
              <option value="float">Float</option>
              <option value="spin">Spin</option>
            </select>
          </label>
          <label className="space-y-1 text-[10px] text-text-dim">
            <span>Axis</span>
            <select aria-label="Loop axis" className={control} value={axis} onChange={(event) => { setAxis(event.target.value as typeof axis); setMessage('') }}>
              <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
            </select>
          </label>
        </div>
        <div className="space-y-1 text-[10px] text-text-dim">
          <div>Duration</div>
          <NumberField value={duration} onCommit={(value) => { setCustomDuration(value); setMessage('') }} min={minimumDuration} max={Math.max(minimumDuration, remaining)} step={0.1} suffix="s" ariaLabel="Loop duration" disabled={remaining < minimumDuration} />
        </div>
        {kind === 'float' && <div className="space-y-1 text-[10px] text-text-dim">
          <div>Float distance</div>
          <NumberField value={amplitude} onCommit={(value) => { setAmplitude(value); setMessage('') }} min={0} step={4} suffix="px" ariaLabel="Float distance" />
        </div>}
        <div className="text-[10px] tabular-nums text-text-dim">Start {currentTime.toFixed(2)}s · End {(currentTime + duration).toFixed(2)}s</div>
        <button type="button" onClick={() => createLoop()} disabled={selection.length === 0 || remaining < minimumDuration} className={`${control} font-medium disabled:cursor-not-allowed disabled:opacity-40`}>
          Create loop keyframes
        </button>
        {hasConflict && <button type="button" onClick={() => createLoop(true)} className={`${control} text-accent`}>
          Replace existing {kind === 'spin' ? 'rotation' : 'movement'} on {axis.toUpperCase()}
        </button>}
      </div>
      {message && <p role="status" className="text-[11px] leading-relaxed text-text-muted">{message}</p>}
    </section>
  )
}
