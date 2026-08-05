// SPDX-License-Identifier: Apache-2.0

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { Fill, GradientStop } from '@/scene'
import { defaultFill, fillToCss, imageBackgroundStyle } from '@/scene'
import { FieldRow } from './FieldRow'
import { NumberField } from './NumberField'
import { SelectField } from './SelectField'
import { SquircleSurface } from './SquircleSurface'
import { TextField } from './TextField'
import { hexToOklch, oklchToHex } from './colorConvert'

/**
 * Single Fill control — replaces the old "Fill row + separate Color row"
 * pattern. The row exposes a label, a swatch button, and a small text
 * summary. Clicking the swatch (or the row) opens a popover with five
 * tabs: Solid, Linear, Radial, Conic, Image. Each tab carries its own
 * editing surface; switching tabs preserves stops where possible
 * (linear↔radial↔conic share the same stops shape) and seeds defaults
 * otherwise.
 *
 * The "no fill" state is exposed inside the popover (a Clear button)
 * rather than a separate `none` tab — designers reach for the popover
 * to *pick* a fill, not to remove one, and the Clear surface mirrors the
 * old ColorField pattern designers already know.
 *
 * Commits flow through `onCommit` on every edit; the Inspector wraps
 * each commit through `patchAppearance({ fill })` which goes through the
 * scene API and bumps the scene version, so the canvas re-paints
 * immediately.
 */

type FillKind = Fill['kind']

const TAB_LABELS: Record<FillKind, string> = {
  solid: 'Solid',
  linear: 'Linear',
  radial: 'Radial',
  conic: 'Conic',
  image: 'Image',
}

