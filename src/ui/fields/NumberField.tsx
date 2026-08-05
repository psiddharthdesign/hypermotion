// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import {
  formatNumericDisplayValue,
  formatNumericValue,
  parseNumericExpression,
  stabilizeNumericValue,
} from './numericExpression'
import { SquircleSurface } from './SquircleSurface'

const SCRUB_CURSOR =
  'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%230a0a0c%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m9 7-5 5 5 5%27/%3E%3Cpath d=%27m15 7 5 5-5 5%27/%3E%3C/svg%3E") 12 12, ew-resize'

/**
 * A numeric input that commits on blur or Enter, cancels on Escape.
 *
 * The field keeps its own "draft" string while focused so the user can
 * type freely (including partial input like "-" or "1.") without the
 * parent's latest value stomping the cursor position mid-type. On commit,
 * the configured parser must return a finite value before `onCommit` runs.
 * Quantity-specific wrappers can supply their own parser and formatter.
 *
 * Selecting all on focus matches Figma / After Effects behavior — you
 * click a number and start typing a replacement, you don't have to
 * backspace your way through the old one.
 */
export function NumberField({
  value,
  onCommit,
  onScrubPreview,
  onScrubCommit,
  onScrubCancel,
  min,
  max,
  step = 1,
  suffix,
  prefix,
  ariaLabel,
  disabled = false,
  showScrubHandle = true,
  width = 'w-full',
  parseValue = parseNumericExpression,
  formatValue = formatNumericValue,
  formatDisplayValue = formatNumericDisplayValue,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => formatValue(value))
  const [focused, setFocused] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const skipNextBlurCommitRef = useRef(false)
  const latestRef = useRef({
    value,
    onCommit,
    onScrubPreview,
    onScrubCommit,
    onScrubCancel,
    min,
    max,
    step,
    parseValue,
    formatValue,
  })
  const scrubRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startValue: number
    scrubbing: boolean
    latestValue: number
    deferredCommit: boolean
    previousCursor: string
  } | null>(null)
  const scrubFrameRef = useRef<number | null>(null)
  const pendingScrubValueRef = useRef<number | null>(null)

  // Pointer listeners are installed once, so keep their current inputs fresh
  // after each committed render without mutating refs during render itself.
  useEffect(() => {
    latestRef.current = {
      value,
      onCommit,
      onScrubPreview,
      onScrubCommit,
      onScrubCancel,
      min,
      max,
      step,
      parseValue,
      formatValue,
    }
  }, [
    value,
    onCommit,
    onScrubPreview,
    onScrubCommit,
    onScrubCancel,
    min,
    max,
    step,
    parseValue,
    formatValue,
  ])

  const commit = (keepInvalidDraft: boolean): boolean => {
    const latest = latestRef.current
    const parsed = latest.parseValue(draft)
    if (parsed == null) {
      setInvalid(keepInvalidDraft)
      if (!keepInvalidDraft) setDraft(latest.formatValue(latest.value))
      return false
    }
    const clamped = clamp(parsed, latest.min, latest.max)
    setInvalid(false)
    if (clamped !== latest.value) latest.onCommit(clamped)
    setDraft(latest.formatValue(clamped))
    return true
  }

  useEffect(() => {
    const cancelQueuedScrub = () => {
      if (scrubFrameRef.current !== null) {
        cancelAnimationFrame(scrubFrameRef.current)
      }
      scrubFrameRef.current = null
      pendingScrubValueRef.current = null
    }

    const publishQueuedScrub = () => {
      const next = pendingScrubValueRef.current
      pendingScrubValueRef.current = null
      scrubFrameRef.current = null
      if (next === null) return
      const latest = latestRef.current
      ;(latest.onScrubPreview ?? latest.onCommit)(next)
    }

    const queueScrub = (next: number) => {
      pendingScrubValueRef.current = next
      if (scrubFrameRef.current !== null) return
      scrubFrameRef.current = requestAnimationFrame(publishQueuedScrub)
    }

    const onPointerMove = (e: PointerEvent) => {
      const scrub = scrubRef.current
      if (!scrub || e.pointerId !== scrub.pointerId) return
      const dx = e.clientX - scrub.startX
      const dy = e.clientY - scrub.startY
      if (!scrub.scrubbing && Math.hypot(dx, dy) < 3) return

      scrub.scrubbing = true
      e.preventDefault()
      document.body.style.userSelect = 'none'
      document.documentElement.style.cursor = SCRUB_CURSOR
      document.body.style.cursor = SCRUB_CURSOR
      ref.current?.blur()

      const latest = latestRef.current
      const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
      const delta = (dx - dy) * latest.step * multiplier
      const next = clamp(
        stabilizeNumericValue(scrub.startValue + delta),
        latest.min,
        latest.max,
      )
      scrub.latestValue = next
      setInvalid(false)
      setDraft(latest.formatValue(next))
      if (latest.onScrubPreview) {
        scrub.deferredCommit = true
      }
      // Publish at display cadence. Transient-preview callers avoid document
      // writes entirely; the generic fallback is still live without reacting
      // to every raw hardware packet.
      queueScrub(next)
    }

    const finishPointerScrub = (e: PointerEvent, cancelled: boolean) => {
      const scrub = scrubRef.current
      if (!scrub || e.pointerId !== scrub.pointerId) return
      scrubRef.current = null
      document.body.style.userSelect = ''
      document.documentElement.style.cursor = scrub.previousCursor
      document.body.style.cursor = scrub.previousCursor
      if (scrub.scrubbing) {
        if (cancelled) cancelQueuedScrub()
        else publishQueuedScrub()
        if (scrub.deferredCommit) {
          if (cancelled) {
            latestRef.current.onScrubCancel?.()
            setDraft(latestRef.current.formatValue(latestRef.current.value))
          } else {
            ;(latestRef.current.onScrubCommit ?? latestRef.current.onCommit)(
              scrub.latestValue,
            )
          }
        }
        e.preventDefault()
        ref.current?.blur()
      }
    }
    const onPointerUp = (e: PointerEvent) => finishPointerScrub(e, false)
    const onPointerCancel = (e: PointerEvent) => finishPointerScrub(e, true)

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      cancelQueuedScrub()
      const scrub = scrubRef.current
      document.body.style.userSelect = ''
      if (scrub) {
        if (scrub.deferredCommit) latestRef.current.onScrubCancel?.()
        document.documentElement.style.cursor = scrub.previousCursor
        document.body.style.cursor = scrub.previousCursor
        scrubRef.current = null
      }
    }
  }, [])

  const beginScrub = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.documentElement.style.cursor = SCRUB_CURSOR
    document.body.style.cursor = SCRUB_CURSOR
    const parsed = latestRef.current.parseValue(draft) ?? latestRef.current.value
    scrubRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startValue: parsed,
      scrubbing: false,
      latestValue: parsed,
      deferredCommit: false,
      previousCursor,
    }
  }

  return (
    <SquircleSurface
      as="label"
      radius={6}
      className={[
        'hm-control-surface hm-control-compact inline-flex h-7 items-center',
        invalid ? 'ring-2 ring-red-500/70' : '',
        disabled ? 'cursor-not-allowed opacity-50' : '',
        width,
      ].join(' ')}
      title={invalid ? 'Enter a valid number' : undefined}
      data-invalid={invalid ? 'true' : undefined}
    >
      {showScrubHandle ? (
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel ? `Drag to scrub ${ariaLabel}` : 'Drag to scrub value'}
          title="Drag to scrub value"
          onPointerDown={beginScrub}
          className={[
            'flex h-full shrink-0 items-center justify-center rounded-l-md text-text-dim enabled:cursor-ew-resize enabled:hover:text-text',
            prefix ? 'w-4' : 'w-5',
          ].join(' ')}
          style={{ cursor: disabled ? 'not-allowed' : SCRUB_CURSOR }}
        >
          {prefix ? (
            <span
              aria-hidden="true"
              className="font-mono text-[10px] font-medium tabular-nums"
            >
              {prefix}
            </span>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 7-5 5 5 5" />
              <path d="m15 7 5 5-5 5" />
            </svg>
          )}
        </button>
      ) : null}
      <input
        ref={ref}
        type="text"
        disabled={disabled}
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={focused || invalid ? draft : formatDisplayValue(value)}
        onChange={(e) => {
          setDraft(e.target.value)
          if (invalid) setInvalid(false)
        }}
        onFocus={(e) => {
          if (!invalid) setDraft(formatValue(value))
          setFocused(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false
            return
          }
          commit(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (commit(true)) {
              skipNextBlurCommitRef.current = true
              ref.current?.blur()
            }
          } else if (e.key === 'Escape') {
            e.preventDefault()
            skipNextBlurCommitRef.current = true
            setInvalid(false)
            setDraft(latestRef.current.formatValue(latestRef.current.value))
            ref.current?.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            const delta =
              (e.key === 'ArrowUp' ? 1 : -1) * latestRef.current.step * multiplier
            const current =
              latestRef.current.parseValue(draft) ?? latestRef.current.value
            const next = clamp(
              stabilizeNumericValue(current + delta),
              latestRef.current.min,
              latestRef.current.max,
            )
            setInvalid(false)
            setDraft(latestRef.current.formatValue(next))
            latestRef.current.onCommit(next)
          }
        }}
        className={[
          'min-w-0 flex-1 bg-transparent py-0.5 text-left',
          'text-[12px] tabular-nums text-text outline-none',
          showScrubHandle ? 'pl-0.5' : 'pl-2',
          suffix ? '' : 'pr-1',
        ].join(' ')}
      />
      {suffix ? (
        <span
          className="pointer-events-none shrink-0 select-none pr-2 pl-0.5 text-[11px] text-text-dim"
          aria-hidden="true"
        >
          {suffix}
        </span>
      ) : null}
    </SquircleSurface>
  )
}

