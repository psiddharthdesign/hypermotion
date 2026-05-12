// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import type { Stroke } from '@/scene'
import { NumberField } from './NumberField'
import { FieldRow } from './FieldRow'

/**
 * Stroke-width picker — mirrors Figma's border-side selector.
 *
 * The user can pick:
 *   - All           → one Width input applies to all four sides
 *   - Top / Bottom  → only that side gets the width; others zero
 *   - Left / Right
 *   - Custom        → four inputs (T / R / B / L) for full control
 *
 * Compresses to `widths: undefined` for the All / single-side cases
 * where the renderer's box-shadow path is enough (or the renderer's
 * single-side detection works fine). The data model still expresses
 * intent: a "Top only" border lives as `width: w, widths: {t:w, r:0,
 * b:0, l:0}` so animators can keyframe `width` and the side mask is
 * preserved across edits.
 *
 * Used by both the single-node and multi-select Inspector paths via
 * one shared `value` / `onCommit` shape — the parent decides whether
 * the commit fans out to one or many nodes.
 */

type Mode = 'all' | 'top' | 'right' | 'bottom' | 'left' | 'custom'

export function StrokeWidthField({
  value,
  onCommit,
}: {
  value: Stroke
  onCommit: (next: Stroke) => void
}) {
  const mode = deriveMode(value)
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)

  // Click outside / Esc closes the dropdown.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (popRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const setMode = (next: Mode) => {
    setOpen(false)
    if (next === mode) return
    const w = Math.max(0, value.width)
    if (next === 'all') {
      onCommit({ ...value, widths: undefined, width: w })
      return
    }
    if (next === 'custom') {
      // Expand current state to four explicit numbers so the user has
      // values to edit. If it was uniform, every side starts at width.
      const current = value.widths ?? { top: w, right: w, bottom: w, left: w }
      onCommit({ ...value, widths: current, width: w })
      return
    }
    // Single-side modes: that side gets the width, others zero. The
    // canonical width stays as-is so editing the Width input updates
    // that side.
    const sides = { top: 0, right: 0, bottom: 0, left: 0 } as const
    onCommit({
      ...value,
      width: w,
      widths: { ...sides, [next]: w },
    })
  }

  // The "uniform width" input. For all / single-side modes, editing it
  // updates the width AND the active side's slot (so side stays in
  // sync). For custom, this input is hidden in favor of four side
  // inputs.
  const onCommitUniform = (n: number) => {
    const w = Math.max(0, n)
    if (mode === 'all') {
      onCommit({ ...value, width: w, widths: undefined })
      return
    }
    if (mode === 'custom') {
      // Custom path doesn't use the uniform input, but if the parent
      // still calls us in this branch we just update `width`.
      onCommit({ ...value, width: w })
      return
    }
    // Single-side modes
    const sides = { top: 0, right: 0, bottom: 0, left: 0 }
    onCommit({
      ...value,
      width: w,
      widths: { ...sides, [mode]: w },
    })
  }

  return (
    <>
      <FieldRow label="Weight">
        <div className="relative flex min-w-0 flex-1 items-center justify-end gap-1.5">
          {mode !== 'custom' ? (
            <NumberField
              value={value.width}
              onCommit={onCommitUniform}
              min={0}
              step={0.5}
              suffix="px"
            />
          ) : (
            <span className="font-mono text-[10px] text-text-muted">Custom</span>
          )}
          <button
            ref={anchorRef}
            type="button"
            onClick={() => setOpen((o) => !o)}
            title={
              mode === 'all'
                ? 'All sides — pick which sides have a stroke'
                : `Stroke side: ${mode}`
            }
            aria-label="Border side"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-text-muted hover:border-border-strong hover:text-text"
          >
            <ModeGlyph mode={mode} />
          </button>
          {open && (
            <div
              ref={popRef}
              className="absolute right-0 top-6 z-50 w-36 rounded-md border border-border-strong bg-panel-raised p-1 shadow-2xl"
            >
              <Item current={mode} mode="all" label="All" onPick={setMode} />
              <Item current={mode} mode="top" label="Top" onPick={setMode} />
              <Item current={mode} mode="bottom" label="Bottom" onPick={setMode} />
              <Item current={mode} mode="left" label="Left" onPick={setMode} />
              <Item current={mode} mode="right" label="Right" onPick={setMode} />
              <div className="my-1 h-px bg-border" />
              <Item current={mode} mode="custom" label="Custom" onPick={setMode} />
            </div>
          )}
        </div>
      </FieldRow>
      {mode === 'custom' ? (
        <SidesEditor
          widths={
            value.widths ?? {
              top: value.width,
              right: value.width,
              bottom: value.width,
              left: value.width,
            }
          }
          fallbackWidth={value.width}
          onCommit={(widths) => {
            // Pick the largest as the canonical `width` so any legacy
            // renderer path still sees a sensible scalar.
            const w = Math.max(
              widths.top,
              widths.right,
              widths.bottom,
              widths.left,
            )
            onCommit({ ...value, width: w, widths })
          }}
        />
      ) : null}
    </>
  )
}

