// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import type { NodeId } from '@/scene'
import { useUI } from '@/state/ui'
import { KeyframeButton } from './KeyframeButton'

/**
 * Scale editor — two percentage fields with leading "X" / "Y" labels,
 * sitting side-by-side, with a link toggle anchored on the right.
 *
 * Storage stays as a pair of floats on `transform` (1 = 100%); the UI
 * exclusively shows percentages, what users coming from Figma, AE, or
 * Jitter expect. Conversion lives entirely in this component.
 *
 * Layout (left → right):
 *
 *   ┌─────────────┐  ◇  ┌─────────────┐  ◇   🔗
 *   │ X 100    %  │     │ Y 100    %  │
 *   └─────────────┘     └─────────────┘
 *
 * Each field is its own pill with the axis letter inside on the left,
 * the number in the middle, and the % suffix on the right. The
 * KeyframeButton (◇) for that axis sits immediately after its field
 * — both diamonds visible at once because Scale is two animatable
 * channels, not one.
 *
 * Link state lives in UI state (`scaleLinked`) so it survives selection
 * changes. Default OFF — surprise mirroring on type was disorienting.
 * Click the chain icon on the right to opt into uniform scaling.
 */
export function ScalePairField({
  scaleX,
  scaleY,
  onCommitX,
  onCommitY,
  mixedX = false,
  mixedY = false,
  nodeId,
}: {
  scaleX: number
  scaleY: number
  onCommitX: (next: number) => void
  onCommitY: (next: number) => void
  mixedX?: boolean
  mixedY?: boolean
  /**
   * When set, keyframe diamonds render next to each field. Omit for
   * multi-selection, where a single toggle can't coherently target one
   * track per selected node.
   */
  nodeId?: NodeId
}) {
  const scaleLinked = useUI((s) => s.scaleLinked)
  const toggleScaleLinked = useUI((s) => s.toggleScaleLinked)

  const commit = (axis: 'x' | 'y', percent: number) => {
    // The link toggle no longer mirrors edits across axes — it
    // surprised users who wanted to nudge one channel without losing
    // the other. The toggle is kept around for a future
    // ratio-preserving behavior (drag X, Y scales to match the
    // original aspect) but for now both axes always edit
    // independently regardless of `scaleLinked`.
    const next = percent / 100
    if (axis === 'x') onCommitX(next)
    else onCommitY(next)
  }

  return (
    <div className="flex w-full items-center gap-1">
      <PercentField
        axis="X"
        value={scaleX}
        mixed={mixedX}
        onCommit={(p) => commit('x', p)}
      />
      {nodeId ? (
        <KeyframeButton
          nodeId={nodeId}
          propertyId="transform.scaleX"
          currentValue={scaleX}
        />
      ) : null}
      <PercentField
        axis="Y"
        value={scaleY}
        mixed={mixedY}
        onCommit={(p) => commit('y', p)}
      />
      {nodeId ? (
        <KeyframeButton
          nodeId={nodeId}
          propertyId="transform.scaleY"
          currentValue={scaleY}
        />
      ) : null}
      <LinkToggle linked={scaleLinked} onToggle={toggleScaleLinked} />
    </div>
  )
}

/**
 * One axis pill: a leading axis letter, the number, then a `%` suffix.
 * The visual chrome (border / focus ring / hover) lives on the wrapping
 * `<label>` so the suffix can sit inside the chrome without colliding
 * with the right-aligned digits — the bug behind "100◌" overlap.
 *
 * Mixed selection renders a small "Mixed" pill in the same footprint,
 * so the row doesn't reflow when selection mix changes.
 */
