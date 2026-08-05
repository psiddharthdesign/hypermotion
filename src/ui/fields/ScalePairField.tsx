// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { NodeId } from '@/scene'
import { useUI } from '@/state/ui'
import { KeyframeButton } from './KeyframeButton'
import { KeyframeSliderRow } from './KeyframeSliderRow'
import { SquircleSurface } from './SquircleSurface'
import {
  commitScaleAxisEdit,
  previewScaleAxisEdit,
  resolveScaleAxisEdit,
  type ScaleAxis,
  type ScalePair,
} from './scalePairEdit'
import {
  formatNumericDisplayValue,
  formatNumericValue,
  parseNumericExpression,
  stabilizeNumericValue,
} from './numericExpression'

/**
 * Scale editor — two percentage fields with leading "X" / "Y" labels,
 * with the link toggle placed between the two channels.
 *
 * Storage stays as a pair of floats on `transform` (1 = 100%); the UI
 * exclusively shows percentages, what users coming from Figma, AE, or
 * Jitter expect. Conversion lives entirely in this component.
 *
 * Layout (left → right):
 *
 *   ┌─────────────┐  ◇  🔗  ┌─────────────┐  ◇
 *   │ X 100    %  │         │ Y 100    %  │
 *   └─────────────┘         └─────────────┘
 *
 * Each field is its own pill with the axis letter inside on the left,
 * the number in the middle, and the % suffix on the right. The
 * KeyframeButton (◇) for that axis sits immediately after its field
 * — both diamonds visible at once because Scale is two animatable
 * channels, not one.
 *
 * Link state lives in UI state (`scaleLinked`) so it survives selection
 * changes. Default OFF — surprise mirroring on type was disorienting.
 * Click the chain icon between the channels to preserve the X:Y proportion
 * while either axis is edited.
 */
export interface ScalePairFieldProps {
  scaleX: number
  scaleY: number
  onCommitX: (next: number) => void
  onCommitY: (next: number) => void
  /**
   * Optional atomic pair writer. Linked edits prefer this over the two
   * per-axis callbacks so the owner can commit one transaction.
   */
  onCommitPair?: (next: ScalePair) => void
  /**
   * Lightweight transient Scale writers. Values use scene storage units
   * (1 = 100%), matching the durable callbacks. When supplied, pointer scrub
   * packets avoid `onCommit*` until the gesture finishes.
   */
  onScrubPreviewX?: (next: number) => void
  onScrubPreviewY?: (next: number) => void
  onScrubPreviewPair?: (next: ScalePair) => void
  /**
   * Optional final scrub writers. Missing handlers fall back to the matching
   * durable `onCommit*` callback, like NumberField's scrub lifecycle.
   */
  onScrubCommitX?: (next: number) => void
  onScrubCommitY?: (next: number) => void
  onScrubCommitPair?: (next: ScalePair) => void
  /** Called after a deferred scrub is cancelled or interrupted. */
  onScrubCancel?: () => void
  mixedX?: boolean
  mixedY?: boolean
  /**
   * When set, keyframe diamonds render next to each field. Omit for
   * multi-selection, where a single toggle can't coherently target one
   * track per selected node.
   */
  nodeId?: NodeId
  /** Multi-selection supplies its own aggregate actions. */
  keyframeX?: ReactNode
  keyframeY?: ReactNode
}