function Item({
  current,
  mode,
  label,
  onPick,
}: {
  current: Mode
  mode: Mode
  label: string
  onPick: (m: Mode) => void
}) {
  const active = current === mode
  return (
    <button
      type="button"
      onClick={() => onPick(mode)}
      className={
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] ' +
        (active
          ? 'bg-accent-soft text-accent'
          : 'text-text-muted hover:bg-panel hover:text-text')
      }
    >
      <span className="flex h-4 w-4 items-center justify-center text-[10px]">
        <ModeGlyph mode={mode} />
      </span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

type Side = 'top' | 'right' | 'bottom' | 'left'

/**
 * Custom-mode sides editor — Figma-style cross layout.
 *
 * Visual:
 *
 *           [ T# ]
 *
 *      [ L# ]  ▢  [ R# ]
 *
 *           [ B# ]
 *
 * Each side has a click-to-toggle button + a numeric input. Clicking
 * the button enables / disables that side (turns the width 0 or the
 * fallback width). Clicking the value lets you type a custom number.
 * This way a user can pick any 1, 2, 3, or all 4 sides — exactly how
 * Figma's border picker works.
 *
 * `fallbackWidth` is the width assigned to a side when the user
 * toggles it back ON from the off state — without it we'd have to
 * pick an arbitrary value (e.g. 1px) which is rarely what's wanted.
 * The picker uses the parent's main-Width input so toggling sides on
 * inherits the value the user already set.
 */
function SidesEditor({
  widths,
  fallbackWidth,
  onCommit,
}: {
  widths: Record<Side, number>
  fallbackWidth: number
  onCommit: (next: Record<Side, number>) => void
}) {
  const set = (side: Side, v: number) => {
    onCommit({ ...widths, [side]: Math.max(0, v) })
  }
  const toggle = (side: Side) => {
    const on = widths[side] > 0
    const next = on ? 0 : Math.max(0.5, fallbackWidth || 1)
    set(side, next)
  }
  return (
    <div className="mt-2 grid grid-cols-3 grid-rows-3 items-center justify-items-center gap-1.5 rounded border border-border bg-panel p-2">
      {/* Row 1: empty | Top | empty */}
      <div />
      <SideCell
        side="top"
        value={widths.top}
        onToggle={toggle}
        onSet={set}
      />
      <div />
      {/* Row 2: Left | Box | Right */}
      <SideCell
        side="left"
        value={widths.left}
        onToggle={toggle}
        onSet={set}
      />
      <BoxGlyph widths={widths} />
      <SideCell
        side="right"
        value={widths.right}
        onToggle={toggle}
        onSet={set}
      />
      {/* Row 3: empty | Bottom | empty */}
      <div />
      <SideCell
        side="bottom"
        value={widths.bottom}
        onToggle={toggle}
        onSet={set}
      />
      <div />
    </div>
  )
}

function SideCell({
  side,
  value,
  onToggle,
  onSet,
}: {
  side: Side
  value: number
  onToggle: (s: Side) => void
  onSet: (s: Side, v: number) => void
}) {
  const on = value > 0
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => onToggle(side)}
        title={on ? `Turn ${side} off` : `Turn ${side} on`}
        aria-label={`Toggle ${side} side`}
        className={
          'flex h-3.5 w-3.5 items-center justify-center rounded-full border ' +
          (on
            ? 'border-accent bg-accent'
            : 'border-border bg-panel hover:border-border-strong')
        }
      />
      <div className={on ? '' : 'pointer-events-none opacity-40'}>
        <NumberField
          value={value}
          onCommit={(v) => onSet(side, v)}
          min={0}
          step={0.5}
          width="w-11"
        />
      </div>
    </div>
  )
}

