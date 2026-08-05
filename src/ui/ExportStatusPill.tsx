// SPDX-License-Identifier: Apache-2.0

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useExportProgress } from '@/export'

/**
 * Persistent export status pill.
 *
 * Lives in the TopBar so the user can close the export panel mid-run
 * and keep working. Phases ramp through:
 *
 *   rendering → encoding → done   (success, auto-dismisses ~4s after)
 *   rendering → encoding → error  (sticks until dismissed)
 *   rendering → encoding → cancelled
 *
 * Click the pill to expand a popover with frame stats, ETA, and a
 * cancel button. The pill itself shows a circular ring (filled to
 * `frame / totalFrames`) plus a phase-keyed label.
 *
 * Render contract: returns `null` while phase is 'idle' so the TopBar
 * doesn't reserve space when nothing's running. The pill is also
 * marked `data-export-hide` so the body[data-export-recording] CSS
 * rule scrubs it from any tab-capture stream — designers don't want a
 * "47%" overlay baked into their final WebM. The lower-right
 * ExportRecordingIndicator handles the in-stream confirmation while
 * tab capture is recording.
 */
export function ExportStatusPill() {
  const phase = useExportProgress((s) => s.phase)
  const format = useExportProgress((s) => s.format)
  const frame = useExportProgress((s) => s.frame)
  const totalFrames = useExportProgress((s) => s.totalFrames)
  const error = useExportProgress((s) => s.error)
  const blobUrl = useExportProgress((s) => s.blobUrl)
  const fileName = useExportProgress((s) => s.fileName)
  const etaMs = useExportProgress((s) => s.etaMs)
  const msPerFrame = useExportProgress((s) => s.msPerFrame)
  const requestCancel = useExportProgress((s) => s.requestCancel)
  const reset = useExportProgress((s) => s.reset)

  const [popoverOpen, setPopoverOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)

  // Auto-dismiss successful exports after 4s — long enough to register,
  // short enough not to clutter. Errors and cancels stick around until
  // the user dismisses (or starts another export).
  useEffect(() => {
    if (phase !== 'done') return
    const id = window.setTimeout(() => reset(), 4000)
    return () => window.clearTimeout(id)
  }, [phase, reset])

  if (phase === 'idle' || !format) return null

  const pct =
    totalFrames > 0
      ? Math.min(100, Math.round((frame / totalFrames) * 100))
      : 0

  const label = (() => {
    if (phase === 'rendering') return `Exporting · ${pct}%`
    if (phase === 'encoding') return `Encoding · ${pct}%`
    if (phase === 'done') return 'Export complete'
    if (phase === 'error') return 'Export failed'
    if (phase === 'cancelled') return 'Export cancelled'
    return ''
  })()

  return (
    <>
      <button
        type="button"
        // data-export-hide so the captured stream doesn't include the
        // pill itself (the pill IS visible in the TopBar but the
        // recording-mode CSS hides it).
        data-export-hide="1"
        onClick={(event) => {
          setAnchor(event.currentTarget)
          setPopoverOpen((v) => !v)
        }}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        className={[
          'flex h-[26px] items-center gap-2 rounded-md border border-border bg-panel px-2.5 text-[11px] font-medium transition-colors hover:border-border-strong',
          phase === 'error' ? 'text-[oklch(0.65_0.18_25)]' : 'text-text',
        ].join(' ')}
      >
        <Ring pct={pct} phase={phase} size={14} />
        <span className="whitespace-nowrap">{label}</span>
      </button>

      {popoverOpen && anchor && (
        <PillPopover
          anchor={anchor}
          onClose={() => setPopoverOpen(false)}
          phase={phase}
          format={format}
          frame={frame}
          totalFrames={totalFrames}
          fileName={fileName}
          blobUrl={blobUrl}
          error={error}
          etaMs={etaMs}
          msPerFrame={msPerFrame}
          pct={pct}
          requestCancel={requestCancel}
          reset={reset}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Popover.
// ---------------------------------------------------------------------------

function PillPopover({
  anchor,
  onClose,
  phase,
  format,
  frame,
  totalFrames,
  fileName,
  blobUrl,
  error,
  etaMs,
  msPerFrame,
  pct,
  requestCancel,
  reset,
}: {
  anchor: HTMLElement
  onClose: () => void
  phase: ReturnType<typeof useExportProgress.getState>['phase']
  format: NonNullable<ReturnType<typeof useExportProgress.getState>['format']>
  frame: number
  totalFrames: number
  fileName: string | null
  blobUrl: string | null
  error: string | null
  etaMs: number
  msPerFrame: number
  pct: number
  requestCancel: () => void
  reset: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const trigger = anchor.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const pad = 6
    let left = trigger.right - rect.width
    if (left + rect.width + pad > vw) left = vw - rect.width - pad
    if (left < pad) left = pad
    const top = trigger.bottom + 6
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current
      if (el && el.contains(e.target as Node)) return
      if (anchor.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  const isActive = phase === 'rendering' || phase === 'encoding'

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      data-export-hide="1"
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        width: 300,
      }}
      className="z-[110] overflow-hidden rounded-lg border border-border bg-panel-raised shadow-lg shadow-black/30"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        <Ring pct={pct} phase={phase} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-text">
            {fileName ?? 'Export'}
          </div>
          <div className="text-[10px] text-text-muted">
            {format.label}
            {isActive && etaMs > 0 && ` · ~${formatEta(etaMs)} remaining`}
          </div>
        </div>
      </div>

      {/* Body — phase-dependent. */}
      <div className="space-y-2 px-3 py-2.5">
        {isActive && (
          <>
            <Stat label="Frame" value={`${Math.min(frame, totalFrames)} / ${totalFrames}`} />
            <Stat
              label="Stage"
              value={phase === 'rendering' ? 'Rendering frames' : 'Encoding'}
            />
            {msPerFrame > 0 && (
              <Stat
                label="Throughput"
                value={`${(1000 / msPerFrame).toFixed(1)} fps`}
              />
            )}
            <p className="pt-0.5 text-[10px] leading-relaxed text-text-dim">
              You can keep working — the export runs in the background.
              Switching tabs may pause the encode.
            </p>
          </>
        )}

        {phase === 'done' && (
          <>
            <p className="text-[11px] leading-relaxed text-text">
              Saved as <span className="font-mono">{fileName}</span>.
            </p>
            {blobUrl && fileName && (
              <a
                href={blobUrl}
                download={fileName}
                className="inline-flex items-center gap-1.5 rounded bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent hover:brightness-110"
              >
                <DownloadIcon />
                Download again
              </a>
            )}
          </>
        )}

        {phase === 'error' && (
          <p className="text-[11px] leading-relaxed text-text">{error}</p>
        )}

        {phase === 'cancelled' && (
          <p className="text-[11px] text-text-muted">No file was written.</p>
        )}
      </div>

      {/* Foot */}
      <div className="flex items-center justify-end gap-1.5 border-t border-border bg-panel px-3 py-2">
        {isActive && (
          <button
            type="button"
            onClick={() => {
              requestCancel()
              onClose()
            }}
            className="rounded border border-border bg-panel-raised px-2 py-0.5 text-[11px] text-text-muted hover:text-text"
          >
            Cancel
          </button>
        )}
        {(phase === 'done' || phase === 'error' || phase === 'cancelled') && (
          <button
            type="button"
            onClick={() => {
              reset()
              onClose()
            }}
            className="rounded bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent hover:brightness-110"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono tabular-nums text-text">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SVG ring.
// ---------------------------------------------------------------------------

function Ring({
  pct,
  phase,
  size,
}: {
  pct: number
  phase: ReturnType<typeof useExportProgress.getState>['phase']
  size: number
}) {
  const r = size / 2 - 1.5
  const c = 2 * Math.PI * r
  // Filled ring: progress wedge along the circumference.
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c

  const color = (() => {
    if (phase === 'error') return 'oklch(0.65 0.18 25)'
    if (phase === 'cancelled') return 'var(--color-text-dim)'
    if (phase === 'done') return 'oklch(0.7 0.15 145)'
    return 'var(--color-accent)'
  })()

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={1.5}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 150ms ease-out' }}
      />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 1.5v6.5M3.5 5.5L6 8l2.5-2.5M2 9.5h8" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// ETA formatter.
// ---------------------------------------------------------------------------

function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const totalSec = Math.max(1, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const totalMin = Math.round(totalSec / 60)
  if (totalMin < 60) {
    const remSec = totalSec % 60
    return remSec >= 5 ? `${Math.floor(totalSec / 60)}m ${remSec}s` : `${totalMin}m`
  }
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m}m`
}