export function FillField({
  value,
  onCommit,
  label = 'Fill',
  mixed = false,
  disabled = false,
  disabledReason,
  keyframe,
}: {
  value: Fill | null
  onCommit: (next: Fill | null) => void
  label?: string
  /** Selection contains different fills; the editor stays interactive. */
  mixed?: boolean
  disabled?: boolean
  disabledReason?: string
  /** Optional timeline diamond aligned with the Fill row label. */
  keyframe?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)

  // Cached CSS preview so the swatch doesn't re-serialize during hover /
  // re-render. Trivial today, but the popover's stops list re-renders on
  // every drag of a position handle and the parent row would otherwise
  // tag along.
  const swatchBg = useMemo(() => fillToCss(value), [value])
  const imageBg = useMemo(() => imageBackgroundStyle(value), [value])
  const swatchStyle = {
    ...(imageBg ?? {}),
    backgroundColor:
      !mixed && !imageBg && value?.kind === 'solid'
        ? value.color
        : undefined,
    backgroundImage: mixed
      ? 'linear-gradient(135deg, var(--color-accent) 0 25%, transparent 25% 50%, var(--color-accent) 50% 75%, transparent 75%)'
      : imageBg
        ? imageBg.backgroundImage
        : value && value.kind !== 'solid' && swatchBg
          ? swatchBg
          : 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 3px)',
    backgroundSize: mixed ? '6px 6px' : undefined,
  }
  const control = (
    <SquircleSurface
      radius={8}
      data-fill-control="1"
      className="hm-control-surface flex h-7 min-w-0 flex-1 items-center gap-1 px-1"
    >
      <button
        type="button"
        onClick={(event) => {
          setAnchor(event.currentTarget)
          setOpen((o) => !o)
        }}
        aria-label={
          mixed
            ? 'Set fill for selected layers'
            : value
              ? `Edit fill (${value.kind})`
              : 'Add fill'
        }
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          aria-hidden="true"
          className={[
            'h-5 w-5 shrink-0 rounded-[4px] shadow-[0_0_0_1px_var(--color-border)]',
            mixed ? 'ring-1 ring-accent' : '',
          ].join(' ')}
          style={swatchStyle}
        />
        <span className="min-w-0 flex-1 truncate text-[10px] uppercase text-text">
          {mixed ? 'Mixed' : summary(value)}
        </span>
      </button>
      {/* Inline eyedropper — pick any color on screen and have it
          land directly on the fill, without opening the popover. */}
      <RowEyedropper
        onPick={(lch) =>
          onCommit({ kind: 'solid', color: formatOklch(lch) })
        }
      />
    </SquircleSurface>
  )

  return (
    <div
      className={
        'relative min-w-0 w-full ' +
        (disabled ? 'pointer-events-none opacity-40' : '')
      }
      title={disabled ? disabledReason : undefined}
      aria-disabled={disabled || undefined}
    >
      {label ? (
        <FieldRow label={label} keyframe={keyframe}>
          {control}
        </FieldRow>
      ) : (
        control
      )}

      {open && (
        <FillPopover
          value={value}
          onCommit={onCommit}
          onClose={() => setOpen(false)}
          anchor={anchor}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

function FillPopover({
  value,
  onCommit,
  onClose,
  anchor,
}: {
  value: Fill | null
  onCommit: (next: Fill | null) => void
  onClose: () => void
  anchor: HTMLElement | null
}) {
  // Active tab seeds from the current fill kind, falling back to 'solid'
  // when there's no fill yet — that's the most common starting point.
  const [tab, setTab] = useState<FillKind>(value?.kind ?? 'solid')
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const popRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const margin = 8
    const width = 280
    const height = popRef.current?.offsetHeight ?? 0
    const left = Math.min(
      Math.max(margin, rect.right - width),
      Math.max(margin, window.innerWidth - width - margin),
    )
    const preferredTop = rect.bottom + 6
    const maxTop =
      height > 0 ? Math.max(margin, window.innerHeight - height - margin) : preferredTop
    const top = Math.min(
      Math.max(margin, preferredTop),
      maxTop,
    )
    setPosition({ left, top })
  }, [anchor])

  useLayoutEffect(() => {
    updatePosition()
  }, [updatePosition])

  useEffect(() => {
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [updatePosition])

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

  // Switch the fill kind in place. Carries over stops where the new kind
  // also uses stops (linear/radial/conic share the same shape) so a
  // user fine-tuning a palette doesn't lose it when changing the
  // gradient shape. Solid → gradient and gradient → solid both go
  // through `defaultFill` so the seed makes sense.
  const switchTo = (kind: FillKind) => {
    setTab(kind)
    if (value && value.kind === kind) return
    if (
      value &&
      kind !== 'solid' &&
      kind !== 'image' &&
      (value.kind === 'linear' ||
        value.kind === 'radial' ||
        value.kind === 'conic')
    ) {
      const stops = [...value.stops]
      switch (kind) {
        case 'linear':
          onCommit({ kind: 'linear', stops, angle: 180 })
          return
        case 'radial':
          onCommit({
            kind: 'radial',
            stops,
            cx: 0.5,
            cy: 0.5,
            shape: 'circle',
          })
          return
        case 'conic':
          onCommit({ kind: 'conic', stops, angle: 0, cx: 0.5, cy: 0.5 })
          return
      }
    }
    onCommit(defaultFill(kind))
  }

  return createPortal(
    <div
      ref={popRef}
      // Wide enough to hold the 5-tab strip without crowding. Scrolls
      // vertically on small viewports rather than truncating the editor.
      className="fixed z-[1000] w-[280px] overflow-y-auto rounded-md border border-border-strong bg-panel-raised p-3 shadow-2xl"
      style={{
        left: position.left,
        top: position.top,
        maxHeight: 'calc(100vh - 16px)',
      }}
    >
      <Tabs value={tab} onChange={switchTo} onClose={onClose} />
      <div className="mt-3">
        {tab === 'solid' && (
          <SolidEditor
            value={value?.kind === 'solid' ? value : null}
            onCommit={onCommit}
          />
        )}
        {tab === 'linear' && value?.kind === 'linear' && (
          <LinearEditor value={value} onCommit={onCommit} />
        )}
        {tab === 'radial' && value?.kind === 'radial' && (
          <RadialEditor value={value} onCommit={onCommit} />
        )}
        {tab === 'conic' && value?.kind === 'conic' && (
          <ConicEditor value={value} onCommit={onCommit} />
        )}
        {tab === 'image' && value?.kind === 'image' && (
          <ImageEditor value={value} onCommit={onCommit} />
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
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
    </div>,
    document.body,
  )
}

function Tabs({
  value,
  onChange,
  onClose,
}: {
  value: FillKind
  onChange: (kind: FillKind) => void
  onClose: () => void
}) {
  const order: FillKind[] = ['solid', 'linear', 'radial', 'conic', 'image']
  return (
    <div className="flex items-center gap-0.5 border-b border-border pb-2">
      <div className="flex flex-1 items-center gap-0.5">
        {order.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            // Each tab is a small icon-style button; the icon glyph
            // hints at the tab's gradient style. Active tab gets the
            // accent treatment so the user can see at a glance which
            // editor they're working in.
            className={
              'flex h-6 flex-1 items-center justify-center rounded text-[10px] tracking-wide ' +
              (value === k
                ? 'bg-accent-soft text-accent'
                : 'text-text-muted hover:bg-panel hover:text-text')
            }
            title={TAB_LABELS[k]}
            aria-pressed={value === k}
          >
            <TabGlyph kind={k} />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        title="Close"
        className="ml-1 flex h-6 w-6 items-center justify-center rounded text-text-dim hover:bg-panel hover:text-text"
      >
        ×
      </button>
    </div>
  )
}

/**
 * Tiny SVG glyph per fill kind. Drawn in `currentColor` so the active /
 * inactive tab color naturally tints the icon, no extra wiring needed.
 */
function TabGlyph({ kind }: { kind: FillKind }) {
  const s = 14
  const cx = s / 2
  const r = s / 2 - 1.5
  switch (kind) {
    case 'solid':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <circle cx={cx} cy={cx} r={r} fill="currentColor" />
        </svg>
      )
    case 'linear':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <defs>
            <linearGradient id="tabLinear" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
            </linearGradient>
          </defs>
          <circle cx={cx} cy={cx} r={r} fill="url(#tabLinear)" />
        </svg>
      )
    case 'radial':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <defs>
            <radialGradient id="tabRadial">
              <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.15" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cx} r={r} fill="url(#tabRadial)" />
        </svg>
      )
    case 'conic':
      // SVG doesn't support conic gradients natively; approximate with a
      // half-tinted disc that reads as "swept" against the solid disc.
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <circle cx={cx} cy={cx} r={r} fill="currentColor" opacity={0.25} />
          <path
            d={`M ${cx} ${cx - r} A ${r} ${r} 0 0 1 ${cx + r} ${cx} L ${cx} ${cx} Z`}
            fill="currentColor"
          />
        </svg>
      )
    case 'image':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
          <rect
            x={1}
            y={1}
            width={s - 2}
            height={s - 2}
            rx={2}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
          />
          <circle cx={s * 0.35} cy={s * 0.4} r={1.25} fill="currentColor" />
          <path
            d={`M ${s * 0.2} ${s * 0.78} L ${s * 0.5} ${s * 0.5} L ${s * 0.8} ${s * 0.78} Z`}
            fill="currentColor"
          />
        </svg>
      )
  }
}

// ---------------------------------------------------------------------------
// Per-tab editors
// ---------------------------------------------------------------------------

/**
 * Solid color picker.
 *
 * Layout from top to bottom:
 *
 *   1. Big L×C square — drag to set lightness (y) and chroma (x) at the
 *      current hue. The 2D area renders the actual reachable colors at
 *      that hue using a CSS gradient stack, so the user is picking
 *      against the real color they'll get.
 *   2. Hue strip — drag the hue independently. Wraps 0..360.
 *   3. Hex input + OKLCH text input — hex parses sRGB → OKLCH so users
 *      coming from Figma / Slack can paste familiar codes; OKLCH input
 *      is for roundtripping our canonical scene format.
 *
 * Designed to look and feel like the Framer / Figma pickers Siddharth
 * pointed at, using OKLCH internally so colors stay perceptually
 * correct in motion tweens.
 */
function SolidEditor({
  value,
  onCommit,
}: {
  value: Extract<Fill, { kind: 'solid' }> | null
  onCommit: (next: Fill | null) => void
}) {
  const initial = value?.color ?? 'oklch(0.62 0.21 250)'
  const [lch, setLch] = useState<Lch>(
    () =>
      parseOklch(initial) ??
      hexToOklch(initial) ?? { l: 0.62, c: 0.21, h: 250 },
  )
  const commit = (next: Lch) => {
    setLch(next)
    onCommit({ kind: 'solid', color: formatOklch(next) })
  }
  return (
    <div>
      <LcSquare lch={lch} onChange={commit} />
      <div className="mt-2.5">
        <HueStrip
          h={lch.h}
          l={lch.l}
          c={lch.c}
          onChange={(h) => commit({ ...lch, h })}
        />
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {/* Hex input — designers paste hex codes constantly, so this
            is the headline text input. We convert sRGB → OKLCH on
            commit and back to hex for the displayed value. */}
        <HexInput lch={lch} onCommit={commit} />
        <EyedropperButton onPick={commit} />
        <NumberField
          value={Math.round(lch.h)}
          onCommit={(v) => commit({ ...lch, h: ((v % 360) + 360) % 360 })}
          min={0}
          max={360}
          step={1}
          suffix="°"
          width="w-14"
        />
      </div>
      <div className="mt-1.5">
        <TextField
          value={formatOklch(lch)}
          onCommit={(s) => {
            const parsed = parseOklch(s)
            if (parsed) commit(parsed)
          }}
          width="w-full"
        />
      </div>
    </div>
  )
}

/**
 * 2D area for picking lightness × chroma at the current hue.
 *
 * Coordinate mapping: x = chroma (0..0.4), y = lightness inverted
 * (top = 1, bottom = 0). Inverted because designers expect "bright
 * colors at the top, dark at the bottom" the way Photoshop / Figma /
 * Framer do it.
 *
 * We render the available colors directly using two stacked gradients:
 *   - vertical: black at the bottom → white at the top (the lightness
 *     axis at C=0)
 *   - horizontal: same lightness range but at MAX chroma, blended over
 *     the vertical via a soft blend
 * Then we sample the actual OKLCH colors via a single SVG layer that
 * paints the chroma ramp. Cheap and visually-correct enough.
 */
function LcSquare({
  lch,
  onChange,
}: {
  lch: Lch
  onChange: (next: Lch) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const xN = clamp((clientX - rect.left) / rect.width, 0, 1)
      const yN = clamp((clientY - rect.top) / rect.height, 0, 1)
      const c = xN * 0.4
      const l = 1 - yN
      onChange({ ...lch, c, l })
    },
    [lch, onChange],
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    draggingRef.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    updateFromPointer(e.clientX, e.clientY)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    updateFromPointer(e.clientX, e.clientY)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  // Background gradient stack:
  //  - base: pure-hue chroma-vs-lightness ramp via radial samples
  //  - then a vertical white→transparent on top to lighten high-L
  //  - then a vertical transparent→black to darken low-L
  // Approximating this with CSS keeps it cheap and avoids a canvas.
  const baseHue = `oklch(0.65 0.4 ${Math.round(lch.h)})`
  const xN = clamp(lch.c / 0.4, 0, 1)
  const yN = clamp(1 - lch.l, 0, 1)
  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative h-32 w-full cursor-crosshair touch-none overflow-hidden rounded border border-border select-none"
      style={{
        backgroundColor: baseHue,
        backgroundImage: [
          // White → transparent vertical gradient: pulls the top toward
          // L=1 (white) and lets the base hue show through near middle.
          'linear-gradient(to top, rgba(0,0,0,0) 0%, rgba(255,255,255,1) 100%)',
          // Transparent → black: bottom converges to L=0 (black).
          'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 50%)',
          // Left edge → grey: at C=0, the column is achromatic. We
          // blend a vertical greyscale ramp on the left so leftward
          // drags head toward neutral instead of staying in-hue.
          'linear-gradient(to right, rgba(128,128,128,1) 0%, rgba(128,128,128,0) 100%)',
        ].join(', '),
      }}
    >
      {/* Cursor reticle. Outer black ring + inner white ring keep it
          legible on any color in the square. */}
      <div
        aria-hidden
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ left: `${xN * 100}%`, top: `${yN * 100}%` }}
      />
    </div>
  )
}

