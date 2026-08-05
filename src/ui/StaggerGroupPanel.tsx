// SPDX-License-Identifier: Apache-2.0

import { useSceneAPI, useSceneVersion } from '@/scene'
import {
  createStaggerSetReturn,
  duplicateStaggerSet,
  renameStaggerSet,
  resolveStaggerSetSourceNodeId,
  retimeStaggerSet,
  reverseStaggerSetInPlace,
  staggerSetPropertyIds,
} from '@/anim/staggerSets'
import { useUI } from '@/state/ui'
import { TimeField } from '@/ui/fields'
import { activateStaggerSetForEditing } from '@/ui/staggerEditing'

/**
 * Relationship-level inspector shown when the compact S row is selected.
 * These actions operate on owned keyframe ids, so ordinary keys sharing the
 * same tracks remain independent.
 */
export function StaggerGroupPanel({ setId }: { setId: string }) {
  useSceneVersion()
  const api = useSceneAPI()
  const setSelection = useUI((state) => state.setSelection)
  const setSelectedStaggerSetId = useUI(
    (state) => state.setSelectedStaggerSetId,
  )
  const setSelectedTrackIds = useUI((state) => state.setSelectedTrackIds)
  const setSelectedTrackId = useUI((state) => state.setSelectedTrackId)
  const setSelectedKeyframes = useUI((state) => state.setSelectedKeyframes)
  const staggerOn = useUI((state) => state.staggerOn)
  const activeStaggerSetId = useUI((state) => state.activeStaggerSetId)
  const selection = useUI((state) => state.selection)
  const setStaggerOn = useUI((state) => state.setStaggerOn)
  const setStaggerDelay = useUI((state) => state.setStaggerDelay)
  const set = api.getUiState().staggerSets[setId]

  if (!set) {
    return (
      <div className="rounded border border-border bg-panel-raised p-3 text-[11px] text-text-dim">
        This stagger no longer exists.
      </div>
    )
  }

  const properties = staggerSetPropertyIds(set)
  const label = set.name?.trim() || 'Stagger group'
  const sourceNodeId = resolveStaggerSetSourceNodeId(api, set)
  const sourceNode = sourceNodeId ? api.getNode(sourceNodeId) : null
  const editingSource =
    staggerOn &&
    activeStaggerSetId === set.id &&
    selection.length === 1 &&
    selection[0] === sourceNodeId
  const selectClone = (nextSetId: string) => {
    if (staggerOn) setStaggerOn(false)
    setSelection([])
    setSelectedTrackIds([])
    setSelectedTrackId(null)
    setSelectedKeyframes([])
    setSelectedStaggerSetId(nextSetId)
  }
  const updateDelay = (delay: number) => {
    if (!retimeStaggerSet(api, set.id, delay)) return
    setStaggerDelay(Math.max(0, delay))
  }

  return (
    <section className="overflow-hidden rounded-md border border-border-strong bg-panel-raised shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-stagger/65 bg-stagger-soft text-[10px] font-bold text-stagger">
          S
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold tracking-wider text-text uppercase">
            {label}
          </div>
          <div className="mt-0.5 truncate text-[9px] text-text-dim">
            {set.layerIds.length} layers · {properties.length} properties
          </div>
        </div>
      </div>

      <div className="space-y-3 p-2.5">
        <label className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[10px] text-text-muted">Name</span>
          <input
            key={label}
            defaultValue={label}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim()
              if (!set.name && next === label) return
              renameStaggerSet(api, set.id, next)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = label
                event.currentTarget.blur()
              }
            }}
            className="h-8 min-w-0 rounded bg-panel px-2 text-[11px] text-text outline-none ring-1 ring-transparent hover:ring-border focus:ring-stagger/55"
            aria-label="Stagger group name"
          />
        </label>

        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[10px] text-text-muted">Layer delay</span>
          <TimeField
            value={set.delay}
            onCommit={updateDelay}
            min={0}
            step={0.01}
            width="w-full"
          />
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[10px] text-text-muted">Layer order</span>
          <div className="grid h-8 grid-cols-2 rounded bg-panel p-0.5">
            {(['forward', 'reverse'] as const).map((order) => (
              <button
                key={order}
                type="button"
                onClick={() => retimeStaggerSet(api, set.id, set.delay, order)}
                aria-pressed={set.order === order}
                className={[
                  'rounded text-[9px] font-medium tracking-wide uppercase',
                  set.order === order
                    ? 'bg-panel-raised text-stagger shadow-sm'
                    : 'text-text-dim hover:text-text-muted',
                ].join(' ')}
                title={
                  order === 'forward'
                    ? 'The first layer starts first'
                    : 'The last layer starts first'
                }
              >
                {order === 'forward' ? '1 → N' : 'N → 1'}
              </button>
            ))}
          </div>
        </div>

        <p className="text-[9px] leading-relaxed text-text-dim">
          Layer order changes who starts first. It does not reverse the motion.
        </p>

        <div className="border-t border-border pt-3">
          <div className="mb-2 grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
            <span className="text-[10px] text-text-muted">Edit source</span>
            <span
              className="truncate text-right text-[10px] text-text-dim"
              title={sourceNode?.name ?? 'Source layer unavailable'}
            >
              {sourceNode?.name ?? 'Unavailable'}
            </span>
          </div>
          <button
            type="button"
            disabled={!sourceNodeId || editingSource}
            onClick={() => activateStaggerSetForEditing(api, set.id)}
            className={[
              'flex h-8 w-full items-center justify-center gap-2 rounded text-[10px] font-semibold',
              editingSource
                ? 'cursor-default bg-stagger/15 text-stagger'
                : sourceNodeId
                  ? 'bg-stagger-soft text-stagger hover:bg-stagger/15'
                  : 'cursor-not-allowed bg-panel text-text-dim opacity-60',
            ].join(' ')}
            title="Reveal the first-starting member and edit the whole stagger relationship"
          >
            {editingSource ? 'Editing animation' : 'Edit animation'}
            {!editingSource ? (
              <kbd className="rounded border border-stagger/30 px-1 py-px font-mono text-[8px]">
                S
              </kbd>
            ) : null}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              const result = duplicateStaggerSet(api, set.id)
              if (result) selectClone(result.setId)
            }}
            className="h-8 rounded border border-border bg-panel text-[10px] font-medium text-text-muted hover:border-border-strong hover:text-text"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => {
              const result = createStaggerSetReturn(api, set.id)
              if (result) selectClone(result.setId)
            }}
            className="h-8 rounded bg-stagger-soft text-[10px] font-semibold text-stagger hover:bg-stagger/15"
            title="Create an independent copy that retraces this stagger back to its starting state"
          >
            Create return
          </button>
        </div>

        <button
          type="button"
          onClick={() => reverseStaggerSetInPlace(api, set.id)}
          className="h-8 w-full rounded text-[10px] text-text-dim hover:bg-panel hover:text-text-muted"
          title="Replace this stagger with its time-reversed version"
        >
          Reverse motion
        </button>
      </div>
    </section>
  )
}
