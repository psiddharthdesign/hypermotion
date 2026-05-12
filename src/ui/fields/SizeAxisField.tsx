// SPDX-License-Identifier: Apache-2.0

import type { SizeAxis } from '@/scene'
import { NumberField } from './NumberField'

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
 * The number field shows the numeric value in Fixed mode; in Hug /
 * Fill mode it shows the word ("Hug" / "Fill") greyed out, so the
 * user can see at a glance which mode is active without reading the
 * segmented buttons. Clicking Fixed after Hug/Fill restores the last
 * typed number.
 *
 * Keeping the segmented buttons always visible is intentional: new
 * users coming from Figma expect Hug / Fill as first-class, not a
 * dropdown option. This matches Figma's own Size section.
 */
export function SizeAxisField({
  value,
  onCommit,
  mixed = false,
}: {
  value: SizeAxis
  onCommit: (next: SizeAxis) => void
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
    <div className="flex items-center gap-1">
      {mode === 'fixed' ? (
        <NumberField
          value={numeric}
          onCommit={(n) => onCommit(n)}
          min={0}
          width="w-14"
        />
      ) : (
        <div
          className="flex h-6 w-14 items-center justify-center rounded px-1 text-xs italic"
          style={{
            background: 'var(--color-panel-raised)',
            color: 'var(--color-text-dim)',
            border: '1px solid var(--color-border)',
          }}
          title={
            mode === 'hug'
              ? 'Sized to content'
              : mode === 'fill'
                ? 'Fills parent'
                : 'Values differ across the selection'
          }
        >
          {mode === 'hug' ? 'Hug' : mode === 'fill' ? 'Fill' : 'Mixed'}
        </div>
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
    <div
      className="flex h-6 items-stretch overflow-hidden rounded"
      style={{ border: '1px solid var(--color-border)' }}
    >
      {SEGMENTS.map((s, i) => {
        const active = s.value === mode
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => onChange(s.value)}
            title={s.title}
            className="px-1.5 text-[10px] leading-none font-medium transition-colors"
            style={{
              background: active
                ? 'var(--color-accent)'
                : 'var(--color-panel-raised)',
              color: active ? 'white' : 'var(--color-text-muted)',
              borderLeft:
                i === 0
                  ? 'none'
                  : '1px solid var(--color-border)',
            }}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}