/**
 * Single-axis hue strip. Drag horizontally to set hue 0..360. The strip
 * is painted at the current L/C so the user can preview how the hue
 * change will read at their picked color, not just at a fixed L=0.5.
 */
function HueStrip({
  h,
  l,
  c,
  onChange,
}: {
  h: number
  l: number
  c: number
  onChange: (h: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const update = useCallback(
    (clientX: number) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const xN = clamp((clientX - rect.left) / rect.width, 0, 1)
      onChange(xN * 360)
    },
    [onChange],
  )
  const gradient = buildHueGradient(l, c)
  const xN = clamp(((h % 360) + 360) % 360, 0, 360) / 360
  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        draggingRef.current = true
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        update(e.clientX)
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) update(e.clientX)
      }}
      onPointerUp={(e) => {
        draggingRef.current = false
        try {
          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }
      }}
      className="relative h-3 w-full cursor-ew-resize touch-none overflow-hidden rounded border border-border select-none"
      style={{ background: gradient }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)] bg-white"
        style={{ left: `${xN * 100}%` }}
      />
    </div>
  )
}

/**
 * Hex input. Displays the current OKLCH as a 6-char hex code; on commit
 * parses the hex through the OKLab conversion and snaps back to OKLCH.
 * Stays a controlled `<input>` because we want the displayed text to
 * track the live LCH (e.g. dragging in the LcSquare), not freeze on the
 * user's last typed value.
 */
