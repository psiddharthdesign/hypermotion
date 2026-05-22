// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import { NumberField } from './NumberField'
import { TextField } from './TextField'
import { hexToOklch, oklchToHex } from './colorConvert'

/**
 * Fill/stroke color field — click the swatch to open a popover with
 * L / C / H sliders. The popover also exposes a text input for editing
 * the oklch() string directly and a "Clear" button that commits `null`.
 *
 * This replaces the previous text-only field that Siddharth found
 * "annoying" — same commit signature, same `value` shape, so callers
 * in the Inspector didn't have to change. Accepts `null` to mean "no
 * fill" and renders a dashed swatch for that state.
 *
 * LCH is chosen over HSL because it's perceptually uniform — equal
 * chroma / lightness steps look like equal color steps, which matches
 * how designers think about palettes. The canvas itself already uses
 * oklch throughout.
 */
export function ColorField({
  value,
  onCommit,
}: {
  value: string | null
  onCommit: (next: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  // Browser EyeDropper API (Chromium-only). Returns sRGB hex; we
  // convert through OKLab to OKLCH so the committed color lives in the
  // same perceptual space as everything else.
  const eyedropperSupported =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper ===
      'function'
  const onPickFromScreen = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!eyedropperSupported) return
    try {
      type EyeDropperResult = { sRGBHex: string }
      type EyeDropperCtor = new () => { open(): Promise<EyeDropperResult> }
      const Ctor = (window as unknown as { EyeDropper: EyeDropperCtor })
        .EyeDropper
      const dropper = new Ctor()
      const { sRGBHex } = await dropper.open()
      const lch = hexToOklch(sRGBHex)
      if (lch) onCommit(formatOklch(lch))
    } catch {
      /* user aborted */
    }
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center justify-end gap-1.5">
      <span className="truncate font-mono text-[10px] text-text-muted">
        {value ? shortLabel(value) : 'none'}
      </span>
      <button
        type="button"
        onClick={onPickFromScreen}
        disabled={!eyedropperSupported}
        title={
          eyedropperSupported
            ? 'Pick color from screen'
            : 'Eyedropper not supported in this browser'
        }
        aria-label="Pick color from screen"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-panel text-text-muted hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <EyedropperGlyph />
      </button>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-5 w-5 shrink-0 rounded border border-border hover:border-border-strong"
        style={{
          background: value ?? undefined,
          backgroundImage: value
            ? undefined
            : 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 3px)',
        }}
        aria-label={value ? `Color ${value}` : 'No fill — click to pick'}
      />
      {open && (
        <ColorPopover
          value={value}
          onCommit={(next) => onCommit(next)}
          onClose={() => setOpen(false)}
          anchor={anchorRef.current}
        />
      )}
    </div>
  )
}

function EyedropperGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.8 1.7a1.35 1.35 0 0 1 1.9 0l1.6 1.6a1.35 1.35 0 0 1 0 1.9l-1 1" />
      <path d="M8.9 4.1 3.1 9.9 2 12l2.1-1.1 5.8-5.8" />
      <path d="M7.8 3 11 6.2" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Popover implementation
// ---------------------------------------------------------------------------

interface Lch {
  l: number // 0..1
  c: number // 0..0.4 (practical OKLCH upper bound)
  h: number // 0..360
}

