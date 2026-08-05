// SPDX-License-Identifier: Apache-2.0

import type { SizeAxis } from '@/scene'
import { NumberField } from './NumberField'
import { SquircleSurface } from './SquircleSurface'

/**
 * Size-on-one-axis editor.
 *
 * Size has three flavors in this tool:
 *   - 'fixed'  — a pixel number the user typed in
 *   - 'hug'    — shrink to intrinsic content (children / text bounds)
 *   - 'fill'   — expand to fill the parent's remaining space
 *
 * UX (updated per user feedback — these need to be "very specific" and
 * always in-your-face, not hidden behind a px / hug / fill dropdown):
 *
 *   [ 120 ] [ Fixed | Hug | Fill ]
 *
 * The number slot shows the authored pixel value in Fixed mode. Hug / Fill
 * are communicated once by the adjacent selected segment, so the slot uses
 * a quiet dash instead of repeating the same mode label twice. Clicking
 * Fixed after Hug/Fill restores the last typed number.
 *
 * Keeping the segmented buttons always visible is intentional: new
 * users coming from Figma expect Hug / Fill as first-class, not a
 * dropdown option. This matches Figma's own Size section.
 */
export function SizeAxisField({
  value,
  onCommit,
  onScrubPreview,
  onScrubCommit,
  onScrubCancel,
  mixed = false,
}: {
  value: SizeAxis
  onCommit: (next: SizeAxis) => void
  /** Lightweight fixed-size preview used while the numeric handle is scrubbed. */
  onScrubPreview?: (next: number) => void
  /** Durable fixed-size commit made once when the scrub ends. */
  onScrubCommit?: (next: number) => void
  /** Drop an active fixed-size preview without changing the scene. */
  onScrubCancel?: () => void
  /**
   * True when the selection disagrees on this axis (e.g. one layer is
   * `hug`, another is `120`). When set, no pill is active and the
   * numeric slot shows a "Mixed" placeholder — clicking any pill still
   * commits that mode to every selected layer, so the user isn't
   * forced to first normalize to Hug just to reach Fill. This is the
   * workaround for the case where the mixed badge used to steal column
   * width and visually clip the segmented control.
   */
  mixed?: boolean
}) {
  const mode: Mode | null = mixed
    ? null
    : value === 'hug'
      ? 'hug'
      : value === 'fill'
        ? 'fill'
        : 'fixed'
  const numeric = typeof value === 'number' ? value : 100

  const setMode = (next: Mode) => {
    if (next === mode) return
    if (next === 'hug') onCommit('hug')
    else if (next === 'fill') onCommit('fill')
    else onCommit(numeric)
  }

  return (
    <div className="grid w-full min-w-0 grid-cols-[76px_minmax(0,1fr)] items-center gap-1">
      {mode === 'fixed' ? (
        <NumberField
          value={numeric}
          onCommit={(n) => onCommit(n)}
          onScrubPreview={onScrubPreview}
          onScrubCommit={onScrubCommit}
          onScrubCancel={onScrubCancel}
          min={0}
          suffix="px"
          width="min-w-0 w-full"
        />
      ) : (
        <SquircleSurface
          radius={6}
          className="hm-control-surface hm-control-compact flex h-7 min-w-0 items-center justify-center px-1 text-[11px] text-text-dim"
          title={
            mode === 'hug'
              ? 'Sized to content'
              : mode === 'fill'
                ? 'Fills parent'
                : 'Values differ across the selection'
          }
        >
          {mode == null ? 'Mixed' : '—'}
        </SquircleSurface>
      )}
      <Segmented mode={mode} onChange={setMode} />
    </div>
  )
}

type Mode = 'fixed' | 'hug' | 'fill'

const SEGMENTS: Array<{ value: Mode; label: string; title: string }> = [
  { value: 'fixed', label: 'Fixed', title: 'Fixed pixel size' },
  { value: 'hug', label: 'Hug', title: 'Hug contents — shrink to fit children' },
  { value: 'fill', label: 'Fill', title: 'Fill parent — expand to available space' },
]

function Segmented({
  mode,
  onChange,
}: {
  /** null means "mixed" — no pill is active. */
  mode: Mode | null
  onChange: (next: Mode) => void
}) {
  return (
    <SquircleSurface
      radius={6}
      className="hm-control-surface hm-control-compact hm-inspector-segmented"
    >
      {SEGMENTS.map((s) => {
        const active = s.value === mode
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => onChange(s.value)}
            title={s.title}
            aria-pressed={active}
            data-active={active}
            className="hm-inspector-segment"
          >
            {s.label}
          </button>
        )
      })}
    </SquircleSurface>
  )
}