function HexInput({
  lch,
  onCommit,
}: {
  lch: Lch
  onCommit: (next: Lch) => void
}) {
  const hex = oklchToHex(lch)
  // A null draft means the field is not being edited, so the display derives
  // directly from the latest LCH value. While focused, the string is isolated
  // from slider updates so half-typed hex values are not clobbered.
  const [draft, setDraft] = useState<string | null>(null)
  const displayed = draft ?? hex
  const commit = () => {
    if (draft === null) return
    const parsed = hexToOklch(draft)
    setDraft(null)
    if (parsed) onCommit(parsed)
  }
  return (
    <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded border border-border bg-panel px-2">
      <span className="font-mono text-[10px] text-text-dim">#</span>
      <input
        type="text"
        value={displayed.startsWith('#') ? displayed.slice(1) : displayed}
        onFocus={() => setDraft(hex)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            const input = e.currentTarget
            setDraft(null)
            requestAnimationFrame(() => input.blur())
          }
        }}
        spellCheck={false}
        autoCapitalize="characters"
        className="min-w-0 flex-1 bg-transparent font-mono text-[11px] uppercase text-text outline-none"
        aria-label="Hex color"
      />
    </div>
  )
}

/**
 * Eyedropper button that hands a sampled screen color to `onPick` as
 * an OKLCH value.
 *
 * Uses the browser's native EyeDropper API (Chromium-only as of this
 * writing; Safari + Firefox don't expose it). On unsupported browsers
 * we render the button disabled with a tooltip explaining why — fits
 * the "web-first, Chromium-friendly" stance from the project plan.
 *
 * The picker returns sRGB hex; we convert through OKLab to OKLCH
 * before committing, so the result lands in the same space as
 * everything else in the picker.
 */