function ColorPopover({
  value,
  onCommit,
  onClose,
  anchor,
}: {
  value: string | null
  onCommit: (next: string | null) => void
  onClose: () => void
  anchor: HTMLElement | null
}) {
  const [lch, setLch] = useState<Lch>(() => parseOklch(value) ?? { l: 0.7, c: 0.2, h: 300 })
  const popRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape.
  useEffect(() => {
    const onDocPointer = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (popRef.current?.contains(t)) return
      if (anchor && anchor.contains(t)) return
      onClose()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onEsc)
    }
  }, [anchor, onClose])

  const commit = (next: Lch) => {
    setLch(next)
    onCommit(formatOklch(next))
  }

  return (
    <div
      ref={popRef}
      className="absolute right-0 top-6 z-50 w-60 rounded-md border border-border-strong bg-panel-raised p-3 shadow-2xl"
    >
      <div
        className="mb-3 h-10 w-full rounded border border-border"
        style={{ background: formatOklch(lch) }}
      />
      <Labeled label="L">
        <Slider
          value={lch.l}
          min={0}
          max={1}
          step={0.001}
          gradient={buildGradient((v) => formatOklch({ ...lch, l: v }), 0, 1)}
          onChange={(v) => commit({ ...lch, l: v })}
        />
        <NumberField
          value={Number(lch.l.toFixed(3))}
          onCommit={(v) => commit({ ...lch, l: clamp(v, 0, 1) })}
          min={0}
          max={1}
          step={0.01}
          width="w-14"
        />
      </Labeled>
      <Labeled label="C">
        <Slider
          value={lch.c}
          min={0}
          max={0.4}
          step={0.001}
          gradient={buildGradient((v) => formatOklch({ ...lch, c: v }), 0, 0.4)}
          onChange={(v) => commit({ ...lch, c: v })}
        />
        <NumberField
          value={Number(lch.c.toFixed(3))}
          onCommit={(v) => commit({ ...lch, c: clamp(v, 0, 0.4) })}
          min={0}
          max={0.4}
          step={0.01}
          width="w-14"
        />
      </Labeled>
      <Labeled label="H">
        <Slider
          value={lch.h}
          min={0}
          max={360}
          step={1}
          gradient={buildHueGradient(lch.l, lch.c)}
          onChange={(v) => commit({ ...lch, h: v })}
        />
        <NumberField
          value={Math.round(lch.h)}
          onCommit={(v) => commit({ ...lch, h: ((v % 360) + 360) % 360 })}
          min={0}
          max={360}
          step={1}
          width="w-14"
        />
      </Labeled>
      <div className="mt-2 flex items-center gap-1.5">
        <TextField
          value={formatOklch(lch)}
          onCommit={(s) => {
            const parsed = parseOklch(s)
            if (parsed) commit(parsed)
          }}
          width="w-full"
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            onCommit(null)
            onClose()
          }}
          className="text-[11px] text-text-muted hover:text-text"
        >
          Clear fill
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent hover:brightness-110"
        >
          Done
        </button>
      </div>
    </div>
  )
}

function Labeled({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="w-3 font-mono text-[10px] text-text-dim">{label}</span>
      {children}
    </div>
  )
}

function Slider({
  value,
  min,
  max,
  step,
  gradient,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  gradient: string
  onChange: (v: number) => void
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-4 min-w-0 flex-1 cursor-pointer appearance-none rounded outline-none"
      style={{ background: gradient }}
    />
  )
}

// ---------------------------------------------------------------------------
// OKLCH parse / format + gradient builders
// ---------------------------------------------------------------------------

function formatOklch(lch: Lch): string {
  const L = clamp(lch.l, 0, 1).toFixed(3)
  const C = clamp(lch.c, 0, 0.4).toFixed(3)
  const H = Math.round(((lch.h % 360) + 360) % 360)
  return `oklch(${L} ${C} ${H})`
}

function parseOklch(str: string | null): Lch | null {
  if (!str) return null
  const m = str
    .trim()
    .match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:\s*\/\s*[\d.%]+)?\s*\)$/i)
  if (!m) return null
  const parsePercentOr = (s: string) =>
    s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s)
  const l = parsePercentOr(m[1]!)
  const c = parsePercentOr(m[2]!)
  const h = Number(m[3]!)
  if ([l, c, h].some((n) => Number.isNaN(n))) return null
  return { l, c, h }
}

function buildGradient(
  at: (value: number) => string,
  min: number,
  max: number,
  steps = 12,
): string {
  const stops: string[] = []
  for (let i = 0; i <= steps; i++) {
    const v = min + (max - min) * (i / steps)
    stops.push(`${at(v)} ${(i / steps) * 100}%`)
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}

function buildHueGradient(l: number, c: number): string {
  const stops: string[] = []
  for (let h = 0; h <= 360; h += 30) {
    stops.push(`oklch(${l} ${c} ${h}) ${(h / 360) * 100}%`)
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}

function shortLabel(oklchStr: string): string {
  const parsed = parseOklch(oklchStr)
  if (!parsed) return oklchStr
  return oklchToHex(parsed)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