export function ScalePairField({
  scaleX,
  scaleY,
  onCommitX,
  onCommitY,
  onCommitPair,
  onScrubPreviewX,
  onScrubPreviewY,
  onScrubPreviewPair,
  onScrubCommitX,
  onScrubCommitY,
  onScrubCommitPair,
  onScrubCancel,
  mixedX = false,
  mixedY = false,
  nodeId,
  keyframeX,
  keyframeY,
}: ScalePairFieldProps) {
  const scaleLinked = useUI((s) => s.scaleLinked)
  const toggleScaleLinked = useUI((s) => s.toggleScaleLinked)

  const currentPairRef = useRef<ScalePair>({ scaleX, scaleY })
  const editRef = useRef<{
    axis: ScaleAxis
    baseline: ScalePair
    source: 'field' | 'scrub'
  } | null>(null)

  // External changes (selection, timeline seeks, undo/redo) become the next
  // edit's baseline. During an active edit the captured baseline stays fixed,
  // which avoids ratio drift from rounded intermediate values.
  useEffect(() => {
    if (!editRef.current) currentPairRef.current = { scaleX, scaleY }
  }, [scaleX, scaleY])

  const beginEdit = (axis: ScaleAxis) => {
    editRef.current = {
      axis,
      baseline: { ...currentPairRef.current },
      source: 'field',
    }
  }

  const endEdit = (axis: ScaleAxis) => {
    if (
      editRef.current?.axis === axis &&
      editRef.current.source === 'field'
    ) {
      editRef.current = null
    }
  }

  const commit = (axis: ScaleAxis, percent: number) => {
    const activeEdit = editRef.current
    const baseline =
      activeEdit?.axis === axis
        ? activeEdit.baseline
        : { ...currentPairRef.current }
    currentPairRef.current = commitScaleAxisEdit({
      baseline,
      current: currentPairRef.current,
      axis,
      next: percent / 100,
      linked: scaleLinked,
      onCommitX,
      onCommitY,
      onCommitPair,
    })
  }

  const beginScrubEdit = (axis: ScaleAxis) => {
    const activeEdit = editRef.current
    if (activeEdit?.axis === axis && activeEdit.source === 'scrub') {
      return activeEdit
    }
    const nextEdit = {
      axis,
      baseline: { ...currentPairRef.current },
      source: 'scrub' as const,
    }
    editRef.current = nextEdit
    return nextEdit
  }

  const previewScrub = (axis: ScaleAxis, percent: number) => {
    const edit = beginScrubEdit(axis)
    currentPairRef.current = previewScaleAxisEdit({
      baseline: edit.baseline,
      current: currentPairRef.current,
      axis,
      next: percent / 100,
      linked: scaleLinked,
      onPreviewX: onScrubPreviewX,
      onPreviewY: onScrubPreviewY,
      onPreviewPair: onScrubPreviewPair,
    })
  }

  const commitScrub = (axis: ScaleAxis, percent: number) => {
    const edit =
      editRef.current?.axis === axis && editRef.current.source === 'scrub'
        ? editRef.current
        : beginScrubEdit(axis)
    const nextPair = resolveScaleAxisEdit(
      edit.baseline,
      axis,
      percent / 100,
      scaleLinked,
    )
    const changedX = nextPair.scaleX !== edit.baseline.scaleX
    const changedY = nextPair.scaleY !== edit.baseline.scaleY
    const hasExplicitScrubCommit = Boolean(
      onScrubCommitX || onScrubCommitY || onScrubCommitPair,
    )

    if (!hasExplicitScrubCommit) {
      commitScaleAxisEdit({
        baseline: edit.baseline,
        current: edit.baseline,
        axis,
        next: percent / 100,
        linked: scaleLinked,
        onCommitX,
        onCommitY,
        onCommitPair,
      })
    } else if (onScrubCommitPair) {
      // A pair callback owns the complete transient-to-durable handoff for
      // both linked and unlinked scrubs.
      onScrubCommitPair(nextPair)
    } else {
      let emitted = false
      if (changedX) {
        ;(onScrubCommitX ?? onCommitX)(nextPair.scaleX)
        emitted = true
      }
      if (changedY) {
        ;(onScrubCommitY ?? onCommitY)(nextPair.scaleY)
        emitted = true
      }
      // NumberField finishes every deferred gesture, even when it returns to
      // its starting value. Preserve that cleanup opportunity for preview
      // stores by notifying the driving axis once.
      if (!emitted) {
        if (axis === 'x') {
          ;(onScrubCommitX ?? onCommitX)(nextPair.scaleX)
        } else {
          ;(onScrubCommitY ?? onCommitY)(nextPair.scaleY)
        }
      }
    }

    currentPairRef.current = nextPair
    editRef.current = null
  }

  const cancelScrub = () => {
    const activeEdit = editRef.current
    if (activeEdit?.source === 'scrub') {
      currentPairRef.current = { ...activeEdit.baseline }
      editRef.current = null
    }
    onScrubCancel?.()
  }

  const canPreviewX = Boolean(
    onScrubPreviewPair ||
      onScrubPreviewX ||
      (scaleLinked && onScrubPreviewY),
  )
  const canPreviewY = Boolean(
    onScrubPreviewPair ||
      onScrubPreviewY ||
      (scaleLinked && onScrubPreviewX),
  )

  const resolvedKeyframeX =
    keyframeX ??
    (nodeId ? (
      <KeyframeButton
        nodeId={nodeId}
        propertyId="transform.scaleX"
        currentValue={scaleX}
      />
    ) : null)
  const resolvedKeyframeY =
    keyframeY ??
    (nodeId ? (
      <KeyframeButton
        nodeId={nodeId}
        propertyId="transform.scaleY"
        currentValue={scaleY}
      />
    ) : null)

  if (resolvedKeyframeX || resolvedKeyframeY) {
    return (
      <div className="space-y-1.5">
        <KeyframeSliderRow
          label="Scale X"
          value={toPercent(scaleX)}
          onCommit={(percent) => commit('x', percent)}
          onScrubPreview={
            canPreviewX ? (percent) => previewScrub('x', percent) : undefined
          }
          onScrubCommit={(percent) => commitScrub('x', percent)}
          onScrubCancel={cancelScrub}
          step={1}
          adaptiveSpan={400}
          suffix="%"
          mixed={mixedX}
          labelAccessory={
            <LinkToggle linked={scaleLinked} onToggle={toggleScaleLinked} />
          }
          keyframe={resolvedKeyframeX}
        />
        <KeyframeSliderRow
          label="Scale Y"
          value={toPercent(scaleY)}
          onCommit={(percent) => commit('y', percent)}
          onScrubPreview={
            canPreviewY ? (percent) => previewScrub('y', percent) : undefined
          }
          onScrubCommit={(percent) => commitScrub('y', percent)}
          onScrubCancel={cancelScrub}
          step={1}
          adaptiveSpan={400}
          suffix="%"
          mixed={mixedY}
          keyframe={resolvedKeyframeY}
        />
      </div>
    )
  }

  return (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-center gap-1">
      <PercentField
        axis="X"
        value={scaleX}
        mixed={mixedX}
        onCommit={(p) => commit('x', p)}
        onEditStart={() => beginEdit('x')}
        onEditEnd={() => endEdit('x')}
      />
      <LinkToggle linked={scaleLinked} onToggle={toggleScaleLinked} />
      <PercentField
        axis="Y"
        value={scaleY}
        mixed={mixedY}
        onCommit={(p) => commit('y', p)}
        onEditStart={() => beginEdit('y')}
        onEditEnd={() => endEdit('y')}
      />
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
  onEditStart,
  onEditEnd,
}: {
  axis: 'X' | 'Y'
  value: number
  mixed: boolean
  onCommit: (percent: number) => void
  onEditStart: () => void
  onEditEnd: () => void
}) {
  if (mixed) {
    return (
      <SquircleSurface
        radius={6}
        title="Values differ across the selection"
        className="hm-control-surface hm-control-compact flex h-7 flex-1 items-center justify-center text-[11px] italic text-text-dim"
      >
        Mixed
      </SquircleSurface>
    )
  }
  return (
    <SquircleSurface
      as="label"
      radius={6}
      title={`Scale ${axis}`}
      className={[
        // min-w-[56px] floor: enough room for the axis letter, "100", and
        // the % suffix even when the sidebar is narrow. flex-1 still lets
        // it grow when there's headroom.
        'hm-control-surface hm-control-compact inline-flex h-7 min-w-0 items-center',
      ].join(' ')}
    >
      <span
        className="select-none pl-1 pr-0.5 text-[11px] font-medium leading-none"
        style={{ color: 'var(--color-text-muted)' }}
        aria-hidden="true"
      >
        {axis}
      </span>
      <PercentInput
        value={value}
        onCommit={onCommit}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
      />
      <span
        className="pointer-events-none select-none pr-1 text-[11px]"
        style={{ color: 'var(--color-text-dim)' }}
        aria-hidden="true"
      >
        %
      </span>
    </SquircleSurface>
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
  onEditStart,
  onEditEnd,
}: {
  value: number
  onCommit: (percent: number) => void
  onEditStart: () => void
  onEditEnd: () => void
}) {
  const [draft, setDraft] = useState(() => formatPercent(value))
  const [focused, setFocused] = useState(false)
  const livePercentRef = useRef(toPercent(value))
  const cancelBlurCommitRef = useRef(false)

  const emit = (percent: number) => {
    if (!Number.isFinite(percent)) return false
    if (percent !== livePercentRef.current) {
      livePercentRef.current = percent
      onCommit(percent)
    }
    return true
  }

  const commitDraft = () => {
    const parsed = parseNumericExpression(draft)
    if (parsed == null) {
      setDraft(formatPercent(value))
      return
    }
    if (!emit(parsed)) {
      setDraft(formatPercent(value))
      return
    }
    setDraft(formatPercentNumber(parsed))
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={focused ? draft : formatNumericDisplayValue(toPercent(value))}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setDraft(formatPercent(value))
        setFocused(true)
        livePercentRef.current = toPercent(value)
        cancelBlurCommitRef.current = false
        onEditStart()
        e.currentTarget.select()
      }}
      onBlur={() => {
        setFocused(false)
        if (cancelBlurCommitRef.current) {
          cancelBlurCommitRef.current = false
        } else {
          commitDraft()
        }
        onEditEnd()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelBlurCommitRef.current = true
          setDraft(formatPercent(value))
          e.currentTarget.blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
          const delta = (e.key === 'ArrowUp' ? 1 : -1) * multiplier
          const current = parseNumericExpression(draft) ?? toPercent(value)
          const next = stabilizeNumericValue(current + delta)
          setDraft(formatPercentNumber(next))
          emit(next)
        }
      }}
      className="min-w-0 flex-1 bg-transparent py-0.5 text-right font-mono text-[12px] tabular-nums text-text outline-none"
    />
  )
}

/**
 * Convert a stored scale (1 = 100%) into a stable percentage without
 * discarding authored decimal precision.
 */
function toPercent(n: number): number {
  return stabilizeNumericValue(n * 100)
}

function formatPercent(n: number): string {
  return formatPercentNumber(toPercent(n))
}

function formatPercentNumber(p: number): string {
  return formatNumericValue(p)
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
        'flex h-7 w-4 shrink-0 items-center justify-center rounded transition-colors',
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
        width="12"
        height="12"
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