function EyedropperButton({ onPick }: { onPick: (lch: Lch) => void }) {
  const supported =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper ===
      'function'
  const onClick = async () => {
    if (!supported) return
    try {
      type EyeDropperResult = { sRGBHex: string }
      type EyeDropperCtor = new () => { open(): Promise<EyeDropperResult> }
      const Ctor = (window as unknown as { EyeDropper: EyeDropperCtor })
        .EyeDropper
      const dropper = new Ctor()
      const { sRGBHex } = await dropper.open()
      const lch = hexToOklch(sRGBHex)
      if (lch) onPick(lch)
    } catch {
      // User aborted (Esc) or browser rejected — silently ignore.
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!supported}
      title={
        supported
          ? 'Pick a color from anywhere on screen'
          : 'Eyedropper not supported in this browser'
      }
      aria-label="Eyedropper"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-panel text-text-muted hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
    >
      <EyedropperGlyph />
    </button>
  )
}

/** Compact embedded eyedropper action for a full-width paint field. */
function RowEyedropper({ onPick }: { onPick: (lch: Lch) => void }) {
  const supported =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper ===
      'function'
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!supported) return
    try {
      type EyeDropperResult = { sRGBHex: string }
      type EyeDropperCtor = new () => { open(): Promise<EyeDropperResult> }
      const Ctor = (window as unknown as { EyeDropper: EyeDropperCtor })
        .EyeDropper
      const dropper = new Ctor()
      const { sRGBHex } = await dropper.open()
      const lch = hexToOklch(sRGBHex)
      if (lch) onPick(lch)
    } catch {
      /* user aborted */
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!supported}
      title={
        supported
          ? 'Pick color from screen'
          : 'Eyedropper not supported in this browser'
      }
      aria-label="Pick color from screen"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-border bg-transparent text-text-muted hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
    >
      <EyedropperGlyph />
    </button>
  )
}

function EyedropperGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m2 22 1-1h3l9-9" />
      <path d="M3 21v-3l9-9" />
      <path d="m15 6 3.4-3.4a2.1 2.1 0 0 1 3 3L18 9" />
      <path d="m9 12 6 6" />
      <path d="m12 9 6 6" />
    </svg>
  )
}

function LinearEditor({
  value,
  onCommit,
}: {
  value: Extract<Fill, { kind: 'linear' }>
  onCommit: (next: Fill | null) => void
}) {
  return (
    <div className="space-y-2">
      <FieldRow label="Angle">
        <NumberField
          value={value.angle}
          onCommit={(angle) => onCommit({ ...value, angle })}
          step={1}
          suffix="°"
        />
      </FieldRow>
      <StopsEditor
        stops={value.stops}
        onCommit={(stops) => onCommit({ ...value, stops })}
      />
    </div>
  )
}

function RadialEditor({
  value,
  onCommit,
}: {
  value: Extract<Fill, { kind: 'radial' }>
  onCommit: (next: Fill | null) => void
}) {
  return (
    <div className="space-y-2">
      <FieldRow label="Shape">
        <SelectField<'circle' | 'ellipse'>
          value={value.shape}
          options={[
            { value: 'circle', label: 'Circle' },
            { value: 'ellipse', label: 'Ellipse' },
          ]}
          onCommit={(shape) => onCommit({ ...value, shape })}
        />
      </FieldRow>
      <FieldRow label="Center">
        <NumberField
          value={Math.round(value.cx * 100)}
          onCommit={(n) => onCommit({ ...value, cx: clamp(n / 100, 0, 1) })}
          min={0}
          max={100}
          suffix="%"
        />
        <NumberField
          value={Math.round(value.cy * 100)}
          onCommit={(n) => onCommit({ ...value, cy: clamp(n / 100, 0, 1) })}
          min={0}
          max={100}
          suffix="%"
        />
      </FieldRow>
      <StopsEditor
        stops={value.stops}
        onCommit={(stops) => onCommit({ ...value, stops })}
      />
    </div>
  )
}