function PercentField({
  axis,
  value,
  mixed,
  onCommit,
}: {
  axis: 'X' | 'Y'
  value: number
  mixed: boolean
  onCommit: (percent: number) => void
}) {
  if (mixed) {
    return (
      <div
        title="Values differ across the selection"
        className="flex h-6 flex-1 items-center justify-center rounded text-xs italic"
        style={{
          background: 'var(--color-panel-raised)',
          color: 'var(--color-text-dim)',
          border: '1px solid var(--color-border)',
        }}
      >
        Mixed
      </div>
    )
  }
  return (
    <label
      title={`Scale ${axis}`}
      className={[
        // min-w-[56px] floor: enough room for the axis letter, "100", and
        // the % suffix even when the sidebar is narrow. flex-1 still lets
        // it grow when there's headroom.
        'inline-flex h-6 min-w-[56px] flex-1 items-center rounded',
        'border border-transparent hover:border-border',
        'focus-within:border-border-strong focus-within:bg-app-bg',
      ].join(' ')}
    >
      <span
        className="select-none pl-1.5 pr-1 text-[11px] font-medium leading-none"
        style={{ color: 'var(--color-text-muted)' }}
        aria-hidden="true"
      >
        {axis}
      </span>
      <PercentInput value={value} onCommit={onCommit} />
      <span
        className="pointer-events-none select-none pr-1.5 pl-0.5 text-[11px]"
        style={{ color: 'var(--color-text-dim)' }}
        aria-hidden="true"
      >
        %
      </span>
    </label>
  )
}

/**
 * Bare percent input. Transparent + borderless because the chrome
 * lives on the wrapping label. Same draft / commit / escape semantics
 * as the shared NumberField — this one's inlined because the chrome
 * needs to wrap the suffix too.
 */
function PercentInput({
  value,
  onCommit,
}: {
  value: number
  onCommit: (percent: number) => void
}) {
  const [draft, setDraft] = useState(() => formatPercent(value))
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  // Keep the draft in sync with the prop while the user isn't typing.
  useEffect(() => {
    if (!focused) setDraft(formatPercent(value))
  }, [value, focused])

  const commit = () => {
    const parsed = parseFloat(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(formatPercent(value))
      return
    }
    if (parsed !== toPercent(value)) onCommit(parsed)
    setDraft(formatPercentNumber(parsed))
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setFocused(true)
        e.currentTarget.select()
      }}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          ref.current?.blur()
        } else if (e.key === 'Escape') {
          setDraft(formatPercent(value))
          ref.current?.blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)
          const next = (parseFloat(draft) || 0) + delta
          setDraft(formatPercentNumber(next))
          onCommit(next)
        }
      }}
      className="min-w-0 flex-1 bg-transparent py-0.5 text-right font-mono text-[12px] tabular-nums text-text outline-none"
    />
  )
}

/**
 * Convert a stored scale (1 = 100%) into a tidy percentage for display.
 * Rounds to 2 decimals so `1.3333...` doesn't leak into the field.
 */
function toPercent(n: number): number {
  return Math.round(n * 10000) / 100
}

function formatPercent(n: number): string {
  return formatPercentNumber(toPercent(n))
}

function formatPercentNumber(p: number): string {
  // Defensive: agent-built scenes may land here with undefined scale
  // values — a single undefined.toFixed crashes the whole Inspector.
  if (p == null || !Number.isFinite(p)) return ''
  if (Number.isInteger(p)) return String(p)
  return p.toFixed(2).replace(/\.?0+$/, '')
}

function LinkToggle({
  linked,
  onToggle,
}: {
  linked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={linked ? 'Unlink scale axes' : 'Link scale axes'}
      aria-label={linked ? 'Unlink scale axes' : 'Link scale axes'}
      aria-pressed={linked}
      className={[
        'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
        linked
          ? 'text-accent hover:bg-accent-soft'
          : 'text-text-dim hover:bg-panel-raised hover:text-text',
      ].join(' ')}
    >
      {/* Lucide-style link / link-off glyph in a 24-unit viewBox so the
          arcs render at sane proportions — the cramped 16-unit version
          looked like a smudge. */}
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {linked ? (
          <>
            <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 1 0-7.07-7.07L11.41 4.6" />
            <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L12.59 19.4" />
          </>
        ) : (
          <>
            <path d="M9 17H7A5 5 0 0 1 7 7h2" />
            <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
          </>
        )}
      </svg>
    </button>
  )
}