export interface NumberFieldProps {
  value: number
  onCommit: (next: number) => void
  /**
   * Optional lightweight pointer-scrub preview. When supplied, drag packets
   * call this instead of `onCommit`; `onScrubCommit` (or `onCommit`) receives
   * the final value once on pointer-up. This keeps expensive document writes
   * out of high-frequency transform scrubs.
   */
  onScrubPreview?: (next: number) => void
  onScrubCommit?: (next: number) => void
  onScrubCancel?: () => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  /** Short axis token shown in the scrub affordance (for paired W/H, X/Y). */
  prefix?: string
  /** Accessible name for the numeric input and its scrub handle. */
  ariaLabel?: string
  disabled?: boolean
  /** Hide the drag handle when a separate range control owns direct manipulation. */
  showScrubHandle?: boolean
  /** Tailwind width class. The canonical Inspector field fills its parent slot. */
  width?: string
  /** Custom draft parser used by quantity-specific wrappers such as TimeField. */
  parseValue?: (draft: string) => number | null
  /** Custom display formatter paired with parseValue. */
  formatValue?: (value: number) => string
  /** Compact formatter used only while the field is not being edited. */
  formatDisplayValue?: (value: number) => string
}

function clamp(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) return min
  if (max !== undefined && n > max) return max
  return n
}