function ConicEditor({
  value,
  onCommit,
}: {
  value: Extract<Fill, { kind: 'conic' }>
  onCommit: (next: Fill | null) => void
}) {
  return (
    <div className="space-y-2">
      <FieldRow label="Angle">
        <NumberField
          value={value.angle}
          onCommit={(angle) => onCommit({ ...value, angle })}
          step={1}
          suffix="°"
        />
      </FieldRow>
      <FieldRow label="Center">
        <NumberField
          value={Math.round(value.cx * 100)}
          onCommit={(n) => onCommit({ ...value, cx: clamp(n / 100, 0, 1) })}
          min={0}
          max={100}
          suffix="%"
        />
        <NumberField
          value={Math.round(value.cy * 100)}
          onCommit={(n) => onCommit({ ...value, cy: clamp(n / 100, 0, 1) })}
          min={0}
          max={100}
          suffix="%"
        />
      </FieldRow>
      <StopsEditor
        stops={value.stops}
        onCommit={(stops) => onCommit({ ...value, stops })}
      />
    </div>
  )
}

function ImageEditor({
  value,
  onCommit,
}: {
  value: Extract<Fill, { kind: 'image' }>
  onCommit: (next: Fill | null) => void
}) {
  // Hidden <input type=file> that the Upload button clicks. Sharing
  // the same data-URL pipeline as drag-drop keeps the doc self-
  // contained for MVP and the rest of the inspector behavior identical.
  const fileInputRef = useRef<HTMLInputElement>(null)

  const readFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      if (typeof r === 'string') onCommit({ ...value, src: r })
    }
    reader.readAsDataURL(file)
  }

  // Drag-drop a local file → inline as a data: URL. Same path image
  // imports already use; keeps the doc self-contained for MVP. A paste
  // also works (URL pasted into the text field).
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) readFile(file)
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) readFile(file)
    // Reset so picking the same file twice in a row still triggers
    // onChange (browsers de-dupe identical selections by default).
    e.target.value = ''
  }
  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="relative flex h-24 items-center justify-center overflow-hidden rounded border border-dashed border-border bg-panel"
        style={
          value.src
            ? {
                backgroundImage: `url(${JSON.stringify(value.src)})`,
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        {!value.src && (
          <div className="flex flex-col items-center gap-1.5 px-2 text-center">
            <span className="text-[11px] text-text-dim">
              Drop image here or paste a URL below
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded bg-panel-raised px-2 py-1 text-[11px] text-text ring-1 ring-border transition-colors hover:bg-app-bg"
            >
              Upload image
            </button>
          </div>
        )}
        {value.src && (
          // When there's already an image, surface a smaller Replace
          // chip in the top-right corner so users can swap without
          // first clearing the fill.
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute right-1 top-1 rounded bg-panel-raised/85 px-1.5 py-0.5 text-[10px] text-text ring-1 ring-border backdrop-blur transition-colors hover:bg-app-bg"
          >
            Replace
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onPickFile}
          style={{ display: 'none' }}
        />
      </div>
      <FieldRow label="URL">
        <TextField
          value={value.src}
          onCommit={(src) => onCommit({ ...value, src })}
          width="w-full"
        />
      </FieldRow>
      <FieldRow label="Fit">
        <SelectField<'cover' | 'contain' | 'fill' | 'tile'>
          value={value.fit}
          options={[
            { value: 'cover', label: 'Cover' },
            { value: 'contain', label: 'Contain' },
            { value: 'fill', label: 'Fill' },
            { value: 'tile', label: 'Tile' },
          ]}
          onCommit={(fit) => onCommit({ ...value, fit })}
        />
      </FieldRow>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stops editor (shared by linear / radial / conic)
// ---------------------------------------------------------------------------

function StopsEditor({
  stops,
  onCommit,
}: {
  stops: GradientStop[]
  onCommit: (next: GradientStop[]) => void
}) {
  const update = (i: number, patch: Partial<GradientStop>) => {
    const next = stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    next.sort((a, b) => a.at - b.at)
    onCommit(next)
  }
  const remove = (i: number) => {
    if (stops.length <= 2) return
    onCommit(stops.filter((_, idx) => idx !== i))
  }
  const add = () => {
    const a = stops[stops.length - 2]?.at ?? 0
    const b = stops[stops.length - 1]?.at ?? 1
    const at = clamp((a + b) / 2, 0, 1)
    const color = stops[stops.length - 1]?.color ?? 'oklch(0.5 0 0)'
    const next = [...stops, { at, color }]
    next.sort((x, y) => x.at - y.at)
    onCommit(next)
  }
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-wider text-text-dim uppercase">
          Stops
        </span>
        <button
          type="button"
          onClick={add}
          className="text-[10px] text-text-muted hover:text-text"
          title="Add stop"
        >
          +Add
        </button>
      </div>
      {stops.map((stop, i) => (
        <Fragment key={i}>
          <div className="flex items-center gap-1.5">
            <div className="w-14 shrink-0">
              <NumberField
                value={Math.round(stop.at * 100)}
                onCommit={(n) => update(i, { at: clamp(n / 100, 0, 1) })}
                min={0}
                max={100}
                suffix="%"
              />
            </div>
            <StopColor
              value={stop.color}
              onCommit={(color) => update(i, { color })}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={stops.length <= 2}
              className="text-[10px] text-text-dim hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
              title={
                stops.length <= 2
                  ? 'Gradients need at least two stops'
                  : 'Remove stop'
              }
            >
              ×
            </button>
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/**
 * Inline stop-color control. Uses an embedded LCH popover so the user
 * doesn't have to nest two layers of fill picker. The popover anchors
 * relative to the stop row.
 */
function StopColor({
  value,
  onCommit,
}: {
  value: string
  onCommit: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={(event) => {
          setAnchor(event.currentTarget)
          setOpen((o) => !o)
        }}
        className="h-5 w-full rounded border border-border hover:border-border-strong"
        style={{ background: value }}
        aria-label={`Stop color ${value}`}
      />
      {open && (
        <SmallLchPopover
          value={value}
          onCommit={onCommit}
          onClose={() => setOpen(false)}
          anchor={anchor}
        />
      )}
    </div>
  )
}

function SmallLchPopover({
  value,
  onCommit,
  onClose,
  anchor,
}: {
  value: string
  onCommit: (next: string) => void
  onClose: () => void
  anchor: HTMLElement | null
}) {
  const [lch, setLch] = useState<Lch>(
    () => parseOklch(value) ?? { l: 0.5, c: 0.1, h: 0 },
  )
  const popRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDocPointer = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (popRef.current?.contains(t)) return
      if (anchor && anchor.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDocPointer)
    return () => document.removeEventListener('pointerdown', onDocPointer)
  }, [anchor, onClose])
  const commit = (next: Lch) => {
    setLch(next)
    onCommit(formatOklch(next))
  }
  return (
    <div
      ref={popRef}
      className="absolute right-0 top-6 z-[60] w-56 rounded-md border border-border-strong bg-panel-raised p-2.5 shadow-2xl"
    >
      <div
        className="mb-2 h-8 w-full rounded border border-border"
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
      </Labeled>
      <div className="mt-2 flex items-center gap-1.5">
        <HexInput lch={lch} onCommit={commit} />
        <EyedropperButton onPick={commit} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared LCH primitives — duplicated from ColorField for now. Worth
// extracting if a third caller appears. Keeping local avoids cross-file
// coupling while the popover is still being iterated on.
// ---------------------------------------------------------------------------

interface Lch {
  l: number
  c: number
  h: number
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
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

function formatOklch(lch: Lch): string {
  const L = clamp(lch.l, 0, 1).toFixed(3)
  const C = clamp(lch.c, 0, 0.4).toFixed(3)
  const H = Math.round(((lch.h % 360) + 360) % 360)
  return `oklch(${L} ${C} ${H})`
}

function parseOklch(str: string | null | undefined): Lch | null {
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function summary(fill: Fill | null): string {
  if (!fill) return 'None'
  switch (fill.kind) {
    case 'solid': {
      const lch = parseOklch(fill.color)
      return lch ? oklchToHex(lch) : fill.color
    }
    case 'linear':
      return `Linear ${Math.round(fill.angle)}°`
    case 'radial':
      return `Radial ${fill.shape}`
    case 'conic':
      return `Conic ${Math.round(fill.angle)}°`
    case 'image':
      return fill.src ? 'Image' : 'Image (empty)'
  }
}