/**
 * Tiny box graphic showing which sides are currently lit. Pure visual
 * confirmation — clicking it does nothing. Lit sides use the accent
 * color, dim sides match the dimmed inputs.
 */
function BoxGlyph({ widths }: { widths: Record<Side, number> }) {
  const lit = (s: Side) => widths[s] > 0
  const SZ = 26
  const inset = 3
  const x1 = inset
  const y1 = inset
  const x2 = SZ - inset
  const y2 = SZ - inset
  const sideProps = (s: Side) => ({
    stroke: 'currentColor',
    strokeOpacity: lit(s) ? 1 : 0.2,
    strokeWidth: lit(s) ? 2 : 1.25,
    strokeLinecap: 'round' as const,
  })
  return (
    <svg
      width={SZ}
      height={SZ}
      viewBox={`0 0 ${SZ} ${SZ}`}
      className="text-accent"
    >
      <line x1={x1} y1={y1} x2={x2} y2={y1} {...sideProps('top')} />
      <line x1={x2} y1={y1} x2={x2} y2={y2} {...sideProps('right')} />
      <line x1={x1} y1={y2} x2={x2} y2={y2} {...sideProps('bottom')} />
      <line x1={x1} y1={y1} x2={x1} y2={y2} {...sideProps('left')} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Mode derivation + glyphs
// ---------------------------------------------------------------------------

function deriveMode(stroke: Stroke): Mode {
  const w = stroke.widths
  if (!w) return 'all'
  const { top, right, bottom, left } = w
  if (top === right && right === bottom && bottom === left) return 'all'
  // Single-side: exactly one non-zero, others zero.
  const sides = [
    { name: 'top', v: top },
    { name: 'right', v: right },
    { name: 'bottom', v: bottom },
    { name: 'left', v: left },
  ] as const
  const nonZero = sides.filter((s) => s.v > 0)
  if (nonZero.length === 1) return nonZero[0].name as Mode
  return 'custom'
}

/**
 * Tiny SVG glyph showing which side(s) of a square are highlighted.
 * Used both as the picker-row leading icon and the dropdown trigger
 * indicator so the user gets visual confirmation of the active mode.
 */
function ModeGlyph({ mode }: { mode: Mode }) {
  const stroke = 'currentColor'
  const dim = 'currentColor'
  const dimOpacity = 0.25
  const SZ = 12
  const inset = 1.5
  const x1 = inset
  const y1 = inset
  const x2 = SZ - inset
  const y2 = SZ - inset
  const lit = (side: 'top' | 'right' | 'bottom' | 'left') => {
    if (mode === 'all' || mode === 'custom') return true
    return mode === side
  }
  const sideProps = (side: 'top' | 'right' | 'bottom' | 'left') => ({
    stroke: lit(side) ? stroke : dim,
    strokeOpacity: lit(side) ? 1 : dimOpacity,
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
  })
  return (
    <svg width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y1} {...sideProps('top')} />
      <line x1={x2} y1={y1} x2={x2} y2={y2} {...sideProps('right')} />
      <line x1={x1} y1={y2} x2={x2} y2={y2} {...sideProps('bottom')} />
      <line x1={x1} y1={y1} x2={x1} y2={y2} {...sideProps('left')} />
    </svg>
  )
}